import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  TestTubes,
  X,
} from "lucide-react";
import { IGNITION_QC_FAMILY_LIST_IDS } from "@/api/ignitionQc";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import {
  useCreateIgnitionQcRecord,
  useListIgnitionQcRecords,
  useUpdateIgnitionQcRecord,
} from "@/hooks/useIgnitionQc";
import type { IgnitionQcRecord } from "@/lib/ignitionQc";
import { isPermissionDenied } from "@/lib/listWriteErrors";

type ProductFamily = keyof typeof IGNITION_QC_FAMILY_LIST_IDS;
type SortKey = keyof Omit<IgnitionQcRecord, "id" | "productFamily">;

// Always-visible columns (core identifiers + quantities).
const CORE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "workOrder", label: "Work Order" },
  { key: "dateTested", label: "Date Tested" },
  { key: "operator", label: "Operator" },
  { key: "oldNumber", label: "Old No" },
  { key: "sapNumber", label: "SAP No" },
  { key: "revisionNoFirmwareDate", label: "Rev Date" },
  { key: "quantityTested", label: "Qty Test" },
  { key: "quantityRejected", label: "Qty Reject" },
];

// Defect breakdown columns — collapsible behind the "Defects" toggle.
const DEFECT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "processSolderDefect", label: "Proc" },
  { key: "aeSolderDefect", label: "AE Sold" },
  { key: "aeWiringDeficiency", label: "AE Wiring" },
  { key: "aeWrongOrMissingComponent", label: "AE Miss" },
  { key: "aeAssemblyDeficiency", label: "AE Assy" },
  { key: "aeIdentificationDeficiency", label: "AE ID" },
  { key: "programmingFirmware", label: "Prog" },
  { key: "coatingPottingDeficiency", label: "Coat" },
  { key: "machinePartPlacementDeficiency", label: "Machine" },
  { key: "physicalDamage", label: "Damage" },
  { key: "ncmVendor", label: "NCM Vend" },
  { key: "ncmInternal", label: "NCM Int" },
  { key: "other", label: "Other" },
];

const DEFECT_KEYS = DEFECT_COLUMNS.map((column) => column.key);

const DEFAULT_FORM = {
  workOrder: "",
  // Left empty here; openCreateForm fills this with the current moment when the form actually
  // opens, rather than baking in whatever time this module happened to load.
  dateTested: "",
  operator: "",
  oldNumber: "",
  sapNumber: "",
  revisionNoFirmwareDate: "",
  comments: "",
  quantityTested: "0",
  quantityRejected: "0",
  processSolderDefect: "0",
  aeSolderDefect: "0",
  aeWiringDeficiency: "0",
  aeWrongOrMissingComponent: "0",
  aeAssemblyDeficiency: "0",
  aeIdentificationDeficiency: "0",
  programmingFirmware: "0",
  coatingPottingDeficiency: "0",
  machinePartPlacementDeficiency: "0",
  physicalDamage: "0",
  ncmVendor: "0",
  ncmInternal: "0",
  toRP: "0",
  other: "0",
};

