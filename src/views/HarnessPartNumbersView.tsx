import { useMemo, useState } from "react";
import { ArchiveRestore, Archive, ListOrdered, Lock, Pencil, Plus, X } from "lucide-react";
import {
  HARNESS_CONFIGURED,
  useCreateHarnessPartNumber,
  useHarnessPartNumbers,
  useHarnessPartUsage,
  useSetHarnessPartNumberActive,
  useUpdateHarnessPartNumber,
} from "@/hooks/useHarnessProductionLog";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { DetailTopBar } from "@/components/DetailTopBar";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { SortableHeader } from "@/components/SortableTableHeader";
import { useSortableTable } from "@/hooks/useSortableTable";
import type { SortColumn } from "@/lib/tableSort";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { cn } from "@/lib/cn";
import type { HarnessPartNumber } from "@/types/task";

// =============================================================================
// Harness Part Numbers — the list the Harness Production Log's part dropdown
// reads. Everyone can see it; only ARC admins add, rename or retire (Tim,
// 2026-10-08). The view greys the controls; every mutation re-checks.
//
// No delete — thousands of log rows point at these. RETIRE takes a part out of
// the New entry dropdown while every entry already using it keeps it.
// =============================================================================

const PART_COLUMNS = (usage: Map<number, number>): SortColumn<HarnessPartNumber>[] => [
  { key: "title", label: "Part Number", value: (p) => p.title, noFilter: true },
  { key: "description", label: "Description", value: (p) => p.description, noFilter: true },
  {
    key: "uses",
    label: "Entries",
    kind: "number",
    value: (p) => String(usage.get(p.lookupId) ?? 0),
    sortValue: (p) => usage.get(p.lookupId) ?? 0,
    noFilter: true,
  },
  { key: "status", label: "Status", value: (p) => (p.active ? "Active" : "Retired") },
];

export function HarnessPartNumbersView() {
  const { data: parts = [], isLoading, error, refetch } = useHarnessPartNumbers();
  const { data: usage = new Map<number, number>() } = useHarnessPartUsage();
  const { isAdmin, isResolving } = useAdminAccess();
  const create = useCreateHarnessPartNumber();
  const update = useUpdateHarnessPartNumber();
  const setActive = useSetHarnessPartNumberActive();

  const [query, setQuery] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<HarnessPartNumber | null>(null);

  const retiredCount = parts.filter((p) => !p.active).length;
  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return parts.filter((p) => {
      if (!showRetired && !p.active) return false;
      const hay = `${p.title} ${p.description} ${p.note}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [parts, query, showRetired]);

  const columns = useMemo(() => PART_COLUMNS(usage), [usage]);
  const table = useSortableTable<HarnessPartNumber>({
    rows: filtered,
    columns,
    stableKey: (p) => p.lookupId,
    initialKey: "title",
    initialDirection: "asc",
  });

  const lockHint = isResolving ? "Checking your access…" : "Only ARC admins can change part numbers.";

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Harness Production Log" listTo="/operations/harness-log" />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <ListOrdered className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Harness Part Numbers</h1>
            <p className="text-xs text-fg-muted">
              The part numbers offered when logging a harness. Retire one to stop it being offered —
              entries already using it keep it.
            </p>
          </div>
        </div>
        <button
          onClick={() => setAdding(true)}
          disabled={!isAdmin || !HARNESS_CONFIGURED}
          aria-disabled={!isAdmin}
          title={isAdmin ? undefined : lockHint}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          Add part number
        </button>
      </header>

      {!isAdmin && (
        <p className="flex items-start gap-1.5 text-[11px] text-fg-muted">
          <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{lockHint} Ask one if a part number is missing.</span>
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={query} onChange={setQuery} placeholder="Search part numbers…" className="select sm:max-w-sm" />
        {retiredCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
            Show {retiredCount.toLocaleString()} retired
          </label>
        )}
      </div>

      {!HARNESS_CONFIGURED ? (
        <div className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 p-4 text-sm text-fg">
          The Harness Part Numbers list isn't set up yet.
        </div>
      ) : error && isPermissionDenied(error) ? (
        <ListAccessNotice list="Harness Part Numbers" site="Altronic_PMO" onRetry={() => void refetch()} />
      ) : error ? (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't load the part numbers: {(error as Error).message}{" "}
          <button onClick={() => void refetch()} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <LoadingTasks noun="the part numbers" />
      ) : table.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-fg-muted">
          {parts.length === 0 ? "No part numbers yet." : "No part numbers match."}
        </div>
      ) : (
        <div className="scroll-elegant overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left">
                {columns.map((c) => (
                  <SortableHeader key={c.key} label={c.label} {...table.headerProps(c.key)} />
                ))}
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((p) => (
                <tr key={p.lookupId} className={cn("border-b border-border last:border-0", !p.active && "text-fg-muted")}>
                  <td className="px-3 py-2 font-mono text-[13px] font-medium">{p.title}</td>
                  <td className="px-3 py-2">
                    {p.description || "—"}
                    {p.note && <span className="block text-[11px] text-fg-muted">{p.note}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{(usage.get(p.lookupId) ?? 0).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-semibold",
                        p.active ? "bg-cooper-green/15 text-cooper-green" : "bg-surface-2 text-fg-muted",
                      )}
                    >
                      {p.active ? "Active" : "Retired"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      onClick={() => setEditing(p)}
                      disabled={!isAdmin}
                      title={isAdmin ? "Rename / describe" : lockHint}
                      aria-label={`Edit ${p.title}`}
                      className="rounded p-1 text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setActive.mutate({ lookupId: p.lookupId, active: !p.active })}
                      disabled={!isAdmin || setActive.isPending}
                      title={isAdmin ? (p.active ? "Retire" : "Restore") : lockHint}
                      aria-label={`${p.active ? "Retire" : "Restore"} ${p.title}`}
                      className="rounded p-1 text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {p.active ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <PartNumberDialog
          part={editing}
          busy={create.isPending || update.isPending}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSave={async (input) => {
            if (editing) await update.mutateAsync({ lookupId: editing.lookupId, input });
            else await create.mutateAsync(input);
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PartNumberDialog({
  part,
  busy,
  onClose,
  onSave,
}: {
  part: HarnessPartNumber | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { title: string; description: string; note: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(part?.title ?? "");
  const [description, setDescription] = useState(part?.description ?? "");
  const [note, setNote] = useState(part?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Enter the part number.");
    setError(null);
    try {
      await onSave({ title, description, note });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={part ? "Edit part number" : "Add part number"}
        className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">{part ? "Edit part number" : "Add part number"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        {part && (
          <p className="text-[11px] text-fg-muted">
            Renaming changes what every entry using this part shows — use it to correct a typo, not
            to turn it into a different part.
          </p>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Part Number *</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="select font-mono" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="select" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Note</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="rounded-md border border-border bg-bg px-3 py-2 text-base text-fg focus:border-accent focus:outline-none sm:text-sm"
          />
        </label>
        {error && <p className="rounded-md bg-cooper-red/10 px-3 py-2 text-xs text-cooper-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
