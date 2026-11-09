import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Lock, Pencil, Plus, Trash2, Weight } from "lucide-react";
import {
  PULL_TESTS_CONFIGURED,
  useCreatePullTestSpec,
  useDeletePullTestSpec,
  usePullTestSpecs,
  usePullTestSpecUsage,
  useSetPullTestSpecActive,
  useUpdatePullTestSpec,
} from "@/hooks/usePullTests";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { useSortableTable } from "@/hooks/useSortableTable";
import { DetailTopBar } from "@/components/DetailTopBar";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { SortableHeader } from "@/components/SortableTableHeader";
import { PullTestSpecFormModal } from "@/components/PullTestSpecFormModal";
import type { SortColumn } from "@/lib/tableSort";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { gaugeLabel } from "@/lib/crimpCheck";
import { minimumShort, pullSpecLabel } from "@/lib/pullTest";
import { cn } from "@/lib/cn";
import type { PullTestSpec } from "@/types/pullTest";

// =============================================================================
// Pull Test Specs (BusinessIT#64) — the least force a good crimp holds, by
// terminal and wire gauge: a manufacturer's figure, or an industry standard's
// (IPC/WHMA-A-620), which may cover any terminal on a gauge. Everyone can read
// it; only ARC admins add, edit, retire or delete. The Crimp Specs screen,
// copied: delete only for a spec no test has used, otherwise retire it.
// =============================================================================

const SPEC_COLUMNS = (usage: Map<number, number>): SortColumn<PullTestSpec>[] => [
  { key: "terminal", label: "Terminal", value: (s) => s.terminal || "Any terminal" },
  { key: "wireGauge", label: "Gauge", value: (s) => gaugeLabel(s.wireGauge) },
  {
    key: "minimum",
    label: "Minimum",
    kind: "number",
    value: (s) => minimumShort(s.minimumForce, s.unit),
    sortValue: (s) => s.minimumForce,
  },
  { key: "source", label: "Source", value: (s) => s.source ?? "" },
  { key: "reference", label: "Reference", value: (s) => s.reference, noFilter: true },
  { key: "manufacturerPartNumber", label: "Mfr part #", value: (s) => s.manufacturerPartNumber, noFilter: true },
  {
    key: "uses",
    label: "Tests",
    kind: "number",
    value: (s) => String(usage.get(s.id) ?? 0),
    sortValue: (s) => usage.get(s.id) ?? 0,
    noFilter: true,
  },
  { key: "status", label: "Status", value: (s) => (s.active ? "Active" : "Retired") },
];

