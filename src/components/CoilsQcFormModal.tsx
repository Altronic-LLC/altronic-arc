import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { DateField } from "@/components/DateField";
import { SingleSelect } from "@/components/SearchableSelect";
import {
  COIL_DEFECT_FIELDS,
  type CoilDefectField,
  type CoilDefectLogEntry,
  type CoilDefectLogInput,
  type OtherFaultTableRow,
  parseOtherFaults,
  serializeOtherFaults,
} from "@/lib/coilsQc";

interface CoilsQcFormModalProps {
  entry: CoilDefectLogEntry | null;
  partNumbers: string[];
  otherFaults: string[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: CoilDefectLogInput) => Promise<void>;
  onAddPartNumber: (partNumber: string) => Promise<void>;
  onAddOtherFault: (fault: string) => Promise<void>;
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function blankDefects(): Record<CoilDefectField, number> {
  return Object.fromEntries(COIL_DEFECT_FIELDS.map((field) => [field, 0])) as Record<
    CoilDefectField,
    number
  >;
}

function initialDraft(entry: CoilDefectLogEntry | null): CoilDefectLogInput {
  return entry
    ? { ...entry, defects: { ...entry.defects } }
    : { coilPartNumber: "", date: todayIso(), produced: 0, failed: 0, defects: blankDefects(), otherFaultTable: "" };
}

function labelFor(field: CoilDefectField): string {
  return field.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function CoilsQcFormModal({
  entry,
  partNumbers,
  isSaving,
  onClose,
  onSave,
  onAddPartNumber,
  onAddOtherFault,
  otherFaults,
}: CoilsQcFormModalProps) {
  const [draft, setDraft] = useState(() => initialDraft(entry));
  const [otherRows, setOtherRows] = useState<OtherFaultTableRow[]>(() => parseOtherFaults(entry?.otherFaultTable ?? "") ?? []);
  const [showAddPart, setShowAddPart] = useState(false);
  const [showAddOtherFault, setShowAddOtherFault] = useState(false);
  const [newOtherFault, setNewOtherFault] = useState("");
  const [newPartNumber, setNewPartNumber] = useState("");
  const [addingPart, setAddingPart] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(initialDraft(entry));
    setOtherRows(parseOtherFaults(entry?.otherFaultTable ?? "") ?? []);
  }, [entry]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const defectCount = Object.values(draft.defects).reduce((total, count) => total + count, 0);
  const failedMismatch = draft.failed !== defectCount;
  const otherFaultCount = otherRows.reduce((total, row) => total + row.Count, 0);
  const otherFaultMismatch = draft.defects.Other > 0 && otherFaultCount !== draft.defects.Other;

  function setDefect(field: CoilDefectField, value: string) {
    const count = Math.max(0, Number(value) || 0);
    setDraft((current) => ({ ...current, defects: { ...current.defects, [field]: count } }));
  }

  function setOtherRowsAndTable(rows: OtherFaultTableRow[]) {
    setOtherRows(rows);
    setDraft((current) => ({
      ...current,
      otherFaultTable: serializeOtherFaults(rows),
    }));
  }

  async function addPartNumber() {
    const partNumber = newPartNumber.trim();
    if (!partNumber) return;
    setAddingPart(true);
    try {
      await onAddPartNumber(partNumber);
      setDraft((current) => ({ ...current, coilPartNumber: partNumber }));
      setNewPartNumber("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the part number.");
    } finally {
      setAddingPart(false);
    }
  }

  async function addOtherFault() {
    const fault = newOtherFault.trim();
    if (!fault) return;
    try {
      await onAddOtherFault(fault);
      setNewOtherFault("");
      setShowAddOtherFault(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the Other defect.");
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.coilPartNumber || failedMismatch || otherFaultMismatch) return;
    try {
      await onSave(draft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this entry.");
    }
  }

  const options = partNumbers.map((partNumber) => ({ value: partNumber, label: partNumber }));

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface sm:flex sm:items-start sm:justify-center sm:bg-black/50 sm:px-4 sm:py-6" role="presentation">
      <form onSubmit={submit} className="min-h-screen w-full bg-surface sm:min-h-0 sm:max-w-5xl sm:rounded-lg sm:border sm:border-border sm:shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-fg">{entry ? "Edit coil defect entry" : "Add coil defect entry"}</h2>
            <p className="text-sm text-fg-muted">Failed must match the total of the named defect columns.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-2 text-fg-muted hover:bg-surface-2 hover:text-fg"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid gap-5 px-4 py-5 sm:p-5">
          {error && <p className="rounded-md border border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-sm text-cooper-red">{error}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 text-sm text-fg-muted">
              <div className="flex items-center justify-between"><span>Coil part number <span className="text-cooper-red">*</span></span><button type="button" aria-label="Add coil part number" title="Add coil part number" onClick={() => setShowAddPart((show) => !show)} className="rounded p-0.5 text-accent hover:bg-accent/10"><Plus className="h-4 w-4" /></button></div>
              <div className={!draft.coilPartNumber ? "rounded-md ring-1 ring-cooper-red" : undefined}>
                <SingleSelect options={options} selected={draft.coilPartNumber || null} onChange={(value) => setDraft((current) => ({ ...current, coilPartNumber: value ?? "" }))} allLabel="Select part number" searchPlaceholder="Search part numbers" ariaLabel="Coil part number" />
              </div>
              {!draft.coilPartNumber && <span className="text-xs text-cooper-red">Select a coil part number before saving.</span>}
            </div>
            <label className="flex flex-col gap-1 text-sm text-fg-muted">Date<DateField value={draft.date} onChange={(date) => setDraft((current) => ({ ...current, date }))} /></label>
          </div>
          {showAddPart && <div className="flex flex-wrap items-end gap-2 border-b border-border pb-4">
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm text-fg-muted">Add coil part number<input value={newPartNumber} onChange={(event) => setNewPartNumber(event.target.value)} placeholder="New part number" className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg" /></label>
            <button type="button" onClick={addPartNumber} disabled={addingPart || !newPartNumber.trim()} className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"><Plus className="h-4 w-4" />Add part</button>
            <button type="button" onClick={() => { setShowAddPart(false); setNewPartNumber(""); }} aria-label="Cancel adding coil part number" title="Cancel" className="inline-flex h-10 items-center justify-center rounded-md border border-border px-3 text-fg-muted hover:bg-surface-2 hover:text-fg"><X className="h-4 w-4" /></button>
          </div>}
          <section>
            <div className="mb-3 flex items-baseline justify-between gap-3"><h3 className="font-medium text-fg">Defect counts</h3><span className={failedMismatch ? "text-sm font-medium text-cooper-red" : "text-sm text-cooper-green"}>Named total: {defectCount}</span></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {COIL_DEFECT_FIELDS.map((field) => <label key={field} className="flex flex-col gap-1 text-sm text-fg-muted">{labelFor(field)}<input type="number" min="0" value={draft.defects[field]} onChange={(event) => setDefect(field, event.target.value)} className="rounded-md border border-border bg-surface-2 px-3 py-2 text-fg" /></label>)}
              <label className="flex flex-col gap-1 text-sm text-fg-muted">Failed<input type="number" min="0" value={draft.failed} onChange={(event) => setDraft((current) => ({ ...current, failed: Math.max(0, Number(event.target.value) || 0) }))} className={`rounded-md border bg-surface-2 px-3 py-2 text-fg ${failedMismatch ? "border-cooper-red" : "border-border"}`} /></label>
            </div>
            {failedMismatch && <p className="mt-2 text-sm text-cooper-red">Failed is {draft.failed}; named defect total is {defectCount}. Match them before saving.</p>}
          </section>
          {draft.defects.Other > 0 && <section className="relative z-10 rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2"><h3 className="font-medium text-fg">Other faults</h3><button type="button" onClick={() => setOtherRowsAndTable([...otherRows, { Defect: { Value: "" }, Count: 0, Comment: "" }])} className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-surface-2">Add fault</button></div>
            <div className="grid gap-3 p-3 sm:hidden">{otherRows.map((row, index) => <div key={index} className="grid gap-2 rounded-md border border-border bg-surface-2 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium uppercase tracking-wide text-fg-muted">Other fault {index + 1}</span><button type="button" onClick={() => setOtherRowsAndTable(otherRows.filter((_, rowIndex) => rowIndex !== index))} aria-label={`Remove other fault ${index + 1}`} className="rounded-md p-1.5 text-fg-muted hover:bg-cooper-red/10 hover:text-cooper-red"><Trash2 className="h-4 w-4" /></button></div><label className="flex flex-col gap-1 text-sm text-fg-muted">Defect<SingleSelect options={otherFaults.map((fault) => ({ value: fault, label: fault }))} selected={row.Defect.Value || null} onChange={(value) => { const rows = [...otherRows]; rows[index] = { ...row, Defect: { Value: value ?? "" } }; setOtherRowsAndTable(rows); }} allLabel="Select defect" searchPlaceholder="Search other defects" ariaLabel={`Other defect ${index + 1}`} panelPlacement="above" /></label><label className="flex flex-col gap-1 text-sm text-fg-muted">Count<input type="number" min="0" value={row.Count} onChange={(event) => { const rows = [...otherRows]; rows[index] = { ...row, Count: Math.max(0, Number(event.target.value) || 0) }; setOtherRowsAndTable(rows); }} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-fg" /></label><label className="flex flex-col gap-1 text-sm text-fg-muted">Comments<input value={row.Comment} onChange={(event) => { const rows = [...otherRows]; rows[index] = { ...row, Comment: event.target.value }; setOtherRowsAndTable(rows); }} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-fg" /></label></div>)}</div>
            <div className="hidden overflow-x-auto overflow-y-visible sm:block"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-surface-2 text-xs uppercase tracking-wide text-fg-muted"><tr><th className="px-3 py-2">Defect</th><th className="px-3 py-2">Count</th><th className="px-3 py-2">Comments</th><th className="w-12 px-3 py-2"><span className="sr-only">Remove</span></th></tr></thead><tbody>{otherRows.map((row, index) => <tr key={index} className="border-t border-border"><td className="px-3 py-2"><SingleSelect options={otherFaults.map((fault) => ({ value: fault, label: fault }))} selected={row.Defect.Value || null} onChange={(value) => { const rows = [...otherRows]; rows[index] = { ...row, Defect: { Value: value ?? "" } }; setOtherRowsAndTable(rows); }} allLabel="Select defect" searchPlaceholder="Search other defects" ariaLabel={`Other defect ${index + 1}`} panelPlacement="above" /></td><td className="px-3 py-2"><input type="number" min="0" value={row.Count} onChange={(event) => { const rows = [...otherRows]; rows[index] = { ...row, Count: Math.max(0, Number(event.target.value) || 0) }; setOtherRowsAndTable(rows); }} className="w-24 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-fg" /></td><td className="px-3 py-2"><input value={row.Comment} onChange={(event) => { const rows = [...otherRows]; rows[index] = { ...row, Comment: event.target.value }; setOtherRowsAndTable(rows); }} className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-fg" /></td><td className="px-3 py-2"><button type="button" onClick={() => setOtherRowsAndTable(otherRows.filter((_, rowIndex) => rowIndex !== index))} aria-label={`Remove other fault ${index + 1}`} className="rounded-md p-1.5 text-fg-muted hover:bg-cooper-red/10 hover:text-cooper-red"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>
            {otherRows.length === 0 && <p className="px-3 py-4 text-sm text-fg-muted">No other faults recorded.</p>}
            {otherFaultMismatch && <p className="border-t border-cooper-red/30 bg-cooper-red/10 px-3 py-2 text-sm text-cooper-red">Other is {draft.defects.Other}; Other fault counts total {otherFaultCount}. Match them before saving.</p>}
            <div className="border-t border-border px-3 py-2"><button type="button" onClick={() => setShowAddOtherFault((show) => !show)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-surface-2"><Plus className="h-3.5 w-3.5" />Add new defect type</button>{showAddOtherFault && <div className="mt-2 flex items-center gap-2"><input value={newOtherFault} onChange={(event) => setNewOtherFault(event.target.value)} placeholder="New Other defect" className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-fg" /><button type="button" onClick={addOtherFault} disabled={!newOtherFault.trim()} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-2 disabled:opacity-50">Add</button></div>}</div>
          </section>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-5 py-4"><button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-fg-muted hover:bg-surface-2">Cancel</button><button type="submit" disabled={isSaving || !draft.coilPartNumber || failedMismatch || otherFaultMismatch} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50">{isSaving ? "Saving..." : "Save entry"}</button></footer>
      </form>
    </div>
  );
}
