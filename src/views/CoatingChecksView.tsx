import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, BellRing, Layers, ListOrdered, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useOperationsAlertRecipients } from "@/hooks/useOperationsAlertRecipients";
import {
  COATING_CONFIGURED,
  useCoatingCheck,
  useCoatingChecks,
  useDeleteCoatingCheck,
} from "@/hooks/useCoatingChecks";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { useOperationsEquipment } from "@/hooks/useOperationsTasks";
import { useSortableTable } from "@/hooks/useSortableTable";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { LoadingTasks } from "@/components/LoadingTasks";
import { MultiSelect, SingleSelect } from "@/components/SearchableSelect";
import { SearchInput } from "@/components/SearchInput";
import { SortableHeader } from "@/components/SortableTableHeader";
import { CoatingCheckFormModal } from "@/components/CoatingCheckFormModal";
import { COATING_FIRST_YEAR, type CoatingCheckScope } from "@/api/coatingChecks";
import { dayLabel, type SortColumn } from "@/lib/tableSort";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import {
  byFrequency,
  shortListSuggestions,
  coatingResult,
  coatingSpecRefText,
  coatingSpecText,
  formatCoatingReading,
  formatIn,
  formatMils,
  formatMm,
  thicknessText,
  UNIT_SHORT,
} from "@/lib/coatingCheck";
import { cn } from "@/lib/cn";
import type { CoatingCheck } from "@/types/coating";

// =============================================================================
// Conformal Coating Checks (BusinessIT#60, Operations) — the start-of-shift
// coating thickness log. One row per CHECK: three readings off an uncoated
// board, three off a coated one, worked out to a coating thickness and judged
// against the spec's min / max in the spec's own unit (mm or inches). The log
// shows the thickness in mm, inches and mils.
//
// A log-style table like Crimp Height Checks: no detail page, the row opens
// its edit form. `/operations/coating-checks/:id` opens one check — the link
// in an out-of-spec email. Every filter lives in the URL (year, machine,
// result, q), so a view is shareable.
// =============================================================================

const INITIAL_ROWS = 200;
const LIST_PATH = "/operations/coating-checks";

export function coatingYears(thisYear: number): number[] {
  const out: number[] = [];
  for (let y = thisYear; y >= Math.min(COATING_FIRST_YEAR, thisYear); y--) out.push(y);
  return out;
}

/** `?year=` → a scope. "all" is every year; anything unrecognised is this year. */
export function parseCoatingYear(raw: string | null, thisYear: number): CoatingCheckScope {
  if (raw === "all") return { kind: "all" };
  if (raw && /^\d{4}$/.test(raw)) {
    const y = parseInt(raw, 10);
    if (y >= COATING_FIRST_YEAR && y <= thisYear) return { kind: "year", year: y };
  }
  return { kind: "year", year: thisYear };
}

function measuredAtText(d: Date | null): string {
  return d ? d.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }) : "—";
}

/** "0.0621 in" — a side's average in the check's own unit. */
function avgText(value: number | null, c: CoatingCheck): string {
  return value === null ? "—" : `${formatCoatingReading(value, c.unit)} ${UNIT_SHORT[c.unit]}`;
}

const COATING_COLUMNS: SortColumn<CoatingCheck>[] = [
  { key: "measuredAt", label: "Measured", kind: "date", value: (c) => dayLabel(c.measuredAt), sortValue: (c) => c.measuredAt },
  { key: "machine", label: "Machine", value: (c) => c.machine },
  { key: "operator", label: "Operator", value: (c) => c.operator },
  { key: "spec", label: "Spec", value: (c) => c.specName },
  {
    key: "averages",
    label: "Uncoated → coated",
    value: (c) => `${avgText(c.uncoatedAverage, c)} → ${avgText(c.coatedAverage, c)}`,
    noFilter: true,
  },
  {
    key: "thicknessMm",
    label: "Coating (mm)",
    kind: "number",
    value: (c) => formatMm(c.thicknessMm),
    sortValue: (c) => c.thicknessMm,
    noFilter: true,
  },
  {
    key: "thicknessIn",
    label: "Coating (in)",
    kind: "number",
    value: (c) => formatIn(c.thicknessIn),
    sortValue: (c) => c.thicknessIn,
    noFilter: true,
  },
  {
    key: "thicknessMils",
    label: "Mils (ref)",
    kind: "number",
    value: (c) => formatMils(c.thicknessMils),
    sortValue: (c) => c.thicknessMils,
    noFilter: true,
  },
  { key: "result", label: "Result", value: coatingResult },
];