// Formats an ISO timestamp for a <input type="datetime-local"> using the browser's local time.
// (toISOString() alone would show UTC, which reads as the wrong time to whoever's looking at it.)
function toDateTimeInputValue(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defectTotal(record: IgnitionQcRecord): number {
  return DEFECT_KEYS.reduce((sum, key) => sum + (Number(record[key]) || 0), 0);
}

export function IgnitionQcView() {
  const [selectedFamily, setSelectedFamily] = useState<ProductFamily>("NGI5K,CPU2K Unit");
  const [pickerOpen, setPickerOpen] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(DEFAULT_FORM);
  // Row click opens the form read-only; the in-form "Edit" button switches it to editable.
  const [isReadOnly, setIsReadOnly] = useState(false);
  // Snapshot taken whenever the form opens, used to detect unsaved changes.
  const initialDraftRef = useRef(DEFAULT_FORM);
  // Set when the user tries to navigate away (e.g. change product family) with unsaved edits.
  const [pendingProceed, setPendingProceed] = useState<(() => void) | null>(null);
  const [filterText, setFilterText] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("dateTested");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  // Collapsed by default: fewer columns, larger rows. Expand to see the full defect breakdown.
  const [defectsExpanded, setDefectsExpanded] = useState(false);
  // Mobile card view: which record's comment preview is currently shown (press-and-hold), if any.
  const [commentPreviewId, setCommentPreviewId] = useState<string | null>(null);
  const commentPressTimerRef = useRef<number | null>(null);

  const { data: records = [], isLoading, error, refetch } = useListIgnitionQcRecords(selectedFamily);
  const createMutation = useCreateIgnitionQcRecord(selectedFamily);
  const updateMutation = useUpdateIgnitionQcRecord(selectedFamily);
  const listUnavailable = !!error && isPermissionDenied(error);

  const families = Object.keys(IGNITION_QC_FAMILY_LIST_IDS) as ProductFamily[];

  useEffect(() => {
    if (showForm) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [showForm]);

  const visibleRecords = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    const filtered = query
      ? records.filter((record) =>
          Object.entries(record).some(
            ([key, value]) =>
              key !== "id" && key !== "productFamily" && String(value ?? "").toLowerCase().includes(query),
          ),
        )
      : records;

    return [...filtered].sort((left, right) => {
      const leftValue = left[sortKey] ?? "";
      const rightValue = right[sortKey] ?? "";
      const leftNumber = typeof leftValue === "number" ? leftValue : Number(leftValue);
      const rightNumber = typeof rightValue === "number" ? rightValue : Number(rightValue);
      const comparison =
        !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)
          ? leftNumber - rightNumber
          : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filterText, records, sortDirection, sortKey]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  }

  function selectFamily(family: ProductFamily) {
    setSelectedFamily(family);
    setPickerOpen(false);
  }

  function toDraft(record?: IgnitionQcRecord): typeof DEFAULT_FORM {
    if (!record) {
      return { ...DEFAULT_FORM, dateTested: new Date().toISOString() };
    }

    return {
      workOrder: record.workOrder,
      dateTested: record.dateTested,
      operator: record.operator,
      oldNumber: record.oldNumber,
      sapNumber: record.sapNumber,
      revisionNoFirmwareDate: record.revisionNoFirmwareDate,
      comments: record.comments ?? "",
      quantityTested: String(record.quantityTested),
      quantityRejected: String(record.quantityRejected),
      processSolderDefect: String(record.processSolderDefect),
      aeSolderDefect: String(record.aeSolderDefect),
      aeWiringDeficiency: String(record.aeWiringDeficiency),
      aeWrongOrMissingComponent: String(record.aeWrongOrMissingComponent),
      aeAssemblyDeficiency: String(record.aeAssemblyDeficiency),
      aeIdentificationDeficiency: String(record.aeIdentificationDeficiency),
      programmingFirmware: String(record.programmingFirmware),
      coatingPottingDeficiency: String(record.coatingPottingDeficiency),
      machinePartPlacementDeficiency: String(record.machinePartPlacementDeficiency),
      physicalDamage: String(record.physicalDamage),
      ncmVendor: String(record.ncmVendor),
      ncmInternal: String(record.ncmInternal),
      toRP: String(record.toRP ?? 0),
      other: String(record.other ?? 0),
    };
  }

  function updateField(field: keyof typeof DEFAULT_FORM, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function openCreateForm() {
    const initial = toDraft();
    setEditingId(null);
    setDraft(initial);
    initialDraftRef.current = initial;
    setIsReadOnly(false);
    setShowForm(true);
  }

  // Row click: open the record for viewing only. Nothing is editable until "Edit" is clicked.
  function openViewForm(record: IgnitionQcRecord) {
    const initial = toDraft(record);
    setEditingId(record.id);
    setDraft(initial);
    initialDraftRef.current = initial;
    setIsReadOnly(true);
    setShowForm(true);
  }

  // Edit button (or "Edit" inside the read-only view): open the record directly as editable.
  function openEditForm(record: IgnitionQcRecord) {
    const initial = toDraft(record);
    setEditingId(record.id);
    setDraft(initial);
    initialDraftRef.current = initial;
    setIsReadOnly(false);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setDraft(toDraft());
    setIsReadOnly(false);
  }

  // True only when the form is open, editable, and the draft differs from what it opened with.
  function isFormDirty(): boolean {
    if (!showForm || isReadOnly) return false;
    return JSON.stringify(draft) !== JSON.stringify(initialDraftRef.current);
  }

  // Runs `proceed` immediately if there's nothing unsaved (closing the form first); otherwise asks.
  function guardFormNavigation(proceed: () => void) {
    if (isFormDirty()) {
      setPendingProceed(() => proceed);
      return;
    }
    if (showForm) {
      closeForm();
    }
    proceed();
  }

  // Press-and-hold on a card's comment icon (mobile has no hover, so title tooltips never show).
  function startCommentPreview(recordId: string) {
    clearCommentPressTimer();
    commentPressTimerRef.current = window.setTimeout(() => setCommentPreviewId(recordId), 350);
  }

  function clearCommentPressTimer() {
    if (commentPressTimerRef.current !== null) {
      window.clearTimeout(commentPressTimerRef.current);
      commentPressTimerRef.current = null;
    }
  }

  // Ends the hold: hides the preview and, if it was showing, swallows the click that would
  // otherwise follow the touch and open the record (a hold is a "peek", not a tap-to-open).
  function endCommentPreview(recordId: string, event: React.TouchEvent) {
    clearCommentPressTimer();
    if (commentPreviewId === recordId) {
      event.preventDefault();
      setCommentPreviewId(null);
    }
  }

  function toNumber(value: string): number {
    return value.trim() === "" ? 0 : Number(value);
  }

  function formatDateOnly(value: string): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  // Only Enter pressed while focus is on a real <button> (Save/Cancel/Edit) should submit the
  // form. Enter inside any text/number input is swallowed so it can never trigger a save;
  // textareas are left alone since Enter there just inserts a newline as expected.
  function handleFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter") return;
    const target = event.target as HTMLElement;
    if (target.tagName === "BUTTON" || target.tagName === "TEXTAREA") return;
    event.preventDefault();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitForm();
  }

  async function submitForm() {
    if (dateTestedInvalid || quantityRejectedMismatch) {
      return;
    }

    const recordData = {
      workOrder: draft.workOrder || "N/A",
      dateTested: draft.dateTested || new Date().toISOString(),
      operator: draft.operator || "",
      oldNumber: draft.oldNumber || "",
      sapNumber: draft.sapNumber || "",
      revisionNoFirmwareDate: draft.revisionNoFirmwareDate || "",
      comments: draft.comments,
      quantityTested: toNumber(draft.quantityTested),
      quantityRejected: toNumber(draft.quantityRejected),
      processSolderDefect: toNumber(draft.processSolderDefect),
      aeSolderDefect: toNumber(draft.aeSolderDefect),
      aeWiringDeficiency: toNumber(draft.aeWiringDeficiency),
      aeWrongOrMissingComponent: toNumber(draft.aeWrongOrMissingComponent),
      aeAssemblyDeficiency: toNumber(draft.aeAssemblyDeficiency),
      aeIdentificationDeficiency: toNumber(draft.aeIdentificationDeficiency),
      programmingFirmware: toNumber(draft.programmingFirmware),
      coatingPottingDeficiency: toNumber(draft.coatingPottingDeficiency),
      machinePartPlacementDeficiency: toNumber(draft.machinePartPlacementDeficiency),
      physicalDamage: toNumber(draft.physicalDamage),
      ncmVendor: toNumber(draft.ncmVendor),
      ncmInternal: toNumber(draft.ncmInternal),
      toRP: toNumber(draft.toRP),
      other: toNumber(draft.other),
    };

    if (editingId) {
      await updateMutation.mutateAsync({ recordId: editingId, record: recordData });
    } else {
      await createMutation.mutateAsync(recordData);
    }

    closeForm();
  }

  async function handleConfirmSave() {
    const proceed = pendingProceed;
    setPendingProceed(null);
    await submitForm();
    proceed?.();
  }

  function handleConfirmDiscard() {
    const proceed = pendingProceed;
    setPendingProceed(null);
    closeForm();
    proceed?.();
  }

  function handleConfirmCancel() {
    setPendingProceed(null);
  }

  // Date Tested is required — empty or unparseable both count as "not entered."
  const dateTestedInvalid = !draft.dateTested || Number.isNaN(new Date(draft.dateTested).getTime());

  // Quantity Rejected must equal the sum of the individual defect-category fields. This catches
  // both directions: rejects logged with no defect breakdown, and defects that overcount the
  // rejects. Computed live off `draft` so the field borders update as the operator types.
  const defectFieldsTotal = DEFECT_KEYS.reduce((sum, key) => sum + toNumber(draft[key]), 0);
  const quantityRejectedNum = toNumber(draft.quantityRejected);
  const quantityRejectedMismatch = defectFieldsTotal !== quantityRejectedNum;
  const canSubmitForm = !dateTestedInvalid && !quantityRejectedMismatch;

  // Row/head density flips with the defects toggle: fewer columns → larger, more readable rows.
  const cellClass = defectsExpanded ? "px-1 py-1.5 text-[10px]" : "px-3 py-3 text-sm";
  const headClass = defectsExpanded ? "px-1 py-2 text-[10px]" : "px-3 py-2.5 text-xs";

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <TestTubes className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Ignition QC Defect Log
          </h1>
          <p className="text-sm text-fg-muted">
            Product family overview from the workbook, with each family's own SharePoint list loaded when selected.
          </p>
        </div>
        {!pickerOpen && (
          <button
            type="button"
            onClick={() => guardFormNavigation(openCreateForm)}
            disabled={listUnavailable}
            title={listUnavailable ? "You do not have access to this SharePoint list" : undefined}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            Add entry
          </button>
        )}
      </header>

      {pickerOpen ? (
        <div className="rounded-xl border border-border bg-surface p-6">
          <div className="mb-4 text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-fg-muted">
              Product family
            </div>
            <p className="mt-1 text-sm text-fg-muted">
              Choose a product family to open its defect log.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {families.map((family) => (
              <button
                key={family}
                type="button"
                onClick={() => selectFamily(family)}
                className="rounded-lg border border-border bg-surface-2 px-4 py-4 text-sm font-medium text-fg transition-colors hover:border-accent hover:bg-accent hover:text-white"
              >
                {family}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => guardFormNavigation(() => setPickerOpen(true))}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-surface-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Change product family
        </button>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-fg">
            <div className="flex min-w-0 items-center gap-2">
              <Plus className="h-4 w-4 shrink-0 text-accent" />
              <span className="min-w-0">
                {isReadOnly ? "Viewing entry (read-only)" : editingId ? "Edit entry" : "Add new entry using the workbook headers"}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isReadOnly && (
                <button
                  type="button"
                  onClick={() => setIsReadOnly(false)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
              )}
              <button
                type="button"
                onClick={closeForm}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-surface-2"
              >
                {isReadOnly ? "Close" : "Cancel"}
              </button>
            </div>
          </div>
          <fieldset disabled={isReadOnly} className="m-0 border-0 p-0 disabled:opacity-70">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              Work Order
              <input
                value={draft.workOrder}
                onChange={(e) => updateField("workOrder", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              <span>
                Date Tested <span className="text-cooper-red">*</span>
              </span>
              <input
                type="datetime-local"
                value={toDateTimeInputValue(draft.dateTested)}
                onChange={(e) => {
                  const value = e.target.value;
                  if (!value) {
                    updateField("dateTested", "");
                    return;
                  }
                  const parsed = new Date(value);
                  updateField("dateTested", Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString());
                }}
                className={`rounded-md border bg-surface-2 px-3 py-2 text-fg ${
                  dateTestedInvalid ? "border-cooper-red" : "border-border"
                }`}
              />
              {dateTestedInvalid && <span className="text-xs text-cooper-red">Date tested is required.</span>}
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              Operator
              <input
                value={draft.operator}
                onChange={(e) => updateField("operator", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              Old Number
              <input
                value={draft.oldNumber}
                onChange={(e) => updateField("oldNumber", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              SAP Number
              <input
                value={draft.sapNumber}
                onChange={(e) => updateField("sapNumber", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              Revision No Firmware Date
              <input
                value={draft.revisionNoFirmwareDate}
                onChange={(e) => updateField("revisionNoFirmwareDate", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              Quantity Tested
              <input
                type="number"
                value={draft.quantityTested}
                onChange={(e) => updateField("quantityTested", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              Quantity Rejected
              <input
                type="number"
                value={draft.quantityRejected}
                onChange={(e) => updateField("quantityRejected", e.target.value)}
                className={`rounded-md border bg-surface-2 px-3 py-2 text-fg ${
                  quantityRejectedMismatch ? "border-cooper-red" : "border-border"
                }`}
              />
              {quantityRejectedMismatch && (
                <span className="text-xs text-cooper-red">
                  Must equal the sum of the defect fields below (currently {defectFieldsTotal}).
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              Process Solder Defect
              <input
                type="number"
                value={draft.processSolderDefect}
                onChange={(e) => updateField("processSolderDefect", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              AE Solder Defect
              <input
                type="number"
                value={draft.aeSolderDefect}
                onChange={(e) => updateField("aeSolderDefect", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              AE Wiring Deficiency
              <input
                type="number"
                value={draft.aeWiringDeficiency}
                onChange={(e) => updateField("aeWiringDeficiency", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              AE Wrong or Missing Component
              <input
                type="number"
                value={draft.aeWrongOrMissingComponent}
                onChange={(e) => updateField("aeWrongOrMissingComponent", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              AE Assembly Deficiency
              <input
                type="number"
                value={draft.aeAssemblyDeficiency}
                onChange={(e) => updateField("aeAssemblyDeficiency", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              AE Identification Deficiency
              <input
                type="number"
                value={draft.aeIdentificationDeficiency}
                onChange={(e) => updateField("aeIdentificationDeficiency", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              ProgrammingFirmware
              <input
                type="number"
                value={draft.programmingFirmware}
                onChange={(e) => updateField("programmingFirmware", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              CoatingPotting Deficiency
              <input
                type="number"
                value={draft.coatingPottingDeficiency}
                onChange={(e) => updateField("coatingPottingDeficiency", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              Machine Part Placement Deficiency
              <input
                type="number"
                value={draft.machinePartPlacementDeficiency}
                onChange={(e) => updateField("machinePartPlacementDeficiency", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              Physical Damage
              <input
                type="number"
                value={draft.physicalDamage}
                onChange={(e) => updateField("physicalDamage", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              NCM Vendor
              <input
                type="number"
                value={draft.ncmVendor}
                onChange={(e) => updateField("ncmVendor", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              NCM Internal
              <input
                type="number"
                value={draft.ncmInternal}
                onChange={(e) => updateField("ncmInternal", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex items-center gap-3 text-sm text-fg-muted">
              <span>To RP</span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.toRP === "1"}
                onClick={() => updateField("toRP", draft.toRP === "1" ? "0" : "1")}
                className={`relative box-border h-6 w-11 shrink-0 rounded-full border p-0 transition-colors ${
                  draft.toRP === "1" ? "border-accent bg-accent" : "border-border bg-border"
                }`}
              >
                <span
                  className={`absolute left-0 top-1 box-border h-4 w-4 rounded-full transition-transform ${
                    draft.toRP === "1" ? "translate-x-6 bg-black" : "translate-x-1 bg-white"
                  }`}
                />
              </button>
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              Other
              <input
                type="number"
                value={draft.other}
                onChange={(e) => updateField("other", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
          </div>
          <label className="mt-3 flex flex-col gap-1 text-sm text-fg-muted">
            Comments
            <textarea
              value={draft.comments}
              onChange={(e) => updateField("comments", e.target.value)}
              rows={5}
              className="min-h-32 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-base text-fg sm:text-sm"
            />
          </label>
          </fieldset>
          {!isReadOnly && (
          <div className="mt-4 flex flex-col items-end gap-2">
            {!canSubmitForm && (
              <p className="text-xs text-cooper-red">
                Fix the highlighted fields above before saving.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeForm}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmitForm}
                title={canSubmitForm ? undefined : "Fix the highlighted fields before saving"}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent"
              >
                {editingId ? "Save changes" : "Save entry"}
              </button>
            </div>
          </div>
          )}
        </form>
      )}

      {!pickerOpen && !showForm && (
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-3">
          <h2 className="min-w-0 truncate font-medium text-fg">{selectedFamily} entries</h2>
          <span className="shrink-0 text-xs uppercase tracking-[0.2em] text-fg-muted">
            {isLoading ? "loading…" : `${visibleRecords.length}${filterText ? ` of ${records.length}` : ""} records`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <label className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
            <input
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              placeholder="Filter all fields"
              aria-label="Filter all fields"
              className="w-full rounded-md border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          {filterText && (
            <button
              type="button"
              onClick={() => setFilterText("")}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-fg-muted hover:bg-surface-2"
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </button>
          )}
          <button
            type="button"
            onClick={() => setDefectsExpanded((expanded) => !expanded)}
            aria-pressed={defectsExpanded}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-fg-muted hover:bg-surface-2"
          >
            {defectsExpanded ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
            {defectsExpanded ? "Collapse defects" : "Show defect breakdown"}
          </button>
        </div>

        {listUnavailable ? (
          <div className="border-t border-border p-4">
            <ListAccessNotice list={`${selectedFamily} Ignition QC`} site="Altronic_Engineering" onRetry={() => void refetch()} />
          </div>
        ) : error ? (
          <div className="border-t border-border bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            Failed to load records: {error instanceof Error ? error.message : "unknown error"}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex items-center justify-center px-4 py-8 text-sm text-fg-muted">
            Loading records…
          </div>
        ) : listUnavailable ? null : visibleRecords.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-8 text-sm text-fg-muted">
            {filterText ? "No records match the current filter." : `No records for ${selectedFamily}. Click "Add entry" to create one.`}
          </div>
        ) : (
          <>
          {/* Card list — small screens. Same data and tap targets as the table, stacked instead of columned. */}
          <div className="grid gap-3 p-3 md:hidden">
            {visibleRecords.map((record) => {
              const totalDefects = defectTotal(record);
              return (
                <div
                  key={record.id}
                  onClick={() => guardFormNavigation(() => openViewForm(record))}
                  className="rounded-lg border border-border bg-surface-2 p-3 active:bg-surface-2/70"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-fg">{record.workOrder}</div>
                      <div className="mt-0.5 truncate text-xs text-fg-muted">
                        {formatDateOnly(record.dateTested)}
                        {record.operator ? ` · ${record.operator}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Edit ${record.workOrder}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        guardFormNavigation(() => openEditForm(record));
                      }}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-fg"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-fg-muted">
                    <div>Old No <span className="text-fg">{record.oldNumber || "—"}</span></div>
                    <div>SAP No <span className="text-fg">{record.sapNumber || "—"}</span></div>
                    <div>Qty Tested <span className="text-fg">{record.quantityTested}</span></div>
                    <div>Qty Rejected <span className="text-fg">{record.quantityRejected}</span></div>
                  </div>

                  {defectsExpanded && (
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-fg-muted">
                      {DEFECT_COLUMNS.map(({ key, label }) => (
                        <div key={key}>
                          {label} <span className="text-fg">{record[key]}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                    <span className={`text-xs font-medium ${totalDefects > 0 ? "text-cooper-red" : "text-fg-muted"}`}>
                      {totalDefects > 0 ? `${totalDefects} defect${totalDefects === 1 ? "" : "s"}` : "0 defects"}
                    </span>
                    <div className="flex items-center gap-3">
                      <span
                        title={record.toRP === 1 ? "To RP: on" : "To RP: off"}
                        aria-label={record.toRP === 1 ? "To RP on" : "To RP off"}
                        className={`inline-block h-3 w-3 rounded-full border border-border ${
                          record.toRP === 1 ? "bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.9)]" : "bg-surface"
                        }`}
                      />
                      <span
                        aria-label={record.comments || "No comments"}
                        className={`relative select-none ${record.comments ? "text-accent" : "text-fg-muted/50"}`}
                        onTouchStart={(event) => {
                          event.stopPropagation();
                          startCommentPreview(record.id);
                        }}
                        onTouchEnd={(event) => endCommentPreview(record.id, event)}
                        onTouchCancel={clearCommentPressTimer}
                        onContextMenu={(event) => event.preventDefault()}
                      >
                        <MessageSquare className="h-4 w-4" />
                        {commentPreviewId === record.id && (
                          <div className="absolute bottom-full right-0 z-10 mb-2 w-56 max-w-[70vw] rounded-md border border-border bg-surface p-2 text-left text-xs font-normal text-fg shadow-lg">
                            {record.comments || "No comments"}
                          </div>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Table — tablet and up. */}
          <div className="hidden overflow-hidden md:block">
            <table className="w-full table-fixed text-left">
              <thead className="bg-surface-2 text-fg-muted">
                <tr>
                  {CORE_COLUMNS.map(({ key, label }) => (
                    <th
                      key={key}
                      className={`min-w-0 ${headClass} ${key === "workOrder" ? "w-[9%]" : ""}`}
                      aria-sort={sortKey === key ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        className="inline-flex max-w-full items-center gap-0.5 text-left font-semibold hover:text-fg"
                        title={`Sort by ${label}`}
                      >
                        <span className="truncate">{label}</span>
                        <span className="shrink-0">{sortIcon(key)}</span>
                      </button>
                    </th>
                  ))}

                  {defectsExpanded ? (
                    <>
                      {DEFECT_COLUMNS.map(({ key, label }) => (
                        <th
                          key={key}
                          className={`min-w-0 ${headClass}`}
                          aria-sort={sortKey === key ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(key)}
                            className="inline-flex max-w-full items-center gap-0.5 text-left font-semibold hover:text-fg"
                            title={`Sort by ${label}`}
                          >
                            <span className="truncate">{label}</span>
                            <span className="shrink-0">{sortIcon(key)}</span>
                          </button>
                        </th>
                      ))}
                      <th className={`${headClass} w-[3%]`}>To RP</th>
                    </>
                  ) : (
                    <th className={`${headClass} w-[10%]`}>Defects</th>
                  )}

                  <th className={`${headClass} w-[3%]`}>Comments</th>
                  <th className={`${headClass} w-[3%] text-right`}>Edit</th>
                </tr>
              </thead>
              <tbody>
                {visibleRecords.map((record) => {
                  const totalDefects = defectTotal(record);
                  return (
                    <tr
                      key={record.id}
                      className="cursor-pointer border-t border-border align-top hover:bg-surface-2/60"
                      onClick={() => guardFormNavigation(() => openViewForm(record))}
                    >
                      <td className={`max-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${cellClass} font-medium text-fg`} title={record.workOrder}>
                        {record.workOrder}
                      </td>
                      <td className={`max-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${cellClass} text-fg-muted`}>
                        {formatDateOnly(record.dateTested)}
                      </td>
                      <td className={`max-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${cellClass}`} title={record.operator}>
                        {record.operator}
                      </td>
                      <td className={`max-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${cellClass}`} title={record.oldNumber}>
                        {record.oldNumber}
                      </td>
                      <td className={`max-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${cellClass}`} title={record.sapNumber}>
                        {record.sapNumber}
                      </td>
                      <td className={`max-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${cellClass}`} title={record.revisionNoFirmwareDate}>
                        {record.revisionNoFirmwareDate}
                      </td>
                      <td className={`max-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${cellClass}`}>{record.quantityTested}</td>
                      <td className={`max-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${cellClass}`}>{record.quantityRejected}</td>

                      {defectsExpanded ? (
                        <>
                          <td className={cellClass}>{record.processSolderDefect}</td>
                          <td className={cellClass}>{record.aeSolderDefect}</td>
                          <td className={cellClass}>{record.aeWiringDeficiency}</td>
                          <td className={cellClass}>{record.aeWrongOrMissingComponent}</td>
                          <td className={cellClass}>{record.aeAssemblyDeficiency}</td>
                          <td className={cellClass}>{record.aeIdentificationDeficiency}</td>
                          <td className={cellClass}>{record.programmingFirmware}</td>
                          <td className={cellClass}>{record.coatingPottingDeficiency}</td>
                          <td className={cellClass}>{record.machinePartPlacementDeficiency}</td>
                          <td className={cellClass}>{record.physicalDamage}</td>
                          <td className={cellClass}>{record.ncmVendor}</td>
                          <td className={cellClass}>{record.ncmInternal}</td>
                          <td className={cellClass}>{record.other ?? 0}</td>
                          <td className={`${cellClass} text-center`}>
                            <span
                              title={record.toRP === 1 ? "To RP: on" : "To RP: off"}
                              aria-label={record.toRP === 1 ? "To RP on" : "To RP off"}
                              className={`inline-block h-3 w-3 rounded-full border border-border ${
                                record.toRP === 1 ? "bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.9)]" : "bg-surface-2"
                              }`}
                            />
                          </td>
                        </>
                      ) : (
                        // Collapsed summary cell — plain text, not clickable. Use the toggle button to expand.
                        <td className={`${cellClass} font-medium ${totalDefects > 0 ? "text-cooper-red" : "text-fg-muted"}`}>
                          {totalDefects > 0 ? `${totalDefects} defect${totalDefects === 1 ? "" : "s"}` : "0 defects"}
                        </td>
                      )}

                      <td className={`${cellClass} text-center`}>
                        <span
                          title={record.comments || "No comments"}
                          aria-label={record.comments || "No comments"}
                          className={record.comments ? "text-accent" : "text-fg-muted/50"}
                        >
                          <MessageSquare className="mx-auto h-4 w-4" />
                        </span>
                      </td>
                      <td className={`${cellClass} text-right`}>
                        <button
                          type="button"
                          aria-label={`Edit ${record.workOrder}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            guardFormNavigation(() => openEditForm(record));
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-2 text-fg hover:bg-surface"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
      )}

      {pendingProceed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-fg">Save changes to this entry?</h3>
            <p className="mt-1.5 text-sm text-fg-muted">
              {editingId
                ? "You've made changes to this entry that haven't been saved yet."
                : "You've started a new entry that hasn't been saved yet."}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleConfirmSave}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
              >
                Save changes
              </button>
              <button
                type="button"
                onClick={handleConfirmDiscard}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-surface-2"
              >
                Discard changes
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                className="rounded-md px-4 py-2 text-sm font-medium text-fg-muted hover:bg-surface-2"
              >
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}