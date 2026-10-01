import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Loader2, Plus, Send, Upload, Wand2, X } from "lucide-react";
import { datasheetFileName, datasheetFileProblem, DATASHEETS_PATH } from "@/api/datasheets";
import { formatBytes } from "@/api/projectFiles";
import { useUploadDatasheet } from "@/hooks/useDatasheet";
import { pushToast } from "./Toast";
import {
  useAllAltronicComponents,
  useAllAltronicParts,
  useCreateAltronicComponent,
  useCreateAltronicPart,
  useRequestNewPartsList,
} from "@/hooks/useAltronicParts";
import { isDeletedPart, partEvent } from "@/lib/partLifecycle";
import { useMyPartsAccess } from "@/hooks/usePartsRoles";
import { useFormDraft } from "@/hooks/useFormDraft";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { ChoicePills } from "./ChoicePills";
import { DateField } from "./DateField";
import { DraftRestoredNotice } from "./DraftRestoredNotice";
import { YesNoField } from "./YesNoField";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { COMPONENT_PREFIX_CATEGORY, isComponentPrefix, partPrefix } from "@/lib/altronicPartMapper";
import {
  COMPONENT_FIELDS,
  PART_FIELDS,
  isRequired,
  missingRequired,
  nextPartNumber,
  opensNewList,
  partNumberProblem,
  patchFromForm,
  type PartFieldSpec,
} from "@/lib/partFields";
import { ratingLabelsFor } from "@/lib/componentRatings";
import { COMPONENT_DESCRIPTION_OPTIONS_CONFIGURED } from "@/api/config";
import { useComponentDescriptionOptions } from "@/hooks/useComponentDescriptionOptions";
import {
  composeDescription,
  optionsOfKind,
  picksProblem,
  reconcilePicks,
  type DescriptionPicks,
} from "@/lib/componentDescriptions";
import { ComponentDescriptionPicker } from "./ComponentDescriptionPicker";
import { addPartGate } from "@/lib/partsRoles";
import { partPath } from "@/lib/partSearch";
import { toDateInputValue } from "@/lib/spDates";

// =============================================================================
// New part — on either list. The form follows the NUMBER: a 601/611/701/711/
// 712/722 number is a component (ratings, footprint, three-step approval),
// anything else a Part List part (drawing, purchasing, two-step). Opened from
// a list, the list number is fixed and the next free number is filled in;
// opened from the Parts Book, any number may be typed, which is how a new
// three-digit list gets its first part.
//
// The rules are the 2023 guide's (see lib/partFields.ts for which fields are
// required), plus: the number must be unique and must start with the list
// it's added to. Uniqueness is checked here against the loaded lists AND
// again by the API against SharePoint, because the cache can be minutes old.
//
// The typed text is kept as a draft (create only) so navigating away to look
// something up doesn't lose it. The datasheet is NOT — a File can't be stored.
//
// A datasheet PDF may be picked (Tim, 2026-09-28). It is uploaded as
// `<part #>.pdf` right AFTER the part is created — the name needs the final
// number, and a file uploaded first would be left behind if the create were
// refused. It is checked before the create, so a wrong pick leaves nothing
// behind; an upload that fails after the part exists warns rather than
// making the part look unsaved, and the part page's Upload is the way back.
//
// A COMPONENT's Description is picked from dropdowns (Tim, 2026-09-28/29) —
// see lib/componentDescriptions.ts. The picks are kept in the draft under
// their own keys and joined into Description on save. Until the options list
// is configured, or when it can't be read, the plain box stays: a New part
// form that can't describe a component is worse than one that can't enforce
// the format.
// =============================================================================

const PICK_KEYS = { silCategory: "descSilCategory", name: "descName", type: "descType" } as const;

type AnySpec = PartFieldSpec<Record<string, unknown>>;

/** Date Assigned defaults to today — the day the number is being assigned. */
function defaultValues(): Record<string, string> {
  const now = new Date();
  return { dateAssigned: toDateInputValue(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12))) };
}

