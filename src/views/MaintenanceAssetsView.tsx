import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Gauge, Pencil, Settings2, X } from "lucide-react";
import {
  EQUIPMENT_ASSET_STATUSES,
  EQUIPMENT_CRITICALITIES,
  type Equipment,
} from "@/types/task";
import { useEquipment, useSetEquipmentMachineHours } from "@/hooks/useEquipment";
import { useMyMaintenanceRoles } from "@/hooks/useMaintenanceRoles";
import { manageAssetsGate } from "@/lib/maintenanceRoles";
import {
  ASSET_GAPS,
  ASSET_GAP_HINTS,
  ASSET_GAP_LABELS,
  ASSET_SORT_LABELS,
  EMPTY_ASSET_FILTERS,
  type AssetFilters,
  type AssetGap,
  type AssetSort,
  applyAssetFilters,
  assetChoiceOptions,
  assetGapCounts,
  assetGaps,
  assetReferenceOptions,
  hasActiveAssetFilters,
  machineHoursText,
  needsAttention,
  parseMachineHours,
  sortAssets,
} from "@/lib/assetRegister";
import { equipmentLabel } from "@/lib/equipmentMapper";
import { referenceLabel } from "@/lib/maintenanceReferences";
import { cn } from "@/lib/cn";
import { AssetStatusChip, CriticalityChip } from "@/components/maintenanceAtoms";
import { AssetEditModal } from "@/components/AssetEditModal";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { ChoiceSelect } from "@/components/SearchableSelect";

// =============================================================================
// The asset register — /operations/maintenance/assets.
//
// **Inside the maintenance module, not under /admin.** Managing equipment is
// maintenance work done by maintenance people with the module already open; it
// is locked to maintenance admins rather than moved somewhere else (Ray:
// "equipment management needs to be available inside maint task, just locked
// to admin"). Reading the register is open to anyone signed in — everybody has
// to be able to look a machine up — and every WRITE asks `manageAssetsGate`,
// both here and again inside each `mutationFn`.
//
// **The screen's first job is the gaps, not the table.** Roughly half the 378
// rows have no Department, and Asset Tag, Criticality and Current Machine
// Hours are largely blank. A tidy alphabetical grid over that data would have
// looked finished and told nobody anything, so:
//
//   * a **Needs attention** toggle with a live count, and one filter chip per
//     missing field, so "which 190 assets have no department" is one click;
//   * an amber gap badge on every row that has one, each chip explaining what
//     the missing field costs rather than just scolding;
//   * a **Most gaps first** sort, so the rows somebody can go and fix are at
//     the top instead of wherever the alphabet put them.
//
// **Machine hours get their own inline editor**, not just a field in the edit
// modal. That reading is what a meter-based PM counts against: one that never
// moves is a PM that never comes due, silently. Making somebody open a form to
// type one number is exactly how that happens, so the cell itself is the
// control. The "Updated" column beside it is the row's SharePoint Modified
// date — the closest honest answer to "is this reading stale", since
// SharePoint keeps no per-column timestamp, and labelled as the row's edit
// date rather than pretending to be more.
//
// **No create and no delete**, here or in the API (see
// api/operationsEquipment.ts). An asset exists because the plant bought a
// machine; retiring is `Asset Status = Retired`.
// =============================================================================

/**
 * How many rows reach the DOM before the "Show all" escape hatch.
 *
 * The cap is on RENDERING only — every filter, every count and every coverage
 * figure runs over the full 378 (CLAUDE.md, "Big lists cap what's RENDERED").
 */
const INITIAL_ROWS = 150;

