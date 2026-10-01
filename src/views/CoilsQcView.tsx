import { useState } from "react";
import { AlertTriangle, ClipboardCheck, Info, Pencil, Plus, Search } from "lucide-react";
import { CoilsQcFormModal } from "@/components/CoilsQcFormModal";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { LoadingTasks } from "@/components/LoadingTasks";
import {
  useAddCoilPartNumber,
  useAddCoilOtherFault,
  useCoilDefectLog,
  useCoilOtherFaults,
  useCoilPartNumbers,
  useCreateCoilDefectLogEntry,
  useUpdateCoilDefectLogEntry,
} from "@/hooks/useCoilsQc";
import { COIL_DEFECT_FIELDS, defectTotal, parseOtherFaults, type CoilDefectLogEntry } from "@/lib/coilsQc";
import { isPermissionDenied } from "@/lib/listWriteErrors";

function defectLabel(field: string): string {
  return field.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function OtherFaultDetails({ raw }: { raw: string }) {
  const parsed = parseOtherFaults(raw);
  if (parsed === null) return <span className="text-cooper-red">The stored Other Fault Table is not valid JSON.</span>;
  if (parsed.length === 0) return <span>No other faults recorded.</span>;
  return <table className="w-full text-left text-xs"><thead className="text-fg-muted"><tr><th className="pb-1 pr-2 font-medium">Defect</th><th className="pb-1 pr-2 text-right font-medium">Count</th><th className="pb-1 font-medium">Comments</th></tr></thead><tbody>{parsed.map((fault, index) => <tr key={index} className="border-t border-border"><td className="py-1.5 pr-2 text-fg">{fault.Defect.Value || "-"}</td><td className="py-1.5 pr-2 text-right text-fg">{fault.Count}</td><td className="py-1.5 text-fg-muted">{fault.Comment || "-"}</td></tr>)}</tbody></table>;
}

export function CoilsQcView() {
  const { data: entries = [], isLoading, error, refetch } = useCoilDefectLog();
  const { data: partNumbers = [], error: partNumbersError, refetch: refetchPartNumbers } = useCoilPartNumbers();
  const { data: otherFaults = [], error: otherFaultsError, refetch: refetchOtherFaults } = useCoilOtherFaults();
  const createMutation = useCreateCoilDefectLogEntry();
  const updateMutation = useUpdateCoilDefectLogEntry();
  const addPartMutation = useAddCoilPartNumber();
  const addOtherFaultMutation = useAddCoilOtherFault();
  const listUnavailable = [error, partNumbersError, otherFaultsError].some(
    (queryError) => queryError && isPermissionDenied(queryError),
  );
  const [query, setQuery] = useState("");
  const [defectsExpanded, setDefectsExpanded] = useState(false);
  const [expandedOtherId, setExpandedOtherId] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<CoilDefectLogEntry | null | undefined>(undefined);
  const filtered = entries.filter((entry) =>
    `${entry.coilPartNumber} ${entry.date}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 pb-1 pt-4 sm:px-6 sm:pb-2 sm:pt-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <ClipboardCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Coil Defect Log</h1>
          <p className="text-sm text-fg-muted">Production failures and their recorded coil defects.</p>
        </div>
        <button type="button" onClick={() => setEditingEntry(null)} disabled={listUnavailable} title={listUnavailable ? "You do not have access to a required SharePoint list" : undefined} className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-4 w-4" />Add entry</button>
      </header>

      <div className="flex flex-wrap gap-2">
      <label className="relative min-w-64 max-w-md flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search coil part number or date"
          className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-fg"
        />
      </label>
      <button type="button" onClick={() => setDefectsExpanded((expanded) => !expanded)} className="rounded-md border border-border px-3 py-2 text-sm font-medium text-fg-muted hover:bg-surface-2">{defectsExpanded ? "Hide defects" : "Show all defects"}</button>
      </div>

      {isLoading ? <LoadingTasks noun="the coil defect log" /> : listUnavailable ? (
        <ListAccessNotice
          list="Coil Defect Log or its reference list"
          site="Altronic_Engineering"
          onRetry={() => void Promise.all([refetch(), refetchPartNumbers(), refetchOtherFaults()])}
        />
      ) : error ? (
        <p className="rounded-md border border-cooper-red/30 bg-cooper-red/10 p-3 text-sm text-cooper-red">
          Could not load the Coil Defect Log: {error.message}
        </p>
      ) : (
        <>
        <div className="space-y-3 sm:hidden">
          {filtered.map((entry) => {
            const otherFaults = parseOtherFaults(entry.otherFaultTable);
            const mismatch = entry.failed !== defectTotal(entry);
            const showOther = expandedOtherId === entry.id;
            return <article key={entry.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="font-medium text-fg">{entry.coilPartNumber || "Unnamed coil"}</h2><p className="mt-0.5 text-sm text-fg-muted">{entry.date ? new Date(entry.date).toLocaleDateString() : "No date"}</p></div>
                <button type="button" onClick={() => setEditingEntry(entry)} aria-label={`Edit ${entry.coilPartNumber || "coil defect entry"}`} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"><Pencil className="h-4 w-4" /></button>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm"><div><dt className="text-fg-muted">Failed</dt><dd className="font-medium text-fg">{entry.failed}</dd></div><div><dt className="text-fg-muted">Named defects</dt><dd className="font-medium text-fg">{defectTotal(entry)} {mismatch && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-ajax-yellow" />}</dd></div></dl>
              {(otherFaults === null || otherFaults.length > 0) && <div className="mt-4 border-t border-border pt-3"><button type="button" onClick={() => setExpandedOtherId(showOther ? null : entry.id)} className="flex w-full items-center justify-between text-sm font-medium text-superior-blue">Other faults <Info className="h-4 w-4" /></button>{showOther && <div className="mt-3 rounded-md bg-surface-2 p-3"><OtherFaultDetails raw={entry.otherFaultTable} /></div>}</div>}
            </article>;
          })}
          {filtered.length === 0 && <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-fg-muted">No coil defect records match this search.</p>}
        </div>
        <div className="hidden max-h-[55vh] overflow-auto rounded-lg border border-border bg-surface sm:block">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2 text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-3">Date</th><th className="px-4 py-3">Coil part no.</th>
                <th className="px-4 py-3 text-right">Failed</th>
                <th className="px-4 py-3 text-right">Named defects</th>
                {defectsExpanded && COIL_DEFECT_FIELDS.map((field) => <th key={field} className="px-3 py-3 text-right">{defectLabel(field)}</th>)}
                <th className="px-4 py-3">Other faults</th><th className="px-4 py-3"><span className="sr-only">Edit</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => {
                const otherFaults = parseOtherFaults(entry.otherFaultTable);
                const mismatch = entry.failed !== defectTotal(entry);
                return <tr key={entry.id} className="border-t border-border align-top">
                  <td className="px-4 py-3 text-fg-muted">{entry.date ? new Date(entry.date).toLocaleDateString() : "-"}</td>
                  <td className="px-4 py-3 font-medium text-fg">{entry.coilPartNumber || "-"}</td>
                  <td className="px-4 py-3 text-right">{entry.failed}</td>
                  <td className="px-4 py-3 text-right">
                    {defectTotal(entry)} {mismatch && (
                      <span title="Failed count does not match named-defect total">
                        <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-ajax-yellow" />
                      </span>
                    )}
                  </td>
                  {defectsExpanded && COIL_DEFECT_FIELDS.map((field) => <td key={field} className="px-3 py-3 text-right text-fg-muted">{entry.defects[field]}</td>)}
                  <td className="px-4 py-3">
                    {otherFaults === null || otherFaults.length > 0 ? <span className="group relative inline-flex"><button type="button" aria-label="Show Other Fault Table details" className="rounded-md p-1 text-superior-blue hover:bg-superior-blue/10"><Info className="h-4 w-4" /></button><span className="pointer-events-none absolute right-0 z-20 hidden w-80 rounded-md border border-border bg-surface p-3 text-left text-sm text-fg shadow-xl group-hover:block group-focus-within:block"><OtherFaultDetails raw={entry.otherFaultTable} /></span></span> : <span className="text-fg-muted">-</span>}
                  </td>
                  <td className="px-4 py-3"><button type="button" onClick={() => setEditingEntry(entry)} aria-label={`Edit ${entry.coilPartNumber || "coil defect entry"}`} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"><Pencil className="h-4 w-4" /></button></td>
                </tr>;
              })}
              {filtered.length === 0 && <tr><td colSpan={6 + (defectsExpanded ? COIL_DEFECT_FIELDS.length : 0)} className="px-4 py-10 text-center text-fg-muted">No coil defect records match this search.</td></tr>}
            </tbody>
          </table>
        </div>
        </>
      )}
      {editingEntry !== undefined && <CoilsQcFormModal entry={editingEntry} partNumbers={partNumbers} otherFaults={otherFaults} isSaving={createMutation.isPending || updateMutation.isPending} onClose={() => setEditingEntry(undefined)} onAddPartNumber={async (partNumber) => { await addPartMutation.mutateAsync(partNumber); }} onAddOtherFault={async (fault) => { await addOtherFaultMutation.mutateAsync(fault); }} onSave={async (input) => { if (editingEntry) await updateMutation.mutateAsync({ id: editingEntry.id, input }); else await createMutation.mutateAsync(input); setEditingEntry(undefined); }} />}
    </div>
  );
}