export function CoatingChecksView() {
  const navigate = useNavigate();
  const { id: idParam } = useParams();
  const linkedId = idParam && /^\d+$/.test(idParam) ? parseInt(idParam, 10) : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const scope = parseCoatingYear(searchParams.get("year"), thisYear);
  const scopeLabel = scope.kind === "all" ? "all years" : String(scope.year);

  const { data: checks = [], isLoading, error, refetch } = useCoatingChecks(scope);
  const deleteCheck = useDeleteCoatingCheck();
  const { isAdmin, isResolving: adminResolving } = useAdminAccess();
  const { data: recipients, isSuccess: recipientsLoaded } = useOperationsAlertRecipients();
  const nobodyToTell = recipientsLoaded && !recipients.some((r) => r.alert === "Coating out of spec");

  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<CoatingCheck | null>(null);
  const [showAll, setShowAll] = useState(false);

  // The deep link: the check from the loaded year if it's there, else read alone.
  const linkedInList = linkedId !== null ? checks.find((c) => c.id === linkedId) ?? null : null;
  const { data: linkedAlone } = useCoatingCheck(linkedId !== null && !isLoading && !linkedInList ? linkedId : null);
  const linked = linkedInList ?? linkedAlone ?? null;
  const open = editing ?? linked;
  const closeEditor = () => {
    setEditing(null);
    if (linkedId !== null) navigate({ pathname: LIST_PATH, search: searchParams.toString() }, { replace: true });
  };

  const setParam = (key: string, value: string) => {
    const sp = new URLSearchParams(searchParams);
    if (value) sp.set(key, value);
    else sp.delete(key);
    setSearchParams(sp, { replace: true });
  };
  const query = searchParams.get("q") ?? "";
  const machines = (searchParams.get("machine") ?? "").split(",").filter(Boolean);
  const outOnly = searchParams.get("result") === "out";

  // Suggestions: once checks exist, opening the box shows only what they used
  // (a short list); typing also searches the equipment register / the staff
  // directory, so a new machine can still be picked. Before any check, the
  // whole register is the list. See shortListSuggestions.
  const { data: equipment = [] } = useOperationsEquipment();
  const directory = useDirectoryPeople();
  const usedMachines = useMemo(() => byFrequency(checks.map((c) => c.machine)), [checks]);
  const machineLists = useMemo(
    () => shortListSuggestions(usedMachines, equipment.map((e) => e.title)),
    [usedMachines, equipment],
  );
  const operatorLists = useMemo(
    () => shortListSuggestions(byFrequency(checks.map((c) => c.operator)), directory.map((p) => p.displayName)),
    [checks, directory],
  );
  // The FILTER offers machines that have checks — a register machine with none filters to nothing.
  const machineOptions = useMemo(() => usedMachines.map((m) => ({ value: m, label: m })), [usedMachines]);

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return checks.filter((c) => {
      if (machines.length && !machines.includes(c.machine)) return false;
      if (outOnly && !c.outOfSpec) return false;
      if (tokens.length) {
        const hay = [c.machine, c.operator, c.specName, c.notes].join(" ").toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [checks, query, machines, outOnly]);

  const outCount = useMemo(() => filtered.filter((c) => c.outOfSpec).length, [filtered]);

  const table = useSortableTable<CoatingCheck>({
    rows: filtered,
    columns: COATING_COLUMNS,
    stableKey: (c) => c.id,
    initialKey: "measuredAt",
    initialDirection: "desc",
    onChange: () => setShowAll(false),
  });
  const capped = !showAll && table.rows.length > INITIAL_ROWS;
  const visible = capped ? table.rows.slice(0, INITIAL_ROWS) : table.rows;

  async function handleDelete(c: CoatingCheck) {
    if (!isAdmin) return;
    const ok = window.confirm(
      `Delete this check?\n\n${c.title}\n${measuredAtText(c.measuredAt)}\n\nThis removes it from SharePoint and can't be undone.`,
    );
    if (ok) await deleteCheck.mutateAsync(c.id).catch(() => undefined);
  }

  const listUnavailable = !!error && isPermissionDenied(error);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <Layers className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Conformal Coating Checks</h1>
            <p className="text-xs text-fg-muted">
              Coating thickness at the start of each shift — three readings off an uncoated board and three off a coated
              one. Showing {scopeLabel}.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isAdmin && (
            <Link
              to="/operations/alert-recipients"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
            >
              <BellRing className="h-4 w-4" />
              Who's notified
            </Link>
          )}
          <Link
            to="/operations/coating-checks/specs"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
          >
            <ListOrdered className="h-4 w-4" />
            Specs
          </Link>
          <button
            onClick={() => setShowNew(true)}
            disabled={!COATING_CONFIGURED || listUnavailable}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            New check
          </button>
        </div>
      </header>

      {isAdmin && COATING_CONFIGURED && nobodyToTell && (
        <div className="flex items-start gap-2 rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 p-3 text-xs text-fg">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-ajax-yellow" />
          <span>
            Nobody is set up to be emailed when a coating check is out of spec.{" "}
            <Link to="/operations/alert-recipients" className="font-semibold text-accent underline-offset-2 hover:underline">
              Choose who's notified
            </Link>
            . Until then, the person recording an out-of-spec check is told to tell their supervisor.
          </span>
        </div>
      )}

      {!COATING_CONFIGURED ? (
        <div className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 p-4 text-sm text-fg">
          Conformal Coating Checks aren't set up yet. The SharePoint lists are created by
          <code className="mx-1 font-mono text-xs">scripts/create-coating-lists.ps1</code>
          and their ids go in the <code className="font-mono text-xs">VITE_SP_COATING_*</code> repo variables. A new build
          is needed after they're set.
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
                  ...coatingYears(thisYear).map((y) => ({ value: String(y), label: y === thisYear ? `${y} (current)` : String(y) })),
                  { value: "all", label: "All years" },
                ]}
                selected={scope.kind === "all" ? "all" : String(scope.year)}
                onChange={(v) => {
                  setParam("year", !v || v === String(thisYear) ? "" : v);
                  setShowAll(false);
                }}
              />
            </Field>
            <Field label="Machine">
              <MultiSelect
                allLabel="All machines"
                searchPlaceholder="Search machines…"
                options={machineOptions}
                selected={machines}
                onChange={(next) => setParam("machine", next.join(","))}
              />
            </Field>
            <Field label="Result">
              <SingleSelect
                allLabel="All checks"
                ariaLabel="Result"
                options={[{ value: "out", label: "Out of spec only" }]}
                selected={outOnly ? "out" : null}
                onChange={(v) => setParam("result", v ?? "")}
              />
            </Field>
            <Field label="Search">
              <SearchInput
                value={query}
                onChange={(q) => setParam("q", q)}
                placeholder="Machine, operator, spec, notes…"
                className="select"
              />
            </Field>
          </div>

          {listUnavailable ? (
            <ListAccessNotice list="Coating Checks" site="Altronic_PMO" onRetry={() => void refetch()} />
          ) : error != null ? (
            <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs">
              <div className="mb-1 font-semibold text-cooper-red">Couldn't load the coating checks from SharePoint</div>
              <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg">
                {(error as Error)?.message ?? "Unknown error"}
              </pre>
              <button onClick={() => void refetch()} className="mt-2 font-semibold text-accent hover:underline">
                Try again
              </button>
            </div>
          ) : isLoading ? (
            <LoadingTasks noun="the coating checks" />
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
              {checks.length === 0
                ? `No checks recorded in ${scopeLabel} yet. Click 'New check' to record the first one.`
                : "No checks match the current filters."}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-fg-muted">
                <span>
                  {capped
                    ? `Showing the first ${INITIAL_ROWS.toLocaleString()} of ${filtered.length.toLocaleString()} matching checks`
                    : `Showing ${filtered.length.toLocaleString()} of ${checks.length.toLocaleString()} checks in ${scopeLabel}`}
                </span>
                <span className={cn(outCount > 0 && "font-semibold text-cooper-red")}>
                  {outCount.toLocaleString()} out of spec
                </span>
                {capped && (
                  <button onClick={() => setShowAll(true)} className="font-semibold text-accent underline-offset-2 hover:underline">
                    Show all {filtered.length.toLocaleString()}
                  </button>
                )}
              </div>

              {/* Phone: cards. Desktop: the sortable table. Both render the same rows. */}
              <div className="flex flex-col gap-2 sm:hidden">
                {visible.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setEditing(c)}
                    className={cn(
                      "rounded-lg border bg-surface p-3 text-left",
                      c.outOfSpec ? "border-cooper-red/50" : "border-border",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-fg">{c.machine || "—"}</span>
                      <ResultChip check={c} />
                    </div>
                    <div className="mt-1 text-xs">
                      <span className={cn("font-mono tabular-nums", c.outOfSpec && "font-semibold text-cooper-red")}>
                        {thicknessText(c.thicknessMm, c.specUnit)}
                      </span>{" "}
                      <span className="text-fg-muted">· {coatingSpecText(c.minMm, c.maxMm, c.specUnit)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-fg-muted">
                      {measuredAtText(c.measuredAt)} · {c.operator || "—"} · {c.specName}
                    </div>
                  </button>
                ))}
              </div>

              <div className="scroll-elegant hidden overflow-x-auto rounded-lg border border-border sm:block">
                <table className="w-full min-w-[1000px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2 text-left">
                      {COATING_COLUMNS.map((column) => (
                        <SortableHeader key={column.key} label={column.label} {...table.headerProps(column.key)} />
                      ))}
                      <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => (
                      <tr key={c.id} className="group border-b border-border last:border-0 hover:bg-surface-2/60">
                        <Td className="whitespace-nowrap tabular-nums text-fg-muted">{measuredAtText(c.measuredAt)}</Td>
                        <Td className="whitespace-nowrap font-medium">{c.machine || "—"}</Td>
                        <Td className="whitespace-nowrap text-fg-muted">{c.operator || "—"}</Td>
                        <Td className="whitespace-nowrap">
                          <span className="block">{c.specName || "—"}</span>
                          <span
                            className="block font-mono text-[11px] text-fg-muted"
                            title={coatingSpecRefText(c.minMm, c.maxMm, c.specUnit)}
                          >
                            {coatingSpecText(c.minMm, c.maxMm, c.specUnit)}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap font-mono text-[12px] tabular-nums text-fg-muted">
                          {avgText(c.uncoatedAverage, c)} → {avgText(c.coatedAverage, c)}
                        </Td>
                        <Td
                          className={cn(
                            "text-right font-mono text-[12px] tabular-nums",
                            c.outOfSpec && "font-semibold text-cooper-red",
                          )}
                        >
                          {formatMm(c.thicknessMm)}
                        </Td>
                        <Td
                          className={cn(
                            "text-right font-mono text-[12px] tabular-nums",
                            c.outOfSpec && "font-semibold text-cooper-red",
                          )}
                        >
                          {formatIn(c.thicknessIn)}
                        </Td>
                        <Td className="text-right font-mono text-[12px] tabular-nums text-fg-muted">
                          {formatMils(c.thicknessMils)}
                        </Td>
                        <Td className="whitespace-nowrap">
                          <ResultChip check={c} />
                        </Td>
                        <Td className="whitespace-nowrap text-right">
                          <button
                            onClick={() => setEditing(c)}
                            className="rounded-sm p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
                            aria-label={`Edit ${c.title}`}
                            title="Edit check"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => handleDelete(c)}
                              className="rounded-sm p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-cooper-red focus:opacity-100 group-hover:opacity-100"
                              aria-label={`Delete ${c.title}`}
                              title="Delete check"
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
                    Show all {filtered.length.toLocaleString()} checks
                  </button>
                </div>
              )}

              {!isAdmin && !adminResolving && (
                <p className="flex items-start gap-1.5 text-[11px] text-fg-muted">
                  <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>
                    You can record checks and correct mistakes. Deleting a check, and changing the coating specs, is limited
                    to ARC admins.
                  </span>
                </p>
              )}
            </>
          )}
        </>
      )}

      {showNew && (
        <CoatingCheckFormModal
          machineSuggestions={machineLists.options}
          machineSearch={machineLists.search}
          operatorSuggestions={operatorLists.options}
          operatorSearch={operatorLists.search}
          onClose={() => setShowNew(false)}
        />
      )}
      {open && (
        <CoatingCheckFormModal
          key={open.id}
          check={open}
          machineSuggestions={machineLists.options}
          machineSearch={machineLists.search}
          operatorSuggestions={operatorLists.options}
          operatorSearch={operatorLists.search}
          onClose={closeEditor}
        />
      )}
    </div>
  );
}

/** Words AND colour — colour is never the only carrier. */
function ResultChip({ check }: { check: CoatingCheck }) {
  const result = coatingResult(check);
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-[11px] font-semibold",
        result === "Out of spec"
          ? "bg-cooper-red/15 text-cooper-red"
          : result === "In spec"
            ? "bg-cooper-green/15 text-cooper-green"
            : "bg-surface-2 text-fg-muted",
      )}
    >
      {result}
    </span>
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

function Td({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <td className={cn("px-3 py-2 align-top text-fg", className)} title={title || undefined}>
      {children}
    </td>
  );
}