export function MaintenanceAssetsView() {
  const { data: assets = [], isLoading } = useEquipment();
  const access = useMyMaintenanceRoles();
  const gate = manageAssetsGate(access);
  // ONE mutation for the whole table, handed down to each row.
  //
  // Not one per `MachineHoursCell`: this screen caps at 150 rendered rows
  // precisely because row-level work is what makes a big list stutter, and a
  // mutation hook per row is 150 `useMutation` subscriptions plus 150 copies
  // of the access resolution behind `useRequireAssetAdmin` — exactly the cost
  // the cap exists to avoid.
  const saveHours = useSetEquipmentMachineHours();

  const [filters, setFilters] = useState<AssetFilters>(EMPTY_ASSET_FILTERS);
  const [sort, setSort] = useState<AssetSort>("name");
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  // Counts describe the WHOLE register, never the filtered view — "62 with no
  // machine hours" has to mean the same thing before and after somebody
  // narrows the list, or the number is worthless as a target.
  const gapCounts = useMemo(() => assetGapCounts(assets), [assets]);
  const attentionCount = useMemo(() => assets.filter(needsAttention).length, [assets]);

  const departmentOptions = useMemo(
    () => assetReferenceOptions(assets, (a) => a.department, "No department"),
    [assets],
  );
  const locationOptions = useMemo(
    () => assetReferenceOptions(assets, (a) => a.location, "No location"),
    [assets],
  );
  const criticalityOptions = useMemo(
    () => assetChoiceOptions(assets, (a) => a.criticality, "Not set", EQUIPMENT_CRITICALITIES),
    [assets],
  );
  const statusOptions = useMemo(
    () => assetChoiceOptions(assets, (a) => a.assetStatus, "Not set", EQUIPMENT_ASSET_STATUSES),
    [assets],
  );
  const typeOptions = useMemo(
    () => assetChoiceOptions(assets, (a) => a.equipmentType, "Not set"),
    [assets],
  );

  const filtered = useMemo(
    () => sortAssets(applyAssetFilters(assets, filters), sort),
    [assets, filters, sort],
  );

  // The cap is for the unfiltered case. Once somebody has narrowed to a
  // handful, re-hiding rows they just searched for would be perverse.
  useEffect(() => {
    setShowAll(false);
  }, [filters, sort]);

  const shown = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);
  const editingAsset = editing === null ? null : assets.find((a) => a.lookupId === editing) ?? null;

  function patch(next: Partial<AssetFilters>) {
    setFilters((f) => ({ ...f, ...next }));
  }

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-fg sm:text-2xl">
            <Settings2 className="h-5 w-5 text-accent" />
            Asset register
          </h1>
          <p className="text-sm text-fg-muted">
            Every machine the CMMS knows about. Work orders and PM schedules point at these rows, so
            an asset is never deleted — set its status to Retired instead.{" "}
            <Link
              to="/admin/maintenance-reference-lists"
              className="text-accent underline-offset-2 hover:underline"
            >
              Departments and locations
            </Link>{" "}
            are managed separately.
          </p>
        </div>

        {/* Said out loud, not only as a tooltip on a disabled button — a touch
            user can never read one. Suppressed while the roles list is still
            loading: a denial taken back a moment later is worse than a beat of
            silence. */}
        {!gate.allowed && !gate.resolving && (
          <p className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 px-3 py-2 text-xs text-fg">
            {gate.hint} You can still search and read the register.
          </p>
        )}
      </header>

      <GapSummary
        total={assets.length}
        attentionCount={attentionCount}
        gapCounts={gapCounts}
        filters={filters}
        onPatch={patch}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[14rem] flex-1">
          <SearchInput
            value={filters.q}
            onChange={(q) => patch({ q })}
            placeholder="Search name, tag, serial, model, department…"
          />
        </div>
        <FilterSelect
          label="Department"
          value={filters.department}
          onChange={(v) => patch({ department: v })}
          options={departmentOptions}
          allLabel="Any department"
        />
        <FilterSelect
          label="Location"
          value={filters.location}
          onChange={(v) => patch({ location: v })}
          options={locationOptions}
          allLabel="Any location"
        />
        <FilterSelect
          label="Criticality"
          value={filters.criticality}
          onChange={(v) => patch({ criticality: v })}
          options={criticalityOptions}
          allLabel="Any criticality"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => patch({ status: v })}
          options={statusOptions}
          allLabel="Any status"
        />
        <FilterSelect
          label="Type"
          value={filters.equipmentType}
          onChange={(v) => patch({ equipmentType: v })}
          options={typeOptions}
          allLabel="Any type"
        />
        <div className="w-40">
          <ChoiceSelect
            ariaLabel="Sort"
            value={sort}
            onChange={(v) => setSort((v as AssetSort) || "name")}
            options={(Object.keys(ASSET_SORT_LABELS) as AssetSort[]).map((s) => ({
              value: s,
              label: ASSET_SORT_LABELS[s],
            }))}
            emptyLabel="Sort"
            clearable={false}
          />
        </div>
        {hasActiveAssetFilters(filters) && (
          <button
            onClick={() => setFilters(EMPTY_ASSET_FILTERS)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
            Clear filters
          </button>
        )}
      </div>

      {isLoading ? (
        <LoadingTasks noun="the asset register" />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-fg-muted">
          No assets match those filters.
        </div>
      ) : (
        <>
          <p className="text-xs text-fg-muted">
            Showing {shown.length} of {filtered.length}
            {filtered.length !== assets.length ? ` (${assets.length} in the register)` : ""}
          </p>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[64rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  <Th>Asset</Th>
                  <Th>Tag</Th>
                  <Th>Type</Th>
                  <Th>Department</Th>
                  <Th>Location</Th>
                  <Th>Criticality</Th>
                  <Th>Status</Th>
                  <Th>Responsible</Th>
                  <Th>Machine hours</Th>
                  <Th>Updated</Th>
                  <Th> </Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((asset) => (
                  <AssetRow
                    key={asset.lookupId}
                    asset={asset}
                    canEdit={gate.allowed}
                    editHint={gate.hint}
                    onEdit={() => setEditing(asset.lookupId)}
                    onSaveHours={(hours) =>
                      saveHours.mutate({ lookupId: asset.lookupId, hours })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          {!showAll && filtered.length > INITIAL_ROWS && (
            <button
              onClick={() => setShowAll(true)}
              className="self-center rounded-md border border-border bg-surface px-4 py-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
            >
              Show all {filtered.length}
            </button>
          )}
        </>
      )}

      {editingAsset && (
        <AssetEditModal asset={editingAsset} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

export default MaintenanceAssetsView;

// -----------------------------------------------------------------------------
// The "needs attention" affordance
// -----------------------------------------------------------------------------

/**
 * What the register is missing, as a row of one-click filters.
 *
 * This is the reason the screen exists rather than a prettier table: the
 * numbers are the work list. Every count is over the whole register, and every
 * chip narrows the table to exactly the rows behind its number, so the gap
 * between "190 with no department" and "here they are" is one click.
 *
 * Retired assets are excluded from all of it (see `assetGaps`) — a machine
 * that has left the plant does not need its meter read, and permanent
 * unfixable rows are how a queue stops being looked at.
 */
function GapSummary({
  total,
  attentionCount,
  gapCounts,
  filters,
  onPatch,
}: {
  total: number;
  attentionCount: number;
  gapCounts: Record<AssetGap, number>;
  filters: AssetFilters;
  onPatch: (next: Partial<AssetFilters>) => void;
}) {
  if (total === 0) return null;

  return (
    <section
      aria-label="Needs attention"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5"
    >
      <button
        onClick={() =>
          onPatch({ needsAttention: !filters.needsAttention, gap: null })
        }
        aria-pressed={filters.needsAttention}
        title="Assets missing at least one field. Retired assets are not counted."
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
          filters.needsAttention
            ? "bg-ajax-yellow text-black"
            : "border border-ajax-yellow/50 bg-ajax-yellow/10 text-fg hover:bg-ajax-yellow/20",
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Needs attention ({attentionCount})
      </button>
      <span className="text-[11px] text-fg-muted">of {total}</span>

      <span className="mx-1 hidden h-4 w-px bg-border sm:block" />

      {ASSET_GAPS.map((gap) => {
        const count = gapCounts[gap];
        if (count === 0) return null;
        const active = filters.gap === gap;
        return (
          <button
            key={gap}
            onClick={() => onPatch({ gap: active ? null : gap, needsAttention: false })}
            aria-pressed={active}
            title={ASSET_GAP_HINTS[gap]}
            className={cn(
              "rounded-md px-2 py-1 text-[11px] transition-colors",
              active
                ? "bg-accent text-white"
                : "border border-border bg-surface-2 text-fg-muted hover:text-fg",
            )}
          >
            {ASSET_GAP_LABELS[gap]} ({count})
          </button>
        );
      })}

      {ASSET_GAPS.every((g) => gapCounts[g] === 0) && (
        <span className="text-xs text-fg-muted">
          Every active asset has a department, location, tag, criticality and machine-hours reading.
        </span>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Rows
// -----------------------------------------------------------------------------

function AssetRow({
  asset,
  canEdit,
  editHint,
  onEdit,
  onSaveHours,
}: {
  asset: Equipment;
  canEdit: boolean;
  editHint: string;
  onEdit: () => void;
  onSaveHours: (hours: number | null) => void;
}) {
  const gaps = assetGaps(asset);
  return (
    <tr className="border-b border-border last:border-0 align-top hover:bg-surface-2">
      <Td>
        <Link
          to={`/operations/maintenance/asset/${asset.lookupId}`}
          className="font-medium text-fg hover:text-accent hover:underline"
        >
          {equipmentLabel(asset)}
        </Link>
        {gaps.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {gaps.map((gap) => (
              <span
                key={gap}
                title={ASSET_GAP_HINTS[gap]}
                className="rounded border border-ajax-yellow/50 bg-ajax-yellow/10 px-1 py-px text-[10px] font-medium text-fg"
              >
                {ASSET_GAP_LABELS[gap]}
              </span>
            ))}
          </div>
        )}
      </Td>
      <Td>{asset.assetTag || <Missing />}</Td>
      <Td>{asset.equipmentType || <Missing />}</Td>
      <Td>{asset.department ? referenceLabel(asset.department) : <Missing />}</Td>
      <Td>{asset.location ? referenceLabel(asset.location) : <Missing />}</Td>
      <Td>{asset.criticality ? <CriticalityChip criticality={asset.criticality} /> : <Missing />}</Td>
      <Td>
        {asset.assetStatus ? <AssetStatusChip assetStatus={asset.assetStatus} /> : <Missing />}
      </Td>
      <Td>{asset.responsibleTech?.displayName || <Missing label="Nobody" />}</Td>
      <Td>
        <MachineHoursCell
          asset={asset}
          canEdit={canEdit}
          editHint={editHint}
          onSave={onSaveHours}
        />
      </Td>
      <Td>
        <span
          className="text-xs text-fg-muted"
          // Honest about what this is: SharePoint keeps no per-column
          // timestamp, so this is when the ROW last changed in any field.
          title="When this asset row was last edited, in any field. SharePoint doesn't record when an individual column changed."
        >
          {formatModified(asset.modifiedAt)}
        </span>
      </Td>
      <Td>
        <button
          onClick={onEdit}
          disabled={!canEdit}
          title={canEdit ? `Edit ${equipmentLabel(asset)}` : editHint}
          aria-label={`Edit ${equipmentLabel(asset)}`}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </button>
      </Td>
    </tr>
  );
}

/**
 * The hourmeter reading, editable in place.
 *
 * A one-field action on purpose: this number is what a meter-based PM counts
 * against, so a reading nobody updates is a PM that never comes due — and
 * making somebody open a full edit form to type one figure is precisely how a
 * meter goes stale. Blank reads "Never recorded" in amber rather than as an
 * empty cell, because "no reading" is a fact worth seeing, not an absence.
 */
function MachineHoursCell({
  asset,
  canEdit,
  editHint,
  onSave,
}: {
  asset: Equipment;
  canEdit: boolean;
  editHint: string;
  onSave: (hours: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => machineHoursText(asset));
  const [invalid, setInvalid] = useState(false);

  function commit() {
    const parsed = parseMachineHours(text);
    if (!parsed.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setEditing(false);
    if (parsed.value === asset.currentMachineHours) return;
    onSave(parsed.value);
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          autoFocus
          value={text}
          inputMode="decimal"
          aria-label={`Machine hours for ${equipmentLabel(asset)}`}
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setText(machineHoursText(asset));
              setInvalid(false);
              setEditing(false);
            }
          }}
          className={cn(
            "w-24 rounded-md border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent/20",
            invalid ? "border-cooper-red" : "border-accent",
          )}
        />
        <button
          onClick={commit}
          aria-label="Save machine hours"
          className="rounded-md bg-accent p-1 text-white hover:bg-accent/90"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        {invalid && <span className="text-[10px] text-cooper-red">Number, or blank</span>}
      </span>
    );
  }

  return (
    <button
      onClick={() => {
        setText(machineHoursText(asset));
        setEditing(true);
      }}
      disabled={!canEdit}
      title={
        canEdit
          ? "Record the hourmeter reading. A meter-based PM counts against this number."
          : editHint
      }
      aria-label={`Machine hours for ${equipmentLabel(asset)}`}
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-sm transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Gauge className="h-3.5 w-3.5 text-fg-muted" />
      {asset.currentMachineHours === null ? (
        <span className="text-xs text-ajax-yellow">Never recorded</span>
      ) : (
        <span className="tabular-nums text-fg">{asset.currentMachineHours}</span>
      )}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Presentation
// -----------------------------------------------------------------------------

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  // A column that is empty everywhere (or holds one value) is offered anyway
  // when it has a "none" entry — that entry IS the finding.
  if (options.length === 0) return null;
  return (
    <div className="w-44">
      <ChoiceSelect
        ariaLabel={label}
        value={value ?? ""}
        onChange={(v) => onChange(v || null)}
        options={options}
        emptyLabel={allLabel}
        searchPlaceholder={`Search ${label.toLowerCase()}…`}
      />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-semibold">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2">{children}</td>;
}

/** An empty cell says so — "not set" and "we didn't load it" must not look alike. */
function Missing({ label = "Not set" }: { label?: string }) {
  return <span className="text-xs text-fg-muted">{label}</span>;
}

function formatModified(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Re-exported so a test can assert the cap without duplicating the number. */
export { INITIAL_ROWS as ASSET_REGISTER_INITIAL_ROWS };
