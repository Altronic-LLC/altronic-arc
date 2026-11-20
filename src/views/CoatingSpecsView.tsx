import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Layers, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import {
  COATING_CONFIGURED,
  useCoatingSpecs,
  useCoatingSpecUsage,
  useCreateCoatingSpec,
  useDeleteCoatingSpec,
  useSetCoatingSpecActive,
  useUpdateCoatingSpec,
} from "@/hooks/useCoatingChecks";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { useSortableTable } from "@/hooks/useSortableTable";
import { useIsPhone } from "@/hooks/useIsPhone";
import { DetailTopBar } from "@/components/DetailTopBar";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SortableHeader } from "@/components/SortableTableHeader";
import { CoatingSpecFormModal } from "@/components/CoatingSpecFormModal";
import type { SortColumn } from "@/lib/tableSort";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { coatedSidesText, coatingRangeText, coatingSpecMilsText, UNIT_LABEL } from "@/lib/coatingCheck";
import { cn } from "@/lib/cn";
import type { CoatingSpec } from "@/types/coating";

// =============================================================================
// Coating Specs (BusinessIT#60) — the min / max conformal coating thickness
// each check is judged by, and how many sides the board is coated on. Everyone
// can read it; only ARC admins add, edit, retire or delete. The view greys the
// controls; every mutation re-checks.
//
// Delete only for a spec no check has used; one that has is RETIRED instead.
// =============================================================================