export function PartFormModal({ prefix, onClose }: { prefix: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  // Every row, deleted ones included: a deleted number is free to type, and
  // Next free hands out the lowest one in the list before a new number.
  const parts = useAllAltronicParts();
  const components = useAllAltronicComponents();
  const access = useMyPartsAccess();
  const createPart = useCreateAltronicPart();
  const createComponent = useCreateAltronicComponent();
  const uploadSheet = useUploadDatasheet();
  const [datasheet, setDatasheet] = useState<File | null>(null);

  const { existing, allNumbers, deleted } = useMemo(() => {
    const rows = [...(parts.data ?? []), ...(components.data ?? [])];
    const dead = rows.filter(isDeletedPart);
    return {
      /** Numbers a LIVE part holds — the ones a new part can't take. */
      existing: rows.filter((r) => !isDeletedPart(r)).map((r) => r.partNumber),
      /** Every number, so a fresh one never lands on a deleted row's. */
      allNumbers: rows.map((r) => r.partNumber),
      deleted: new Map(dead.map((r) => [r.partNumber.trim().toLowerCase(), r])),
    };
  }, [parts.data, components.data]);
  const deletedNumbers = useMemo(() => [...deleted.values()].map((r) => r.partNumber), [deleted]);
  const next = (p: string) => nextPartNumber(p, allNumbers, deletedNumbers);

  const draft = useFormDraft<Record<string, string>>(`newAltronicPart:${prefix ?? "any"}`);
  const [partNumber, setPartNumber] = useState(draft.initial.partNumber ?? "");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const restored: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft.initial)) if (typeof v === "string") restored[k] = v;
    return { ...defaultValues(), ...restored };
  });
  const [error, setError] = useState<string | null>(null);

  // Fill in the next free number once the lists have loaded — but never over
  // something typed or restored.
  useEffect(() => {
    if (!prefix || partNumber || allNumbers.length === 0) return;
    const n = next(prefix);
    if (n) setPartNumber(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, allNumbers.length]);

  useEffect(() => {
    draft.save({ ...values, partNumber });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, partNumber]);

  const typedPrefix = partPrefix(partNumber) ?? prefix ?? "";
  const component = isComponentPrefix(typedPrefix);
  const specs = (component ? COMPONENT_FIELDS : PART_FIELDS).filter((s) => s.onCreate !== false) as unknown as AnySpec[];
  // A number on a list with no parts yet STARTS that list — the SAP admin's
  // alone (Tim, 2026-09-29). Not decided until the Part List has loaded, or
  // every list would look new for the first few seconds.
  const newList = !!parts.data && opensNewList(typedPrefix, allNumbers);
  const gate = addPartGate(access, typedPrefix, component, newList);
  // Allowed on an existing list, refused only because this one is new — the
  // case that gets the "ask the SAP admin" button rather than a plain refusal.
  const needsNewList = newList && !gate.allowed && addPartGate(access, typedPrefix, component).allowed;
  const busy = createPart.isPending || createComponent.isPending || uploadSheet.isPending;

  // The description dropdowns — components only, and only once the options
  // are loaded. A restored draft's picks are checked against today's options.
  const optionsQuery = useComponentDescriptionOptions();
  const options = optionsQuery.data ?? [];
  const pickerAvailable =
    COMPONENT_DESCRIPTION_OPTIONS_CONFIGURED && optionsOfKind(options, "Description").length > 0;
  const usePicker = component && pickerAvailable;
  const pickerLoading = component && COMPONENT_DESCRIPTION_OPTIONS_CONFIGURED && optionsQuery.isLoading;
  const pickerFailed = component && COMPONENT_DESCRIPTION_OPTIONS_CONFIGURED && optionsQuery.isError;
  const needSil = typedPrefix === "722";
  const picks = reconcilePicks(
    {
      silCategory: values[PICK_KEYS.silCategory] ?? "",
      name: values[PICK_KEYS.name] ?? "",
      type: values[PICK_KEYS.type] ?? "",
    },
    options,
  );
  const effectiveValues = usePicker
    ? { ...values, description: composeDescription(needSil ? picks : { ...picks, silCategory: "" }) }
    : values;
  const labels = ratingLabelsFor(effectiveValues.description ?? "");
  const listFull = !!prefix && allNumbers.length > 0 && next(prefix) === null;
  // Typing (or being offered) a deleted number reuses it — say so, and when
  // it was deleted, so nobody mistakes it for a number that was never used.
  const reusing = deleted.get(partNumber.trim().toLowerCase()) ?? null;
  const reusingDeletedAt = reusing ? partEvent(reusing.comments, "deleted")?.timestamp ?? null : null;

  const overlayDismiss = useOverlayDismiss(onClose, busy);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function setPicks(next: DescriptionPicks) {
    setValues((prev) => ({
      ...prev,
      [PICK_KEYS.silCategory]: next.silCategory,
      [PICK_KEYS.name]: next.name,
      [PICK_KEYS.type]: next.type,
    }));
  }

  function suggest() {
    const n = typedPrefix ? next(typedPrefix) : null;
    if (n) setPartNumber(n);
    else setError(typedPrefix ? `List ${typedPrefix} is full — every number up to ${typedPrefix}999 is taken.` : "Type the three-digit list number first.");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!gate.allowed) return setError(gate.hint);
    const numberProblem = partNumberProblem(partNumber, prefix, existing);
    if (numberProblem) return setError(numberProblem);
    // Picked descriptions say WHICH pick is missing, not just "Description".
    const pickProblem = usePicker ? picksProblem(picks, options, needSil) : null;
    const missing = missingRequired(specs, pickProblem ? { ...effectiveValues, description: "x" } : effectiveValues);
    if (pickProblem) {
      return setError(missing.length > 0 ? `${pickProblem} Also fill in: ${missing.join(", ")}.` : pickProblem);
    }
    if (missing.length > 0) return setError(`Fill in: ${missing.join(", ")}.`);
    // Before the create, so a wrong pick doesn't leave a part with no file.
    const fileProblem = datasheet ? datasheetFileProblem(datasheet) : null;
    if (fileProblem) return setError(fileProblem);

    const patch = patchFromForm(specs, effectiveValues);
    const pn = partNumber.trim();
    let created: { id: number };
    try {
      created = component
        ? await createComponent.mutateAsync({ ...patch, partNumber: pn })
        : await createPart.mutateAsync({ ...patch, partNumber: pn });
    } catch (err) {
      return setError(err instanceof Error ? err.message : "Couldn't add the part.");
    }
    // The part is real from here on: nothing below may make it look unsaved.
    draft.clear();
    if (datasheet) await sendDatasheet(pn, datasheet, component ? created.id : undefined);
    onClose();
    navigate(partPath(component ? "component" : "part", created.id));
  }

  async function sendDatasheet(pn: string, file: File, componentId: number | undefined) {
    try {
      const { flagError } = await uploadSheet.mutateAsync({ partNumber: pn, file, via: "new", componentId });
      if (flagError) {
        pushToast({
          message: `The datasheet uploaded, but Has Data Sheet couldn't be set: ${flagError} The part's page still links to it.`,
          variant: "error",
        });
      }
    } catch (err) {
      const why = err instanceof Error ? err.message : "the upload failed.";
      pushToast({
        message: `${pn} was added, but its datasheet didn't upload — ${why} Use Upload datasheet on the part's page to try again.`,
        variant: "error",
      });
    }
  }

  function labelFor(spec: AnySpec): string {
    if (!component) return spec.label;
    const letter = spec.key === "ratingA" ? "a" : spec.key === "ratingB" ? "b" : spec.key === "ratingC" ? "c" : null;
    if (!letter || !labels.component) return spec.label;
    // The meaning IS the label, as on the old app's form (Tim, 2026-09-29) —
    // it follows the Description picked; what's saved is still Rating A/B/C.
    const meaning = labels[letter];
    return meaning ?? `${spec.label} (not used for a ${labels.component.toLowerCase()})`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" {...overlayDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New part"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Plus className="h-4 w-4 text-accent" />
            {prefix ? `New part in list ${prefix}` : "New part"}
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

        <form id="part-form" onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {draft.restored && (
            <div className="mb-4">
              <DraftRestoredNotice
                onDiscard={() => {
                  draft.clear();
                  setPartNumber(prefix ? (next(prefix) ?? "") : "");
                  setValues(defaultValues());
                }}
                onKeep={draft.dismissNotice}
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Altronic Part #" required>
              <div className="flex gap-2">
                <input
                  value={partNumber}
                  onChange={(e) => setPartNumber(e.target.value)}
                  className="input font-mono"
                  placeholder={prefix ? `${prefix}…` : "e.g. 604612"}
                  autoFocus
                  aria-label="Altronic Part #"
                />
                <button
                  type="button"
                  onClick={suggest}
                  title="Fill in the next free number in this list"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-fg hover:bg-surface-2"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Next free
                </button>
              </div>
            </Field>
            <div className="self-end text-xs text-fg-muted">
              {typedPrefix ? (
                component ? (
                  <>
                    Goes on the <strong className="text-fg">Component List</strong> as{" "}
                    {COMPONENT_PREFIX_CATEGORY[typedPrefix]}. An engineer reviews it, then the SAP admin.
                  </>
                ) : (
                  <>
                    Goes on the <strong className="text-fg">Part List</strong>. The SAP admin adds it to SAP and
                    approves it.
                  </>
                )
              ) : (
                "The first three digits are the list it goes in."
              )}
            </div>
          </div>

          {reusing && (
            <p className="mt-3 rounded-md border border-superior-blue/40 bg-superior-blue/5 px-3 py-2 text-xs text-fg">
              <strong>{reusing.partNumber}</strong> is a deleted number
              {reusingDeletedAt ? ` (deleted ${reusingDeletedAt.toLocaleDateString()})` : ""}, so this part reuses it.
              Nothing from the old part carries over.
            </p>
          )}

          {needsNewList && (
            <NewListRequest prefix={typedPrefix} partNumber={partNumber} description={values.description ?? ""} />
          )}
          {newList && gate.allowed && (
            <p className="mt-3 rounded-md border border-superior-blue/40 bg-superior-blue/5 px-3 py-2 text-xs text-fg">
              There's no list <strong>{typedPrefix}</strong> yet — this part starts it, in the {typedPrefix.charAt(0)}00
              Parts Book.
            </p>
          )}

          {listFull && (
            <p className="mt-3 rounded-md border border-ajax-yellow/40 bg-ajax-yellow/5 px-3 py-2 text-xs text-fg">
              List {prefix} is full — every number up to {prefix}999 is taken. Check with the SAP admin which list the part
              belongs in.
            </p>
          )}

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {specs.map((spec) =>
              spec.key === "description" && usePicker ? (
                <ComponentDescriptionPicker
                  key={spec.key}
                  picks={picks}
                  onChange={setPicks}
                  options={options}
                  needSil={needSil}
                  disabled={busy}
                />
              ) : spec.key === "description" && pickerLoading ? (
                <p key={spec.key} className="text-sm text-fg-muted sm:col-span-2">
                  Loading the description lists…
                </p>
              ) : (
                <Field
                  key={spec.key}
                  label={labelFor(spec)}
                  required={isRequired(spec, effectiveValues)}
                  wide={spec.kind === "multiline" || spec.key === "description"}
                  plain={spec.kind !== "text" && spec.kind !== "multiline"}
                >
                  <Control spec={spec} label={labelFor(spec)} value={values[spec.key] ?? ""} onChange={(v) => set(spec.key, v)} disabled={busy} />
                  {spec.key === "description" && pickerFailed && (
                    <span className="mt-1 block text-[11px] text-fg-muted">
                      Couldn't load the description lists, so type the description — in capitals, like
                      &quot;CAPACITOR - CERAMIC&quot;.
                    </span>
                  )}
                </Field>
              ),
            )}
          </div>

          <DatasheetPicker
            file={datasheet}
            onChange={(f) => {
              setError(f ? datasheetFileProblem(f) : null);
              setDatasheet(f);
            }}
            fileName={partNumber.trim() ? datasheetFileName(partNumber) : "<part #>.pdf"}
            disabled={busy}
          />

          {!gate.allowed && !gate.resolving && !needsNewList && <p className="mt-4 text-sm text-fg-muted">{gate.hint}</p>}
          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-4 py-1.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="part-form"
            disabled={busy || !gate.allowed}
            title={gate.allowed ? undefined : gate.hint}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {uploadSheet.isPending ? "Uploading datasheet…" : "Add part"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "New part" — on a list screen (prefix fixed) or the Parts Book (any number).
 *
 * Shown only to people who can add parts there. Unlike most gated controls in
 * ARC it is HIDDEN rather than greyed for everybody else: the Parts List is
 * read by the whole company, and a permanently disabled button on every list
 * for every reader would be noise. The part page's Record card says who can
 * edit, which is where somebody looking for that answer goes.
 */
export function NewPartButton({ prefix }: { prefix: string | null }) {
  const access = useMyPartsAccess();
  const [open, setOpen] = useState(false);
  const gate = addPartGate(access, prefix ?? "", prefix ? isComponentPrefix(prefix) : false);
  if (!gate.allowed && !gate.resolving) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!gate.allowed}
        title={gate.resolving ? gate.hint : undefined}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-60"
      >
        <Plus className="h-4 w-4" />
        New part
      </button>
      {open && <PartFormModal prefix={prefix} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The number typed is on a list that doesn't exist, and only the SAP admin can
 * start one — say so, and offer to ask them. The request carries what was
 * typed, so the SAP admin can add it as the list's first part.
 */
function NewListRequest({ prefix, partNumber, description }: { prefix: string; partNumber: string; description: string }) {
  const request = useRequestNewPartsList();
  // A different list is a different request.
  const [sentFor, setSentFor] = useState<{ prefix: string; to: string[] } | null>(null);
  const sent = sentFor?.prefix === prefix ? sentFor : null;
  return (
    <div role="alert" className="mt-3 rounded-md border border-cooper-red/40 bg-cooper-red/5 px-3 py-2 text-xs text-fg">
      <p>
        There's no list <strong>{prefix}</strong> yet, and only the SAP admin can start a new list. Ask them to open it —
        they'll add this part as its first.
      </p>
      {sent ? (
        <p className="mt-2 font-medium text-fg">
          Sent to {sent.to.join(", ")}. You'll hear back once list {prefix} is open.
        </p>
      ) : (
        <button
          type="button"
          disabled={request.isPending}
          onClick={() =>
            request.mutate(
              { prefix, partNumber, description },
              { onSuccess: (to) => setSentFor({ prefix, to }) },
            )
          }
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-60"
        >
          {request.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Ask the SAP admin for list {prefix}
        </button>
      )}
      {request.isError && !sent && (
        <p className="mt-2 text-cooper-red">
          {request.error instanceof Error ? request.error.message : "The request didn't send."}
        </p>
      )}
    </div>
  );
}

/** Optional datasheet PDF — named after the part number when it's uploaded. */
function DatasheetPicker({
  file,
  onChange,
  fileName,
  disabled,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  fileName: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-4 rounded-md border border-dashed border-border px-3 py-3">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Datasheet</span>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label="Datasheet PDF"
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          // Let the same file be picked again after it's removed.
          e.target.value = "";
        }}
      />
      {file ? (
        <div className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-fg-muted" />
          <span className="min-w-0 flex-1 truncate text-fg" title={file.name}>
            {file.name} <span className="text-fg-muted">({formatBytes(file.size)})</span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="rounded-md px-2 py-0.5 text-xs font-medium text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          Choose PDF
        </button>
      )}
      <p className="mt-1.5 text-[11px] text-fg-muted">
        Optional. Saved to {DATASHEETS_PATH} as <span className="font-mono">{fileName}</span> once the part is added. A
        datasheet already there under that name is kept, not replaced.
      </p>
    </div>
  );
}

function Control({
  spec,
  label = spec.label,
  value,
  onChange,
  disabled,
}: {
  spec: AnySpec;
  /** The name shown — and announced. A rating's is its meaning ("Resistance"), not "Rating A". */
  label?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  if (spec.kind === "date") return <DateField value={value} onChange={onChange} disabled={disabled} aria-label={label} />;
  if (spec.kind === "boolean") {
    return <YesNoField label={label} name={`new-part-${spec.key}`} value={value} onChange={onChange} disabled={disabled} />;
  }
  if (spec.kind === "choice") {
    // Two-option choices, required — so pills with no "Not set": nothing is
    // picked until somebody picks, and validation catches the empty.
    return (
      <ChoicePills
        label={label}
        name={`new-part-${spec.key}`}
        options={spec.choices ?? []}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }
  if (spec.kind === "multiline") {
    return (
      <AutoGrowTextarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        style={{ minHeight: "5rem" }}
        className="input resize-y"
        disabled={disabled}
        aria-label={label}
      />
    );
  }
  return <input value={value} onChange={(e) => onChange(e.target.value)} className="input" disabled={disabled} aria-label={label} />;
}

function Field({
  label,
  required,
  wide,
  plain,
  children,
}: {
  label: string;
  required?: boolean;
  wide?: boolean;
  /** A <div>, not a <label> — pills and the date picker carry their own labels. */
  plain?: boolean;
  children: ReactNode;
}) {
  const Tag = plain ? "div" : "label";
  return (
    <Tag className={wide ? "block sm:col-span-2" : "block"}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
        {required && <span className="ml-1 text-cooper-red">*</span>}
      </span>
      {children}
    </Tag>
  );
}
