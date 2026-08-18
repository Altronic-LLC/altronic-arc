import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  TestTubes,
  X,
} from "lucide-react";
import { DIGITAL_QC_FAMILY_LIST_IDS } from "@/api/digitalQc";
import {
  useCreateDigitalQcRecord,
  useListDigitalQcRecords,
  useUpdateDigitalQcRecord,
} from "@/hooks/useDigitalQc";
import type { DigitalQcRecord } from "@/lib/digitalQc";

type ProductFamily = keyof typeof DIGITAL_QC_FAMILY_LIST_IDS;
type SortKey = keyof Omit<DigitalQcRecord, "id" | "productFamily">;

const SORTABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "workOrder", label: "Work Order" },
  { key: "dateTested", label: "Date Tested" },
  { key: "operator", label: "Operator" },
  { key: "oldNumber", label: "Old No" },
  { key: "sapNumber", label: "SAP No" },
  { key: "revisionNoFirmwareDate", label: "Rev Date" },
  { key: "startSN", label: "StartSN" },
  { key: "endSN", label: "EndSN" },
  { key: "quantityTested", label: "Qty Test" },
  { key: "quantityRejected", label: "Qty Reject" },
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
  { key: "toRP", label: "To RP" },
  { key: "other", label: "Other" },
  { key: "comments", label: "Comments" },
];

const PYROMETER_MATERIALS = ["378-1443", "357-4880", "343-4631"] as const;

