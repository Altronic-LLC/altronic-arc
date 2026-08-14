import { useState } from "react";
import { Pencil, Plus, TestTubes } from "lucide-react";
import { DIGITAL_QC_FAMILY_LIST_IDS } from "@/api/digitalQc";
import {
  useCreateDigitalQcRecord,
  useListDigitalQcRecords,
  useUpdateDigitalQcRecord,
} from "@/hooks/useDigitalQc";
import type { DigitalQcRecord } from "@/lib/digitalQc";

type ProductFamily = keyof typeof DIGITAL_QC_FAMILY_LIST_IDS;

const DEFAULT_FORM = {
  workOrder: "",
  dateTested: new Date().toISOString(),
  operator: "",
  oldNumber: "",
  sapNumber: "",
  revisionNoFirmwareDate: "",
  quantityTested: "",
  quantityRejected: "",
  processSolderDefect: "",
  aeSolderDefect: "",
  aeWiringDeficiency: "",
  aeWrongOrMissingComponent: "",
  aeAssemblyDeficiency: "",
  aeIdentificationDeficiency: "",
  programmingFirmware: "",
  coatingPottingDeficiency: "",
  machinePartPlacementDeficiency: "",
  physicalDamage: "",
  ncmVendor: "",
  ncmInternal: "",
};

export function DigitalQcView() {
  const [selectedFamily, setSelectedFamily] = useState<ProductFamily>("DE Terminal");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(DEFAULT_FORM);

  const { data: records = [], isLoading, error } = useListDigitalQcRecords(selectedFamily);
  const createMutation = useCreateDigitalQcRecord(selectedFamily);
  const updateMutation = useUpdateDigitalQcRecord(selectedFamily);

  const families = Object.keys(DIGITAL_QC_FAMILY_LIST_IDS) as ProductFamily[];

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

  function compactValue(value: string | number): string {
    const text = String(value ?? "");
    return text.length > 10 ? `${text.slice(0, 9)}…` : text;
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
        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          Add entry
        </button>
      </header>

      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-fg-muted">
          Product family
        </div>
        <div className="flex flex-wrap gap-2">
          {families.map((family) => (
            <button
              key={family}
              type="button"
              onClick={() => setSelectedFamily(family)}
              className={
                "rounded-md border px-3 py-2 text-sm font-medium transition-colors " +
                (selectedFamily === family
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-surface-2 text-fg hover:bg-surface")
              }
            >
              {family}
            </button>
          ))}
        </div>
      </div>

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
              Physical Damge
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
          </div>
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

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-3">
          <h2 className="font-medium text-fg">{selectedFamily} entries</h2>
          <span className="text-xs uppercase tracking-[0.2em] text-fg-muted">
            {isLoading ? "loading…" : `${records.length} records`}
          </span>
        </div>

        {error && (
          <div className="border-t border-border bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            Failed to load records: {error instanceof Error ? error.message : "unknown error"}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center px-4 py-8 text-sm text-fg-muted">
            Loading records…
          </div>
        ) : records.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-8 text-sm text-fg-muted">
            No records for {selectedFamily}. Click "Add entry" to create one.
          </div>
        ) : (
          <div className="overflow-hidden">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="bg-surface-2 text-fg-muted">
                <tr>
                  <th className="px-1.5 py-2">Work Order</th>
                  <th className="px-1.5 py-2">Date Tested</th>
                  <th className="px-1.5 py-2">Operator</th>
                  <th className="px-1.5 py-2">Old No</th>
                  <th className="px-1.5 py-2">SAP No</th>
                  <th className="px-1.5 py-2">Rev Date</th>
                  <th className="px-1.5 py-2">Qty Test</th>
                  <th className="px-1.5 py-2">Qty Reject</th>
                  <th className="px-1.5 py-2">Proc</th>
                  <th className="px-1.5 py-2">AE Sold</th>
                  <th className="px-1.5 py-2">AE Wiring</th>
                  <th className="px-1.5 py-2">AE Miss</th>
                  <th className="px-1.5 py-2">AE Assy</th>
                  <th className="px-1.5 py-2">AE ID</th>
                  <th className="px-1.5 py-2">Prog</th>
                  <th className="px-1.5 py-2">Coat</th>
                  <th className="px-1.5 py-2">Machine</th>
                  <th className="px-1.5 py-2">Damage</th>
                  <th className="px-1.5 py-2">NCM Vend</th>
                  <th className="px-1.5 py-2">NCM Int</th>
                  <th className="w-12 px-1.5 py-2 text-right">Edit</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                <tr
                  key={record.id}
                  className="cursor-pointer border-t border-border align-top hover:bg-surface-2/60"
                  onClick={() => openEditForm(record)}
                >
                  <td className="px-1.5 py-1.5 font-medium text-fg">{compactValue(record.workOrder)}</td>
                  <td className="px-1.5 py-1.5 text-fg-muted">{formatDateOnly(record.dateTested)}</td>
                  <td className="px-1.5 py-1.5">{compactValue(record.operator)}</td>
                  <td className="px-1.5 py-1.5">{compactValue(record.oldNumber)}</td>
                  <td className="px-1.5 py-1.5">{compactValue(record.sapNumber)}</td>
                  <td className="px-1.5 py-1.5">{compactValue(record.revisionNoFirmwareDate)}</td>
                  <td className="px-1.5 py-1.5">{record.quantityTested}</td>
                  <td className="px-1.5 py-1.5">{record.quantityRejected}</td>
                  <td className="px-1.5 py-1.5">{record.processSolderDefect}</td>
                  <td className="px-1.5 py-1.5">{record.aeSolderDefect}</td>
                  <td className="px-1.5 py-1.5">{record.aeWiringDeficiency}</td>
                  <td className="px-1.5 py-1.5">{record.aeWrongOrMissingComponent}</td>
                  <td className="px-1.5 py-1.5">{record.aeAssemblyDeficiency}</td>
                  <td className="px-1.5 py-1.5">{record.aeIdentificationDeficiency}</td>
                  <td className="px-1.5 py-1.5">{record.programmingFirmware}</td>
                  <td className="px-1.5 py-1.5">{record.coatingPottingDeficiency}</td>
                  <td className="px-1.5 py-1.5">{record.machinePartPlacementDeficiency}</td>
                  <td className="px-1.5 py-1.5">{record.physicalDamage}</td>
                  <td className="px-1.5 py-1.5">{record.ncmVendor}</td>
                  <td className="px-1.5 py-1.5">{record.ncmInternal}</td>
                  <td className="w-12 px-1.5 py-1.5 text-right">
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
    </div>
  );
}
