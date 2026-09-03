import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, Loader2, Plus, Printer, X } from "lucide-react";
import { ChoiceSelect } from "./SearchableSelect";
import { DateField } from "./DateField";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { PersonMultiField } from "./PersonMultiField";
import { fromDateInputValue, toDateInputValue } from "@/lib/spDates";
import { useCreatePanelQcDefect, useCreatePanelQcIssue, usePanelQcDefects, useUpdatePanelQcIssue } from "@/hooks/usePanelQcIssues";
import type { PanelQcIssue, PanelQcIssueInput } from "@/types/task";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { mergePeople } from "@/lib/people";

const emptyInput: PanelQcIssueInput = {
  panelSerialNumber: "", date: null, partNumber: "", partDescription: "", serialReferenceNote: "",
  defectCategory: null, comments: "", correctiveAction: "", productionTechnician: "",
  productionRepairNotes: "", productionResolution: "",
  communication: "", watchers: [], tagNumber: "",
};

function localTodayAsSpDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12));
}

interface Props { issue?: PanelQcIssue; onClose: () => void; }

export function PanelQcIssueFormModal({ issue, onClose }: Props) {
  const create = useCreatePanelQcIssue();
  const update = useUpdatePanelQcIssue();
  const addDefect = useCreatePanelQcDefect();
  const { data: defects = [], error: defectsError } = usePanelQcDefects();
  const directory = useDirectoryPeople();
  const [draft, setDraft] = useState<PanelQcIssueInput>(() => issue ? { ...issue } : { ...emptyInput, date: localTodayAsSpDate() });
  const [error, setError] = useState<string | null>(null);
  const [newDefect, setNewDefect] = useState("");
  const [addingDefect, setAddingDefect] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const busy = create.isPending || update.isPending || addDefect.isPending;
  const allPeople = mergePeople(directory, draft.watchers);

  useEffect(() => { firstFieldRef.current?.focus(); }, []);

  function set<K extends keyof PanelQcIssueInput>(key: K, value: PanelQcIssueInput[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  async function addCategory() {
    if (!newDefect.trim()) return;
    const created = await addDefect.mutateAsync(newDefect);
    set("defectCategory", created.name);
    setNewDefect("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (issue) await update.mutateAsync({ id: issue.id, input: draft });
      else await create.mutateAsync(draft);
      onClose();
    } catch { setError("Could not save the issue. The error message above has more detail."); }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col px-4 py-5 sm:px-6 sm:py-8">
      <div className="flex flex-col rounded-lg border border-border bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg"><ClipboardCheck className="h-4 w-4 text-accent" />{issue ? <><span>Edit Panel QC Issue</span><span className="ml-2 font-mono text-xs font-normal text-fg-muted">{issue.tagNumber || "No TAG"}</span></> : "New Panel QC Issue"}</h2>
          <div className="flex items-center gap-1"><button type="button" onClick={() => issue && window.open(`${import.meta.env.BASE_URL}panels/qc-issues/${issue.id}/print`, "_blank", "noopener,noreferrer")} disabled={busy || !issue} title="Print 2 × 2 label" aria-label="Print 2 × 2 label" className="rounded-md p-1 text-fg-muted hover:bg-surface-2 disabled:opacity-50"><Printer className="h-4 w-4" /></button><button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-surface-2 disabled:opacity-50"><X className="h-4 w-4" /></button></div>
        </div>
        <form id="panel-qc-issue-form" onSubmit={submit} className="px-5 py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Panel / Board Serial Number" className="sm:col-span-2"><input ref={firstFieldRef} value={draft.panelSerialNumber} onChange={(e) => set("panelSerialNumber", e.target.value)} className="input" /></Field>
            <Field label="Date"><DateField value={toDateInputValue(draft.date)} onChange={(value) => set("date", fromDateInputValue(value))} disabled={busy} /></Field>
            <Field label="Defect Category" action={<button type="button" onClick={() => { setAddingDefect((open) => !open); setNewDefect(""); }} disabled={busy} aria-label={addingDefect ? "Cancel adding defect category" : "Add defect category"} title={addingDefect ? "Cancel" : "Add defect category"} className="rounded-md p-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50">{addingDefect ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}</button>}>
              <ChoiceSelect value={draft.defectCategory ?? ""} onChange={(value) => set("defectCategory", value || null)} options={defects.map((defect) => defect.name)} emptyLabel="Not set" disabled={busy} />
              {defectsError && <p className="mt-1 text-xs font-normal normal-case tracking-normal text-cooper-red">Could not load defect categories.</p>}
              {addingDefect && <div className="mt-2 flex flex-wrap gap-2"><input value={newDefect} onChange={(e) => setNewDefect(e.target.value)} placeholder="New category" className="input min-w-0 flex-1" disabled={busy} /><button type="button" onClick={addCategory} disabled={busy || !newDefect.trim()} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-fg hover:bg-surface-2 disabled:opacity-50"><Plus className="h-3.5 w-3.5" />Add</button><button type="button" onClick={() => { setAddingDefect(false); setNewDefect(""); }} disabled={busy} className="rounded-md border border-border px-2.5 text-xs font-medium text-fg-muted hover:bg-surface-2 disabled:opacity-50">Cancel</button></div>}
            </Field>
            <Field label="Part Number"><input value={draft.partNumber} onChange={(e) => set("partNumber", e.target.value)} className="input" /></Field>
            <Field label="Part Description"><input value={draft.partDescription} onChange={(e) => set("partDescription", e.target.value)} className="input" /></Field>
            <Field label="Serial Reference Note"><input value={draft.serialReferenceNote} onChange={(e) => set("serialReferenceNote", e.target.value)} className="input" /></Field>
            <Field label="Production Technician"><input value={draft.productionTechnician} onChange={(e) => set("productionTechnician", e.target.value)} className="input" /></Field>
            <Field label="Watchers" className="sm:col-span-2"><PersonMultiField value={draft.watchers} allPeople={allPeople} onToggle={(person) => set("watchers", draft.watchers.some((watcher) => (watcher.email ?? watcher.displayName) === (person.email ?? person.displayName)) ? draft.watchers.filter((watcher) => (watcher.email ?? watcher.displayName) !== (person.email ?? person.displayName)) : [...draft.watchers, person])} emptyLabel="No watchers" searchPlaceholder="Search people…" /></Field>
            <Field label="Comments" className="sm:col-span-2"><AutoGrowTextarea value={draft.comments} onChange={(e) => set("comments", e.target.value)} rows={3} className="input resize-y" /></Field>
            <Field label="Subsequent Steps / Corrective Action" className="sm:col-span-2"><AutoGrowTextarea value={draft.correctiveAction} onChange={(e) => set("correctiveAction", e.target.value)} rows={3} className="input resize-y" /></Field>
            <Field label="Production Repair Notes" className="sm:col-span-2"><AutoGrowTextarea value={draft.productionRepairNotes} onChange={(e) => set("productionRepairNotes", e.target.value)} rows={2} className="input resize-y" /></Field>
            <Field label="Production Resolution" className="sm:col-span-2"><AutoGrowTextarea value={draft.productionResolution} onChange={(e) => set("productionResolution", e.target.value)} rows={2} className="input resize-y" /></Field>
            <Field label="Communication" className="sm:col-span-2"><AutoGrowTextarea value={draft.communication} onChange={(e) => set("communication", e.target.value)} rows={3} className="input resize-y" /></Field>
          </div>
          {error && <p className="mt-4 text-sm text-cooper-red">{error}</p>}
        </form>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3"><button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50">Cancel</button><button type="submit" form="panel-qc-issue-form" disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{issue ? "Save changes" : "Add issue"}</button></div>
      </div>
    </div>
  );
}

function Field({ label, required, className = "", action, children }: { label: string; required?: boolean; className?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <label className={`flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-fg-muted ${className}`}><span className="flex items-center justify-between">{label}{required && <span className="text-cooper-red"> *</span>}{action}</span>{children}</label>;
}