const DEFAULT_FORM = {
  workOrder: "",
  dateTested: new Date().toISOString(),
  operator: "",
  oldNumber: "",
  sapNumber: "",
  revisionNoFirmwareDate: "",
  startSN: "",
  endSN: "",
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

export function DigitalQcView() {
  const [selectedFamily, setSelectedFamily] = useState<ProductFamily>("DE Terminal");
  const [pickerOpen, setPickerOpen] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(DEFAULT_FORM);
  const [filterText, setFilterText] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("dateTested");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const { data: records = [], isLoading, error } = useListDigitalQcRecords(selectedFamily);
  const createMutation = useCreateDigitalQcRecord(selectedFamily);
  const updateMutation = useUpdateDigitalQcRecord(selectedFamily);

  const families = Object.keys(DIGITAL_QC_FAMILY_LIST_IDS) as ProductFamily[];

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

  const pyrometerSerialSummary = useMemo(() => {
    const summary = Object.fromEntries(PYROMETER_MATERIALS.map((material) => [material, ""])) as Record<
      (typeof PYROMETER_MATERIALS)[number],
      string
    >;

    if (selectedFamily !== "Pyrometer") return summary;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const highestByMaterial = new Map<string, number>();

    for (const record of records) {
      const testedAt = new Date(record.dateTested);
      const endSerial = Number(record.endSN?.trim() ?? "");
      if (
        !Number.isNaN(testedAt.getTime()) &&
        testedAt >= monthStart &&
        testedAt < nextMonthStart &&
        PYROMETER_MATERIALS.includes(record.oldNumber as (typeof PYROMETER_MATERIALS)[number]) &&
        Number.isFinite(endSerial)
      ) {
        const previous = highestByMaterial.get(record.oldNumber) ?? -Infinity;
        if (endSerial > previous) highestByMaterial.set(record.oldNumber, endSerial);
      }
    }

    for (const material of PYROMETER_MATERIALS) {
      const latestSerial = highestByMaterial.get(material);
      if (latestSerial !== undefined) summary[material] = String(latestSerial);
    }

    return summary;
  }, [records, selectedFamily]);

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

  function toDraft(record?: DigitalQcRecord): typeof DEFAULT_FORM {
    if (!record) {
      return DEFAULT_FORM;
    }

    return {
      workOrder: record.workOrder,
      dateTested: record.dateTested,
      operator: record.operator,
      oldNumber: record.oldNumber,
      sapNumber: record.sapNumber,
      revisionNoFirmwareDate: record.revisionNoFirmwareDate,
      startSN: record.startSN ?? "",
      endSN: record.endSN ?? "",
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
    setEditingId(null);
    setDraft(toDraft());
    setShowForm(true);
  }

  function openEditForm(record: DigitalQcRecord) {
    setEditingId(record.id);
    setDraft(toDraft(record));
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setDraft(toDraft());
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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const recordData = {
      workOrder: draft.workOrder || "N/A",
      dateTested: draft.dateTested || new Date().toISOString(),
      operator: draft.operator || "",
      oldNumber: draft.oldNumber || "",
      sapNumber: draft.sapNumber || "",
      revisionNoFirmwareDate: draft.revisionNoFirmwareDate || "",
      startSN: draft.startSN || "",
      endSN: draft.endSN || "",
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

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <TestTubes className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Digital QC Defect Log
          </h1>
          <p className="text-sm text-fg-muted">
            Product family overview from the workbook, with the DE Terminal sheet loaded when selected.
          </p>
        </div>
        {!pickerOpen && (
          <button
            type="button"
            onClick={openCreateForm}
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
          onClick={() => setPickerOpen(true)}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-surface-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Change product family
        </button>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-2 text-sm font-medium text-fg">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-accent" />
              {editingId ? "Edit entry" : "Add new entry using the workbook headers"}
            </div>
            <button
              type="button"
              onClick={closeForm}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
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
              Date Tested
              <input
                type="datetime-local"
                value={draft.dateTested.slice(0, 16)}
                onChange={(e) => updateField("dateTested", new Date(e.target.value).toISOString())}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
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
              StartSN
              <input
                value={draft.startSN}
                onChange={(e) => updateField("startSN", e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">
              EndSN
              <input
                value={draft.endSN}
                onChange={(e) => updateField("endSN", e.target.value)}
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
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
              />
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
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  draft.toRP === "1" ? "bg-accent" : "bg-border"
                }`}
              >
                <span
                  className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
                    draft.toRP === "1" ? "translate-x-6" : "translate-x-1"
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
              className="min-h-32 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-fg"
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              {editingId ? "Save changes" : "Save entry"}
            </button>
          </div>
        </form>
      )}

      {!pickerOpen && (
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-3">
          <h2 className="font-medium text-fg">{selectedFamily} entries</h2>
          <span className="text-xs uppercase tracking-[0.2em] text-fg-muted">
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
        </div>

        {selectedFamily === "Pyrometer" && (
          <div className="grid grid-cols-1 gap-2 border-b border-border px-4 py-3 sm:grid-cols-3">
            {PYROMETER_MATERIALS.map((material) => (
              <div key={material} className="rounded-md border border-border bg-surface-2 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
                  Old Material {material}
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-fg">
                  {pyrometerSerialSummary[material]}
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="border-t border-border bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            Failed to load records: {error instanceof Error ? error.message : "unknown error"}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center px-4 py-8 text-sm text-fg-muted">
            Loading records…
          </div>
        ) : visibleRecords.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-8 text-sm text-fg-muted">
            {filterText ? "No records match the current filter." : `No records for ${selectedFamily}. Click "Add entry" to create one.`}
          </div>
        ) : (
          <div className="overflow-hidden">
            <table className="w-full table-fixed text-left text-[10px]">
              <thead className="bg-surface-2 text-fg-muted">
                <tr>
                  {SORTABLE_COLUMNS.map(({ key, label }) => (
                    <th
                      key={key}
                      className={`min-w-0 px-1 py-2 ${key === "workOrder" ? "w-[7%]" : ""} ${
                        key === "toRP" || key === "comments" ? "w-[3%] px-0" : ""
                      }`}
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
                  <th className="w-[3%] px-0 py-2 text-right">Edit</th>
                </tr>
              </thead>
              <tbody>
                {visibleRecords.map((record) => (
                <tr
                  key={record.id}
                  className="cursor-pointer border-t border-border align-top hover:bg-surface-2/60"
                  onClick={() => openEditForm(record)}
                >
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5 font-medium text-fg" title={record.workOrder}>{record.workOrder}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5 text-fg-muted">{formatDateOnly(record.dateTested)}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5" title={record.operator}>{record.operator}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5" title={record.oldNumber}>{record.oldNumber}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5" title={record.sapNumber}>{record.sapNumber}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5" title={record.revisionNoFirmwareDate}>{record.revisionNoFirmwareDate}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5" title={record.startSN ?? ""}>{record.startSN ?? ""}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5" title={record.endSN ?? ""}>{record.endSN ?? ""}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.quantityTested}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.quantityRejected}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.processSolderDefect}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.aeSolderDefect}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.aeWiringDeficiency}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.aeWrongOrMissingComponent}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.aeAssemblyDeficiency}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.aeIdentificationDeficiency}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.programmingFirmware}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.coatingPottingDeficiency}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.machinePartPlacementDeficiency}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.physicalDamage}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.ncmVendor}</td>
                  <td className="max-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1 py-1.5">{record.ncmInternal}</td>
                  <td className="w-[3%] px-0 py-1.5 text-center">
                    <span
                      title={record.toRP === 1 ? "To RP: on" : "To RP: off"}
                      aria-label={record.toRP === 1 ? "To RP on" : "To RP off"}
                      className={`inline-block h-3 w-3 rounded-full border border-border ${
                        record.toRP === 1 ? "bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.9)]" : "bg-surface-2"
                      }`}
                    />
                  </td>
                  <td className="px-1.5 py-1.5">{record.other ?? 0}</td>
                  <td className="w-[3%] px-0 py-1.5 text-center">
                    <span
                      title={record.comments || "No comments"}
                      aria-label={record.comments || "No comments"}
                      className={record.comments ? "text-accent" : "text-fg-muted/50"}
                    >
                      <MessageSquare className="mx-auto h-4 w-4" />
                    </span>
                  </td>
                  <td className="w-[3%] px-0 py-1.5 text-right">
                    <button
                      type="button"
                      aria-label={`Edit ${record.workOrder}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditForm(record);
                      }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-2 text-fg hover:bg-surface"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
