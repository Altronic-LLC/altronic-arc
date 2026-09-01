import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Wrench, X } from "lucide-react";
import {
  EQUIPMENT_ASSET_STATUSES,
  EQUIPMENT_CRITICALITIES,
  type Equipment,
  type Person,
} from "@/types/task";
import {
  useSetEquipmentResponsibleTech,
  useUpdateEquipmentFields,
} from "@/hooks/useEquipment";
import {
  useMaintenanceDepartments,
  useMaintenanceLocations,
} from "@/hooks/useMaintenanceReferenceLists";
import { useMyMaintenanceRoles } from "@/hooks/useMaintenanceRoles";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { manageAssetsGate } from "@/lib/maintenanceRoles";
import { referenceOptions } from "@/lib/maintenanceReferences";
import {
  type AssetEditInput,
  assetEditInput,
  buildAssetUpdateFields,
  machineHoursText,
  parseMachineHours,
} from "@/lib/assetRegister";
import { equipmentLabel } from "@/lib/equipmentMapper";
import { mergePeople, personKey } from "@/lib/people";
import { fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { DateField } from "./DateField";
import { ChoiceSelect, SingleSelect } from "./SearchableSelect";
import { useOverlayDismiss } from "./useOverlayDismiss";

// =============================================================================
// Edit one asset.
//
// **Edit only — there is no create here, and no delete.** An asset row exists
// because the plant bought a machine; deleting one orphans every work order
// and PM schedule pointing at it. Taking a machine out of service is
// `Asset Status = Retired`, which is why that choice exists and why the status
// picker sits at the top of the form rather than buried.
//
// Every write is gated by `manageAssetsGate` — the same gate the reference
// lists ask, and the same gate each mutation re-asks inside its own
// `mutationFn`. The refusal is said OUT LOUD in a banner rather than only as a
// tooltip on a disabled button, which a touch user can never read, and it is
// suppressed while the roles list is still loading: a denial taken back a
// moment later is worse than a beat of silence.
//
// Two things about the write path:
//
//  - **Only the columns that changed are sent** (`buildAssetUpdateFields`),
//    for the reasons that helper documents — chiefly that the two reference
//    lookups can hold an unmigrated sentinel that must never be written back.
//  - **Responsible Tech goes through its OWN mutation**, never the generic
//    field patch: it is a single-person column whose lookupId has to be
//    resolved against the PMO site before a write, and a write that can't be
//    resolved is refused rather than silently clearing the column.
// =============================================================================

interface AssetEditModalProps {
  asset: Equipment;
  onClose: () => void;
}

export function AssetEditModal({ asset, onClose }: AssetEditModalProps) {
  const access = useMyMaintenanceRoles();
  const gate = manageAssetsGate(access);

  const updateFields = useUpdateEquipmentFields();
  const setResponsibleTech = useSetEquipmentResponsibleTech();
  const { data: departments = [] } = useMaintenanceDepartments();
  const { data: locations = [] } = useMaintenanceLocations();
  const directory = useDirectoryPeople();

  // Seeded ONCE. The register behind this modal refetches on its own cadence,
  // and re-seeding from it would wipe whatever is half-typed.
  const [draft, setDraft] = useState<AssetEditInput>(() => assetEditInput(asset));
  const [tech, setTech] = useState<Person | null>(asset.responsibleTech);
  const [hoursText, setHoursText] = useState(() => machineHoursText(asset));
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  // `busy` disables backdrop dismissal: closing mid-save would leave the user
  // with no idea whether the write landed.
  const overlayDismiss = useOverlayDismiss(onClose, updateFields.isPending || setResponsibleTech.isPending);

  // Land the caret in the first field, so an edit can start by typing.
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const busy = updateFields.isPending || setResponsibleTech.isPending;
  const locked = busy || !gate.allowed;

  const people = useMemo(
    // The tech on the record may be a leaver, or an account whose mailbox
    // differs from the address the directory lists. Keeping them in the option
    // list is what stops a person who IS set rendering as "Nobody".
    () => mergePeople(directory, asset.responsibleTech ? [asset.responsibleTech] : []),
    [directory, asset.responsibleTech],
  );

  function set<K extends keyof AssetEditInput>(key: K, value: AssetEditInput[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!draft.name.trim()) {
      setError("An asset needs a name.");
      return;
    }
    const hours = parseMachineHours(hoursText);
    if (!hours.ok) {
      setError("Machine hours has to be a number that isn't negative — or blank.");
      return;
    }

    const input: AssetEditInput = { ...draft, currentMachineHours: hours.value };
    const fields = buildAssetUpdateFields(input, asset);

    const prevTech = asset.responsibleTech ? personKey(asset.responsibleTech) : "";
    const nextTech = tech ? personKey(tech) : "";
    const techChanged = prevTech !== nextTech;

    if (Object.keys(fields).length === 0 && !techChanged) {
      // A no-op save is a no-op, not a Modified stamp that makes the
      // register's "last edited" column lie about being fresh.
      onClose();
      return;
    }

    try {
      if (Object.keys(fields).length > 0) {
        await updateFields.mutateAsync({ lookupId: asset.lookupId, fields });
      }
      if (techChanged) {
        await setResponsibleTech.mutateAsync({ lookupId: asset.lookupId, person: tech });
      }
      onClose();
    } catch (err) {
      // The mutations toast their own failure; this keeps the form open with
      // the reason in front of the person who has to act on it, rather than
      // closing over work they would have to retype.
      setError(err instanceof Error ? err.message : "Couldn't save that change.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${equipmentLabel(asset)}`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex min-w-0 items-center gap-2 font-display text-base font-semibold text-fg">
            <Wrench className="h-4 w-4 shrink-0 text-accent" />
            <span className="truncate">{equipmentLabel(asset)}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form id="asset-form" onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!gate.allowed && !gate.resolving && (
            <p className="mb-4 rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 px-3 py-2 text-xs text-fg">
              {gate.hint}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" required className="sm:col-span-2">
              <input
                ref={firstFieldRef}
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                disabled={locked}
                className="input"
              />
            </Field>

            <Field label="Asset Tag">
              <input
                value={draft.assetTag}
                onChange={(e) => set("assetTag", e.target.value)}
                disabled={locked}
                placeholder="The number on the machine"
                className="input"
              />
            </Field>

            <Field label="Current Machine Hours">
              <input
                value={hoursText}
                onChange={(e) => setHoursText(e.target.value)}
                disabled={locked}
                inputMode="decimal"
                placeholder="Never recorded"
                className="input"
              />
              <p className="mt-1 text-[11px] font-normal normal-case tracking-normal text-fg-muted">
                What a meter-based PM counts against. Leave blank if the meter has never been read
                — blank and zero are different answers.
              </p>
            </Field>

            <Field label="Asset Status">
              <ChoiceSelect
                ariaLabel="Asset Status"
                value={draft.assetStatus ?? ""}
                onChange={(v) => set("assetStatus", v || null)}
                options={EQUIPMENT_ASSET_STATUSES}
                emptyLabel="Not set"
                disabled={locked}
              />
              <p className="mt-1 text-[11px] font-normal normal-case tracking-normal text-fg-muted">
                Retired is how an asset leaves the register — rows are never deleted, because work
                orders point at them.
              </p>
            </Field>

            <Field label="Criticality">
              <ChoiceSelect
                ariaLabel="Criticality"
                value={draft.criticality ?? ""}
                onChange={(v) => set("criticality", v || null)}
                options={EQUIPMENT_CRITICALITIES}
                emptyLabel="Not set"
                disabled={locked}
              />
            </Field>

            <Field label="Department">
              <SingleSelect
                allLabel="Not set"
                ariaLabel="Department"
                searchPlaceholder="Search departments…"
                // Active values, plus whatever this asset already points at
                // even when that has since been retired — a picker that
                // dropped it would clear the field on the next save.
                options={referenceOptions(departments, asset.department)}
                selected={
                  draft.departmentLookupId === null ? null : String(draft.departmentLookupId)
                }
                onChange={(v) => set("departmentLookupId", v === null ? null : Number(v))}
                disabled={locked}
              />
            </Field>

            <Field label="Location">
              <SingleSelect
                allLabel="Not set"
                ariaLabel="Location"
                searchPlaceholder="Search locations…"
                options={referenceOptions(locations, asset.location)}
                selected={draft.locationLookupId === null ? null : String(draft.locationLookupId)}
                onChange={(v) => set("locationLookupId", v === null ? null : Number(v))}
                disabled={locked}
              />
            </Field>

            <Field label="Responsible Tech">
              <SingleSelect
                allLabel="Nobody assigned"
                ariaLabel="Responsible Tech"
                searchPlaceholder="Search people…"
                options={people.map((p) => ({
                  value: personKey(p),
                  label: p.displayName || p.email || "Unknown",
                }))}
                selected={tech ? personKey(tech) : null}
                onChange={(key) =>
                  setTech(key ? people.find((p) => personKey(p) === key) ?? null : null)
                }
                disabled={locked}
              />
            </Field>

            <Field label="Equipment Type">
              <input
                value={draft.equipmentType ?? ""}
                onChange={(e) => set("equipmentType", e.target.value || null)}
                disabled={locked}
                className="input"
              />
            </Field>

            <Field label="Manufacturer">
              <input
                value={draft.manufacturer}
                onChange={(e) => set("manufacturer", e.target.value)}
                disabled={locked}
                className="input"
              />
            </Field>

            <Field label="Model Number">
              <input
                value={draft.modelNumber}
                onChange={(e) => set("modelNumber", e.target.value)}
                disabled={locked}
                className="input"
              />
            </Field>

            <Field label="Serial No">
              <input
                value={draft.serialNo}
                onChange={(e) => set("serialNo", e.target.value)}
                disabled={locked}
                className="input"
              />
            </Field>

            <Field label="Install Date">
              <DateField
                aria-label="Install Date"
                value={toDateInputValue(draft.installDate)}
                onChange={(v) => set("installDate", fromDateInputValue(v))}
                disabled={locked}
                title={gate.allowed ? undefined : gate.hint}
              />
            </Field>

            <Field label="Warranty Expiry">
              <DateField
                aria-label="Warranty Expiry"
                value={toDateInputValue(draft.warrantyExpiry)}
                onChange={(v) => set("warrantyExpiry", fromDateInputValue(v))}
                disabled={locked}
                title={gate.allowed ? undefined : gate.hint}
              />
            </Field>

            <Field label="Description" className="sm:col-span-2">
              <AutoGrowTextarea
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
                disabled={locked}
                rows={2}
                className="input"
              />
            </Field>
          </div>

          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="asset-form"
            disabled={locked}
            title={gate.allowed ? undefined : gate.hint}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

export default AssetEditModal;

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
    </label>
  );
}
