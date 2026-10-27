import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Lock, Pencil, Plus, Ruler, Trash2 } from "lucide-react";
import {
  CRIMP_CONFIGURED,
  useCreateCrimpSpec,
  useCrimpSpecs,
  useCrimpSpecUsage,
  useDeleteCrimpSpec,
  useSetCrimpSpecActive,
  useUpdateCrimpSpec,
} from "@/hooks/useCrimpChecks";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { useSortableTable } from "@/hooks/useSortableTable";
import { DetailTopBar } from "@/components/DetailTopBar";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { SortableHeader } from "@/components/SortableTableHeader";
import { CrimpSpecFormModal } from "@/components/CrimpSpecFormModal";
import type { SortColumn } from "@/lib/tableSort";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { formatCrimp, gaugeLabel, specText } from "@/lib/crimpCheck";
import { cn } from "@/lib/cn";
import type { CrimpSpec } from "@/types/crimp";

// =============================================================================
// Crimp Specs (BusinessIT#55) — what each terminal's crimp should measure, by
// terminal + applicator + wire gauge. Everyone can read it; only ARC admins
// add, edit, retire or delete (Tim, 2026-10-27). The view greys the controls;
// every mutation re-checks.
//
// Delete only for a spec no check has used; one that has is RETIRED instead —
// it leaves the check form's picker while every check measured against it
// keeps it.
// =============================================================================

const SPEC_COLUMNS = (usage: Map<number, number>): SortColumn<CrimpSpec>[] => [
  { key: "terminal", label: "Terminal", value: (s) => s.terminal },
  { key: "wireGauge", label: "Gauge", value: (s) => gaugeLabel(s.wireGauge) },
  { key: "applicator", label: "Applicator", value: (s) => s.applicator },
  { key: "manufacturerPartNumber", label: "Mfr part #", value: (s) => s.manufacturerPartNumber, noFilter: true },
  {
    key: "crimpHeight",
    label: "Crimp height",
    kind: "number",
    value: (s) => specText(s.crimpHeight, s.tolerance),
    sortValue: (s) => s.crimpHeight,
  },
  { key: "settings", label: "Settings", value: (s) => settingsText(s), noFilter: true },
  {
    key: "uses",
    label: "Checks",
    kind: "number",
    value: (s) => String(usage.get(s.id) ?? 0),
    sortValue: (s) => usage.get(s.id) ?? 0,
    noFilter: true,
  },
  { key: "status", label: "Status", value: (s) => (s.active ? "Active" : "Retired") },
];

