import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Cable, Info, ListOrdered, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import {
  HARNESS_CONFIGURED,
  useDeleteHarnessLogEntry,
  useHarnessLog,
  useHarnessPartNumbers,
} from "@/hooks/useHarnessProductionLog";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { LoadingTasks } from "@/components/LoadingTasks";
import { MultiSelect, SingleSelect } from "@/components/SearchableSelect";
import { SearchInput } from "@/components/SearchInput";
import { HarnessLogFormModal } from "@/components/HarnessLogFormModal";
import { SortableHeader } from "@/components/SortableTableHeader";
import { useSortableTable } from "@/hooks/useSortableTable";
import { dayLabel, type SortColumn } from "@/lib/tableSort";
import { formatSpDate } from "@/lib/spDates";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { byFrequency, HARNESS_FIRST_YEAR as FIRST_YEAR } from "@/lib/harnessLogMapper";
import { cn } from "@/lib/cn";
import type { HarnessLogEntry } from "@/types/task";
import type { HarnessLogScope } from "@/api/harnessProductionLog";

// =============================================================================
// Harness Production Log — one row per harness build, replacing an Access
// database on a production PC. A log-style table like the Teradyne Log: read
// and appended far more than discussed, so no detail page and no comments.
//
// Unlike the Teradyne Log, EVERY year is open to everyone (Tim, 2026-10-08).
// The old database held the whole history and people looked things up in it —
// "when did we last build this?" — so hiding it behind an admin picker would
// make ARC a step backwards from Access. It still opens on THIS year, because
// the import is ~22,000 rows and that's what people are logging into.
//
// Every filter lives in the URL (year, part, builtBy, q), so a view is
// shareable.
// =============================================================================

const INITIAL_ROWS = 200;

/** Years the picker offers: this one back to when the database went live. */
export function harnessYears(thisYear: number): number[] {
  const out: number[] = [];
  for (let y = thisYear; y >= FIRST_YEAR; y--) out.push(y);
  return out;
}

/** `?year=` → a scope. "all" is every year; anything unrecognised is this year. */
export function parseHarnessYear(raw: string | null, thisYear: number): HarnessLogScope {
  if (raw === "all") return { kind: "all" };
  if (raw && /^\d{4}$/.test(raw)) {
    const y = parseInt(raw, 10);
    if (y >= FIRST_YEAR && y <= thisYear) return { kind: "year", year: y };
  }
  return { kind: "year", year: thisYear };
}

const countText = (n: number | null) => (n === null ? "" : String(n));

/**
 * Sortable columns as DATA. Comments are free text on thousands of rows, so
 * they sort but offer no value filter; Work Order is nearly unique per row, so
 * the same. The search box covers both.
 */
const HARNESS_COLUMNS: SortColumn<HarnessLogEntry>[] = [
  {
    key: "productionDate",
    label: "Date",
    kind: "date",
    value: (e) => dayLabel(e.productionDate),
    sortValue: (e) => e.productionDate,
  },
  { key: "workOrder", label: "Work Order", value: (e) => e.workOrder, noFilter: true },
  { key: "part", label: "Part Number", value: (e) => e.part?.title ?? "" },
  { key: "quantity", label: "Qty", kind: "number", value: (e) => countText(e.quantity), sortValue: (e) => e.quantity },
  {
    key: "reworkQuantity",
    label: "Rework",
    kind: "number",
    value: (e) => countText(e.reworkQuantity),
    sortValue: (e) => e.reworkQuantity,
  },
  { key: "builtBy", label: "Built By", value: (e) => e.builtBy },
  { key: "visualCheck", label: "Visual Check", value: (e) => e.visualCheck },
  { key: "comments", label: "Comments", value: (e) => e.comments, noFilter: true },
];