const SPEC_COLUMNS = (usage: Map<number, number>): SortColumn<CoatingSpec>[] => [
  { key: "name", label: "Spec", value: (s) => s.name },
  { key: "minMm", label: "Limits (mm)", kind: "number", value: (s) => coatingRangeText(s.minMm, s.maxMm, "mm"), sortValue: (s) => s.minMm },
  { key: "minIn", label: "Limits (in)", kind: "number", value: (s) => coatingRangeText(s.minMm, s.maxMm, "in"), sortValue: (s) => s.minMm },
  { key: "mils", label: "Mils (ref)", value: (s) => coatingSpecMilsText(s.minMm, s.maxMm), noFilter: true },
  { key: "specUnit", label: "Entered in", value: (s) => UNIT_LABEL[s.specUnit] },
  { key: "coatedSides", label: "Coated sides", value: (s) => coatedSidesText(s.coatedSides) },
  { key: "notes", label: "Notes", value: (s) => s.notes, noFilter: true },
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

export function CoatingSpecsView() {
  const { data: specs = [], isLoading, error, refetch } = useCoatingSpecs();
  const { data: usage = new Map<number, number>() } = useCoatingSpecUsage();
  const { isAdmin, isResolving } = useAdminAccess();
  const create = useCreateCoatingSpec();
  const update = useUpdateCoatingSpec();
  const setActive = useSetCoatingSpecActive();
  const remove = useDeleteCoatingSpec();

  const [showRetired, setShowRetired] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CoatingSpec | null>(null);

  const retiredCount = specs.filter((s) => !s.active).length;
  const filtered = useMemo(() => specs.filter((s) => showRetired || s.active), [specs, showRetired]);
  const columns = useMemo(() => SPEC_COLUMNS(usage), [usage]);
  const table = useSortableTable<CoatingSpec>({
    rows: filtered,
    columns,
    stableKey: (s) => s.id,
    initialKey: "name",
    initialDirection: "asc",
  });

  const lockHint = isResolving ? "Checking your access…" : "Only ARC admins can change the coating specs.";

  const isPhone = useIsPhone();

  /**
   * Edit / retire / delete — one render function, so the card and the row
   * can't disagree. A function, not a component declared in here: that would
   * remount the buttons on every render and lose their focus.
   */
  function specActions(s: CoatingSpec) {
    const used = usage.get(s.id) ?? 0;
    return (
      <span className="inline-flex items-center gap-1">
        <button
          onClick={() => setEditing(s)}
          disabled={!isAdmin}
          title={isAdmin ? "Edit spec" : lockHint}
          aria-label={`Edit ${s.name}`}
          className="rounded-sm p-1 text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setActive.mutate({ id: s.id, active: !s.active })}
          disabled={!isAdmin || setActive.isPending}
          title={isAdmin ? (s.active ? "Retire" : "Restore") : lockHint}
          aria-label={`${s.active ? "Retire" : "Restore"} ${s.name}`}
          className="rounded-sm p-1 text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          {s.active ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => handleDelete(s)}
          disabled={!isAdmin || used > 0 || remove.isPending}
          title={!isAdmin ? lockHint : used > 0 ? "Checks were judged against this spec — retire it instead" : "Delete spec"}
          aria-label={`Delete ${s.name}`}
          className="rounded-sm p-1 text-fg-muted hover:bg-surface hover:text-cooper-red disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  async function handleDelete(s: CoatingSpec) {
    const ok = window.confirm(
      `Delete the "${s.name}" spec?\n\nThis can't be undone. If any check has been judged against it, it will be refused — retire it instead.`,
    );
    if (ok) await remove.mutateAsync(s.id).catch(() => undefined);
  }

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Coating Checks" listTo="/operations/coating-checks" />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <Layers className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Coating Specs</h1>
            <p className="text-xs text-fg-muted">
              The acceptable conformal coating thickness, in mm and inches (mils for reference), and how many sides each
              board is coated on. A check is judged in the unit its spec was entered in, whatever unit it was measured
              in. The limits count as in spec.
            </p>
          </div>
        </div>
        <button
          onClick={() => setAdding(true)}
          disabled={!isAdmin || !COATING_CONFIGURED}
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

      {retiredCount > 0 && (
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show {retiredCount.toLocaleString()} retired
        </label>
      )}

      {!COATING_CONFIGURED ? (
        <div className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 p-4 text-sm text-fg">
          The Coating Specs list isn't set up yet.
        </div>
      ) : error && isPermissionDenied(error) ? (
        <ListAccessNotice list="Coating Specs" site="Altronic_PMO" onRetry={() => void refetch()} />
      ) : error ? (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs text-cooper-red">
          Couldn't load the coating specs: {(error as Error).message}{" "}
          <button onClick={() => void refetch()} className="font-semibold underline">
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <LoadingTasks noun="the coating specs" />
      ) : table.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-fg-muted">
          {specs.length === 0
            ? isAdmin
              ? "No coating specs yet. Add one so checks can be judged."
              : "No coating specs yet. Ask an ARC admin to add one."
            : "No specs match."}
        </div>
      ) : isPhone ? (
        // A phone gets CARDS — nine columns don't fit, and a table you scroll
        // sideways hides the limits behind the name (Tim, 2026-11-04). Rendered
        // INSTEAD of the table (the Parts List way), so each button exists once.
        <div className="flex flex-col gap-2">
          {table.rows.map((s) => (
            <div
              key={s.id}
              className={cn("flex flex-col gap-2 rounded-lg border border-border bg-surface p-3", !s.active && "opacity-70")}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-fg">{s.name}</span>
                <StatusChip active={s.active} />
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-fg-muted">mm</dt>
                <dd className={cn("font-mono", s.specUnit === "mm" ? "font-semibold text-fg" : "text-fg-muted")}>
                  {coatingRangeText(s.minMm, s.maxMm, "mm")}
                </dd>
                <dt className="text-fg-muted">in</dt>
                <dd className={cn("font-mono", s.specUnit === "in" ? "font-semibold text-fg" : "text-fg-muted")}>
                  {coatingRangeText(s.minMm, s.maxMm, "in")}
                </dd>
                <dt className="text-fg-muted">mils</dt>
                <dd className="font-mono text-fg-muted">{coatingSpecMilsText(s.minMm, s.maxMm) || "—"}</dd>
                <dt className="text-fg-muted">Entered in</dt>
                <dd className="text-fg">{UNIT_LABEL[s.specUnit]}</dd>
                <dt className="text-fg-muted">Coated</dt>
                <dd className="text-fg">{coatedSidesText(s.coatedSides)}</dd>
                <dt className="text-fg-muted">Checks</dt>
                <dd className="tabular-nums text-fg">{(usage.get(s.id) ?? 0).toLocaleString()}</dd>
                {s.notes && (
                  <>
                    <dt className="text-fg-muted">Notes</dt>
                    <dd className="text-fg-muted">{s.notes}</dd>
                  </>
                )}
              </dl>
              {isAdmin && (
                <div className="flex justify-end border-t border-border pt-2">
                  {specActions(s)}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="scroll-elegant overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
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
              {table.rows.map((s) => (
                <tr key={s.id} className={cn("border-b border-border align-top last:border-0", !s.active && "text-fg-muted")}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{s.name}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2 font-mono text-[12px]", s.specUnit !== "mm" && "text-fg-muted")}>
                    {coatingRangeText(s.minMm, s.maxMm, "mm")}
                  </td>
                  <td className={cn("whitespace-nowrap px-3 py-2 font-mono text-[12px]", s.specUnit !== "in" && "text-fg-muted")}>
                    {coatingRangeText(s.minMm, s.maxMm, "in")}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px] text-fg-muted">
                    {coatingSpecMilsText(s.minMm, s.maxMm) || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{UNIT_LABEL[s.specUnit]}</td>
                  <td className="whitespace-nowrap px-3 py-2">{coatedSidesText(s.coatedSides)}</td>
                  <td className="px-3 py-2 text-[12px] text-fg-muted">{s.notes || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(usage.get(s.id) ?? 0).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <StatusChip active={s.active} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {specActions(s)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <CoatingSpecFormModal
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

/** Words AND colour — colour is never the only carrier. */
function StatusChip({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold",
        active ? "bg-cooper-green/15 text-cooper-green" : "bg-surface-2 text-fg-muted",
      )}
    >
      {active ? "Active" : "Retired"}
    </span>
  );
}