export function PullTestSpecsView() {
  const { data: specs = [], isLoading, error, refetch } = usePullTestSpecs();
  const { data: usage = new Map<number, number>() } = usePullTestSpecUsage();
  const { isAdmin, isResolving } = useAdminAccess();
  const create = useCreatePullTestSpec();
  const update = useUpdatePullTestSpec();
  const setActive = useSetPullTestSpecActive();
  const remove = useDeletePullTestSpec();

  const [query, setQuery] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PullTestSpec | null>(null);

  const retiredCount = specs.filter((s) => !s.active).length;
  const noMinimumCount = specs.filter((s) => s.active && s.minimumForce === null).length;
  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return specs.filter((s) => {
      if (!showRetired && !s.active) return false;
      const hay = [s.terminal || "any terminal", s.wireGauge, s.reference, s.manufacturerPartNumber, s.source ?? "", s.notes]
        .join(" ")
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [specs, query, showRetired]);

  const columns = useMemo(() => SPEC_COLUMNS(usage), [usage]);
  const table = useSortableTable<PullTestSpec>({
    rows: filtered,
    columns,
    stableKey: (s) => s.id,
    initialKey: "terminal",
    initialDirection: "asc",
  });

  const lockHint = isResolving ? "Checking your access…" : "Only ARC admins can change the pull test specs.";

  async function handleDelete(s: PullTestSpec) {
    const ok = window.confirm(
      `Delete the spec for ${pullSpecLabel(s)}?\n\nThis can't be undone. If any test has been judged by it, it will be refused — retire it instead.`,
    );
    if (ok) await remove.mutateAsync(s.id).catch(() => undefined);
  }

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Pull Tests" listTo="/harness/pull-tests" />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ajax-yellow/15 text-ajax-yellow">
            <Weight className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Pull Test Specs</h1>
            <p className="text-xs text-fg-muted">
              The least force a good crimp holds, by terminal and wire gauge — from the manufacturer, or an industry
              standard such as IPC/WHMA-A-620. A pull exactly at the minimum passes.
            </p>
          </div>
        </div>
        <button
          onClick={() => setAdding(true)}
          disabled={!isAdmin || !PULL_TESTS_CONFIGURED}
          title={isAdmin ? undefined : lockHint}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          Add spec
        </button>
      </header>

      {!isAdmin && (
        <p className="flex items-start gap-1.5 text-[11px] text-fg-muted">
          <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{lockHint} Ask one if a spec is missing or wrong.</span>
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={query} onChange={setQuery} placeholder="Search terminal, gauge, reference…" className="select sm:max-w-sm" />
        {retiredCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
            Show {retiredCount.toLocaleString()} retired
          </label>
        )}
        {noMinimumCount > 0 && (
          <span className="text-xs font-medium text-ajax-yellow sm:ml-auto">
            {noMinimumCount} {noMinimumCount === 1 ? "spec has" : "specs have"} no minimum yet, so tests against{" "}
            {noMinimumCount === 1 ? "it" : "them"} can't be judged.
          </span>
        )}
      </div>

      {!PULL_TESTS_CONFIGURED ? (
        <div className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 p-4 text-sm text-fg">
          The Pull Test Specs list isn't set up yet.
        </div>
      ) : error && isPermissionDenied(error) ? (
        <ListAccessNotice list="Pull Test Specs" site="Altronic_PMO" onRetry={() => void refetch()} />
      ) : error ? (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't load the pull test specs: {(error as Error).message}{" "}
          <button onClick={() => void refetch()} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <LoadingTasks noun="the pull test specs" />
      ) : table.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-fg-muted">
          {specs.length === 0 ? "No pull test specs yet." : "No specs match."}
        </div>
      ) : (
        <div className="scroll-elegant overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[900px] border-collapse text-sm">
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
              {table.rows.map((s) => {
                const used = usage.get(s.id) ?? 0;
                const name = pullSpecLabel(s);
                return (
                  <tr key={s.id} className={cn("border-b border-border align-top last:border-0", !s.active && "text-fg-muted")}>
                    <td className={cn("px-3 py-2 font-mono text-[13px] font-medium", !s.terminal && "font-sans italic text-fg-muted")}>
                      {s.terminal || "Any terminal"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{gaugeLabel(s.wireGauge) || "—"}</td>
                    <td className={cn("whitespace-nowrap px-3 py-2 font-mono text-[12px]", s.minimumForce === null && "text-ajax-yellow")}>
                      {minimumShort(s.minimumForce, s.unit)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[12px]">{s.source ?? "—"}</td>
                    <td className="px-3 py-2 text-[12px] text-fg-muted">
                      {s.reference || "—"}
                      {s.notes && <span className="block text-[11px]">{s.notes}</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px] text-fg-muted">{s.manufacturerPartNumber || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{used.toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-sm px-1.5 py-0.5 text-[11px] font-semibold",
                          s.active ? "bg-cooper-green/15 text-cooper-green" : "bg-surface-2 text-fg-muted",
                        )}
                      >
                        {s.active ? "Active" : "Retired"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button
                        onClick={() => setEditing(s)}
                        disabled={!isAdmin}
                        title={isAdmin ? "Edit spec" : lockHint}
                        aria-label={`Edit ${name}`}
                        className="rounded-sm p-1 text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setActive.mutate({ id: s.id, active: !s.active })}
                        disabled={!isAdmin || setActive.isPending}
                        title={isAdmin ? (s.active ? "Retire" : "Restore") : lockHint}
                        aria-label={`${s.active ? "Retire" : "Restore"} ${name}`}
                        className="rounded-sm p-1 text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {s.active ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        disabled={!isAdmin || used > 0 || remove.isPending}
                        title={!isAdmin ? lockHint : used > 0 ? "Tests were judged by this spec — retire it instead" : "Delete spec"}
                        aria-label={`Delete ${name}`}
                        className="rounded-sm p-1 text-fg-muted hover:bg-surface hover:text-cooper-red disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <PullTestSpecFormModal
          spec={editing}
          busy={create.isPending || update.isPending}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSave={async (input) => {
            if (editing) await update.mutateAsync({ id: editing.id, input });
            else await create.mutateAsync(input);
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