export function HarnessProductionLogView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const scope = parseHarnessYear(searchParams.get("year"), thisYear);
  const scopeLabel = scope.kind === "all" ? "all years" : String(scope.year);

  const { data: result, isLoading, error, refetch } = useHarnessLog(scope);
  const { data: parts = [], error: partsError, refetch: refetchParts } = useHarnessPartNumbers();
  const deleteEntry = useDeleteHarnessLogEntry();
  // Anyone signed in adds and corrects entries; deleting is admin-only (an edit
  // leaves a corrected record, a delete leaves nothing). UI-level gating — the
  // mutation re-checks, and SharePoint's permissions are the real boundary.
  const { isAdmin, isResolving: adminResolving } = useAdminAccess();

  const log = useMemo(() => result?.entries ?? [], [result]);
  const listUnavailable = [error, partsError].some((e) => e && isPermissionDenied(e));

  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<HarnessLogEntry | null>(null);
  const [showAll, setShowAll] = useState(false);

  const setParam = (key: string, value: string) => {
    const sp = new URLSearchParams(searchParams);
    if (value) sp.set(key, value);
    else sp.delete(key);
    setSearchParams(sp, { replace: true });
  };
  const query = searchParams.get("q") ?? "";
  const partIds = (searchParams.get("part") ?? "").split(",").filter((s) => /^\d+$/.test(s));
  const builders = (searchParams.get("builtBy") ?? "").split(",").filter(Boolean);

  // The Built By FILTER offers what is in the loaded entries, since it filters
  // them. The form's suggestions come from the last 12 months instead — see
  // useHarnessRecentCodes.
  const buildersInView = useMemo(() => byFrequency(log.map((e) => e.builtBy)), [log]);

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return log.filter((e) => {
      if (partIds.length && (!e.part || !partIds.includes(String(e.part.lookupId)))) return false;
      if (builders.length && !builders.includes(e.builtBy)) return false;
      if (tokens.length) {
        const hay = [e.workOrder, e.part?.title, e.builtBy, e.visualCheck, e.comments, e.dataQualityNotes]
          .join(" ")
          .toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [log, query, partIds, builders]);

  // Over every MATCHING entry, not just the rendered ones.
  const totals = useMemo(() => {
    let qty = 0;
    let rework = 0;
    for (const e of filtered) {
      qty += e.quantity ?? 0;
      rework += e.reworkQuantity ?? 0;
    }
    return { qty, rework };
  }, [filtered]);

  const table = useSortableTable<HarnessLogEntry>({
    rows: filtered,
    columns: HARNESS_COLUMNS,
    stableKey: (e) => e.id,
    initialKey: "productionDate",
    initialDirection: "desc",
    onChange: () => setShowAll(false),
  });
  const capped = !showAll && table.rows.length > INITIAL_ROWS;
  const visible = capped ? table.rows.slice(0, INITIAL_ROWS) : table.rows;

  async function handleDelete(entry: HarnessLogEntry) {
    if (!isAdmin) return;
    const ok = window.confirm(
      `Delete this entry?\n\n${entry.title}\n${formatSpDate(entry.productionDate)}\n\nThis removes it from SharePoint and can't be undone.`,
    );
    if (ok) await deleteEntry.mutateAsync(entry.id);
  }

  const partFilterOptions = useMemo(
    () => parts.map((p) => ({ value: String(p.lookupId), label: p.active ? p.title : `${p.title} (retired)` })),
    [parts],
  );

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <Cable className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Harness Production Log</h1>
            <p className="text-xs text-fg-muted">
              Every harness built — part, work order, quantity, rework and who built and checked it.
              Showing {scopeLabel}.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/operations/harness-log/part-numbers"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
          >
            <ListOrdered className="h-4 w-4" />
            Part numbers
          </Link>
          <button
            onClick={() => setShowNew(true)}
            disabled={!HARNESS_CONFIGURED || listUnavailable}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            New entry
          </button>
        </div>
      </header>

      {!HARNESS_CONFIGURED ? (
        <div className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 p-4 text-sm text-fg">
          The Harness Production Log isn't set up yet. Its two SharePoint lists are created by
          <code className="mx-1 font-mono text-xs">scripts/create-harness-production-lists.ps1</code>
          and their ids go in the <code className="font-mono text-xs">VITE_SP_HARNESS_*</code> repo
          variables — a new build is needed after they're set.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Year">
              <SingleSelect
                allLabel={`${thisYear} (current)`}
                ariaLabel="Year"
                clearable={false}
                options={[
                  ...harnessYears(thisYear).map((y) => ({
                    value: String(y),
                    label: y === thisYear ? `${y} (current)` : String(y),
                  })),
                  { value: "all", label: "All years" },
                ]}
                selected={scope.kind === "all" ? "all" : String(scope.year)}
                onChange={(v) => {
                  setParam("year", !v || v === String(thisYear) ? "" : v);
                  setShowAll(false);
                }}
              />
            </Field>
            <Field label="Part Number">
              <MultiSelect
                allLabel="All parts"
                searchPlaceholder="Search part numbers…"
                options={partFilterOptions}
                selected={partIds}
                onChange={(next) => setParam("part", next.join(","))}
              />
            </Field>
            <Field label="Built By">
              <MultiSelect
                allLabel="Anyone"
                searchPlaceholder="Clock number or initials…"
                options={buildersInView.map((b) => ({ value: b, label: b }))}
                selected={builders}
                onChange={(next) => setParam("builtBy", next.join(","))}
              />
            </Field>
            <Field label="Search">
              <SearchInput
                value={query}
                onChange={(q) => setParam("q", q)}
                placeholder="Work order, part, comment…"
                className="select"
              />
            </Field>
          </div>

          {listUnavailable ? (
            <ListAccessNotice
              list="Harness Production Log or Harness Part Numbers"
              site="Altronic_PMO"
              onRetry={() => void Promise.all([refetch(), refetchParts()])}
            />
          ) : error != null ? (
            <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs">
              <div className="mb-1 font-semibold text-cooper-red">
                Couldn't load the Harness Production Log from SharePoint
              </div>
              <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg">
                {(error as Error)?.message ?? "Unknown error"}
              </pre>
              <button onClick={() => void refetch()} className="mt-2 font-semibold text-accent hover:underline">
                Try again
              </button>
            </div>
          ) : isLoading ? (
            <LoadingTasks noun="the harness log" />
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
              {log.length === 0
                ? `Nothing logged in ${scopeLabel} yet. Click 'New entry' to add the first one.`
                : "No entries match the current filters."}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-fg-muted">
                <span>
                  {capped
                    ? `Showing the first ${INITIAL_ROWS.toLocaleString()} of ${filtered.length.toLocaleString()} matching entries`
                    : `Showing ${filtered.length.toLocaleString()} of ${log.length.toLocaleString()} entries in ${scopeLabel}`}
                </span>
                <span>
                  {totals.qty.toLocaleString()} built · {totals.rework.toLocaleString()} reworked
                </span>
                {capped && (
                  <button
                    onClick={() => setShowAll(true)}
                    className="font-semibold text-accent underline-offset-2 hover:underline"
                  >
                    Show all {filtered.length.toLocaleString()}
                  </button>
                )}
              </div>

              {/* Phone: cards. Desktop: the sortable table. Both render the same rows. */}
              <div className="flex flex-col gap-2 sm:hidden">
                {visible.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setEditing(e)}
                    className="rounded-lg border border-border bg-surface p-3 text-left"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-fg">{e.part?.title ?? "No part"}</span>
                      <span className="text-xs tabular-nums text-fg-muted">{formatSpDate(e.productionDate)}</span>
                    </div>
                    <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                      <dt className="text-fg-muted">Work order</dt>
                      <dd className="text-fg">{e.workOrder || "—"}</dd>
                      <dt className="text-fg-muted">Qty / rework</dt>
                      <dd className="text-fg">
                        {e.quantity ?? "—"} / {e.reworkQuantity ?? "—"}
                      </dd>
                      <dt className="text-fg-muted">Built by</dt>
                      <dd className="text-fg">{e.builtBy || "—"}</dd>
                    </dl>
                    {e.comments && <p className="mt-1 truncate text-[11px] text-fg-muted">{e.comments}</p>}
                  </button>
                ))}
              </div>

              <div className="scroll-elegant hidden overflow-x-auto rounded-lg border border-border sm:block">
                <table className="w-full min-w-[960px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2 text-left">
                      {HARNESS_COLUMNS.map((column) => (
                        <SortableHeader key={column.key} label={column.label} {...table.headerProps(column.key)} />
                      ))}
                      <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((e) => (
                      <tr key={e.id} className="group border-b border-border last:border-0 hover:bg-surface-2/60">
                        <Td className="whitespace-nowrap tabular-nums text-fg-muted">{formatSpDate(e.productionDate)}</Td>
                        <Td className="whitespace-nowrap font-mono text-[12px]">{e.workOrder || "—"}</Td>
                        <Td className="whitespace-nowrap font-mono text-[12px] font-medium">
                          {e.part?.title ?? "—"}
                          {e.dataQualityNotes && (
                            <span title={e.dataQualityNotes} className="ml-1 inline-flex align-middle text-ajax-yellow">
                              <Info className="h-3.5 w-3.5" aria-label="Changed on import" />
                            </span>
                          )}
                        </Td>
                        <Td className="text-right tabular-nums">{e.quantity ?? "—"}</Td>
                        <Td className={cn("text-right tabular-nums", (e.reworkQuantity ?? 0) > 0 && "font-semibold text-cooper-red")}>
                          {e.reworkQuantity ?? "—"}
                        </Td>
                        <Td className="whitespace-nowrap text-fg-muted">{e.builtBy || "—"}</Td>
                        <Td className="whitespace-nowrap text-fg-muted">{e.visualCheck || "—"}</Td>
                        <Td className="max-w-[22rem] text-fg-muted">
                          <span className="block truncate" title={e.comments}>
                            {e.comments || "—"}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap text-right">
                          <button
                            onClick={() => setEditing(e)}
                            className="rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
                            aria-label={`Edit ${e.title}`}
                            title="Edit entry"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => handleDelete(e)}
                              className="rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-cooper-red focus:opacity-100 group-hover:opacity-100"
                              aria-label={`Delete ${e.title}`}
                              title="Delete entry"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {capped && (
                <div className="flex justify-center">
                  <button
                    onClick={() => setShowAll(true)}
                    className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:border-fg-muted hover:text-fg"
                  >
                    Show all {filtered.length.toLocaleString()} entries
                  </button>
                </div>
              )}

              {!isAdmin && !adminResolving && (
                <p className="flex items-start gap-1.5 text-[11px] text-fg-muted">
                  <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>
                    You can add entries and correct mistakes. Deleting an entry, and adding or retiring a
                    part number, is limited to ARC admins.
                  </span>
                </p>
              )}
            </>
          )}
        </>
      )}

      {showNew && (
        <HarnessLogFormModal
          onClose={() => setShowNew(false)}
        />
      )}
      {editing && (
        <HarnessLogFormModal
          entry={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 align-top text-fg", className)}>{children}</td>;
}