function settingsText(s: CrimpSpec): string {
  return [
    s.wireSetting && `Wire ${s.wireSetting}`,
    s.insulationSetting && `Ins ${s.insulationSetting}`,
    s.tableHeight && `Table ${s.tableHeight}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function CrimpSpecsView() {
  const { data: specs = [], isLoading, error, refetch } = useCrimpSpecs();
  const { data: usage = new Map<number, number>() } = useCrimpSpecUsage();
  const { isAdmin, isResolving } = useAdminAccess();
  const create = useCreateCrimpSpec();
  const update = useUpdateCrimpSpec();
  const setActive = useSetCrimpSpecActive();
  const remove = useDeleteCrimpSpec();

  const [query, setQuery] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CrimpSpec | null>(null);

  const retiredCount = specs.filter((s) => !s.active).length;
  const noHeightCount = specs.filter((s) => s.active && s.crimpHeight === null).length;
  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return specs.filter((s) => {
      if (!showRetired && !s.active) return false;
      const hay = [s.terminal, s.applicator, s.wireGauge, s.manufacturerPartNumber, s.notes].join(" ").toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [specs, query, showRetired]);

  const columns = useMemo(() => SPEC_COLUMNS(usage), [usage]);
  const table = useSortableTable<CrimpSpec>({
    rows: filtered,
    columns,
    stableKey: (s) => s.id,
    initialKey: "terminal",
    initialDirection: "asc",
  });

  const lockHint = isResolving ? "Checking your access…" : "Only ARC admins can change the crimp specs.";

  async function handleDelete(s: CrimpSpec) {
    const ok = window.confirm(
      `Delete the spec for ${s.terminal} ${gaugeLabel(s.wireGauge)} (${s.applicator || "no applicator"})?\n\nThis can't be undone. If any check has been measured against it, it will be refused — retire it instead.`,
    );
    if (ok) await remove.mutateAsync(s.id).catch(() => undefined);
  }

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Crimp Height Checks" listTo="/harness/crimp-checks" />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <Ruler className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Crimp Specs</h1>
            <p className="text-xs text-fg-muted">
              What each terminal's crimp should measure, by applicator and wire gauge, in inches. The limits count as in spec.
            </p>
          </div>
        </div>
        <button
          onClick={() => setAdding(true)}
          disabled={!isAdmin || !CRIMP_CONFIGURED}
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
        <SearchInput value={query} onChange={setQuery} placeholder="Search terminal, applicator…" className="select sm:max-w-sm" />
        {retiredCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
            Show {retiredCount.toLocaleString()} retired
          </label>
        )}
        {noHeightCount > 0 && (
          <span className="text-xs font-medium text-ajax-yellow sm:ml-auto">
            {noHeightCount} {noHeightCount === 1 ? "spec has" : "specs have"} no crimp height yet, so checks against{" "}
            {noHeightCount === 1 ? "it" : "them"} can't be judged.
          </span>
        )}
      </div>

      {!CRIMP_CONFIGURED ? (
        <div className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 p-4 text-sm text-fg">
          The Crimp Specs list isn't set up yet.
        </div>
      ) : error && isPermissionDenied(error) ? (
        <ListAccessNotice list="Crimp Specs" site="Altronic_PMO" onRetry={() => void refetch()} />
      ) : error ? (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't load the crimp specs: {(error as Error).message}{" "}
          <button onClick={() => void refetch()} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <LoadingTasks noun="the crimp specs" />
      ) : table.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-fg-muted">
          {specs.length === 0 ? "No crimp specs yet." : "No specs match."}
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
                return (
                  <tr key={s.id} className={cn("border-b border-border align-top last:border-0", !s.active && "text-fg-muted")}>
                    <td className="px-3 py-2 font-mono text-[13px] font-medium">{s.terminal}</td>
                    <td className="whitespace-nowrap px-3 py-2">{gaugeLabel(s.wireGauge) || "—"}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{s.applicator || "—"}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-fg-muted">{s.manufacturerPartNumber || "—"}</td>
                    <td className={cn("whitespace-nowrap px-3 py-2 font-mono text-[12px]", s.crimpHeight === null && "text-ajax-yellow")}>
                      {s.crimpHeight === null ? "Not set" : `${formatCrimp(s.crimpHeight)} ± ${formatCrimp(s.tolerance)}`}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-fg-muted">
                      {settingsText(s) || "—"}
                      {s.notes && <span className="block text-[11px]">{s.notes}</span>}
                    </td>
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
                        aria-label={`Edit ${s.terminal} ${gaugeLabel(s.wireGauge)}`}
                        className="rounded-sm p-1 text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setActive.mutate({ id: s.id, active: !s.active })}
                        disabled={!isAdmin || setActive.isPending}
                        title={isAdmin ? (s.active ? "Retire" : "Restore") : lockHint}
                        aria-label={`${s.active ? "Retire" : "Restore"} ${s.terminal} ${gaugeLabel(s.wireGauge)}`}
                        className="rounded-sm p-1 text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {s.active ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        disabled={!isAdmin || used > 0 || remove.isPending}
                        title={!isAdmin ? lockHint : used > 0 ? "Checks were measured against this spec — retire it instead" : "Delete spec"}
                        aria-label={`Delete ${s.terminal} ${gaugeLabel(s.wireGauge)}`}
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
        <CrimpSpecFormModal
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
