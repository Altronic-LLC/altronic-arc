import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, BellRing, ListOrdered, Lock, Pencil, Plus, Ruler, Trash2 } from "lucide-react";
import { useHarnessAlertRecipients } from "@/hooks/useHarnessAlertRecipients";
import {
  CRIMP_CONFIGURED,
  useCrimpCheck,
  useCrimpChecks,
  useDeleteCrimpCheck,
} from "@/hooks/useCrimpChecks";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { useSortableTable } from "@/hooks/useSortableTable";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { LoadingTasks } from "@/components/LoadingTasks";
import { MultiSelect, SingleSelect } from "@/components/SearchableSelect";
import { SearchInput } from "@/components/SearchInput";
import { SortableHeader } from "@/components/SortableTableHeader";
import { CrimpCheckFormModal } from "@/components/CrimpCheckFormModal";
import { CRIMP_FIRST_YEAR, type CrimpCheckScope } from "@/api/crimpChecks";
import { dayLabel, type SortColumn } from "@/lib/tableSort";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { byFrequency } from "@/lib/harnessLogMapper";
import { crimpLimits, formatCrimp, gaugeLabel, readingStatus, specText } from "@/lib/crimpCheck";
import { cn } from "@/lib/cn";
import type { CrimpCheck } from "@/types/crimp";

// =============================================================================
// Crimp Height Checks (BusinessIT#55) — the harness crimping area's log of
// micrometer readings, replacing the paper Terminal Crimp Verification Chart
// (MFGFRM 002). One row per CHECK: three readings at the start of a run, every
// 100 terminations, or the end of the run.
//
// A log-style table like the Harness Production Log: no detail page, the row
// opens its edit form. `/harness/crimp-checks/:id` opens one check — the
// link in an out-of-spec email.
//
// Every filter lives in the URL (year, terminal, result, q), so a view is
// shareable.
// =============================================================================

const INITIAL_ROWS = 200;

export function crimpYears(thisYear: number): number[] {
  const out: number[] = [];
  for (let y = thisYear; y >= Math.min(CRIMP_FIRST_YEAR, thisYear); y--) out.push(y);
  return out;
}

/** `?year=` → a scope. "all" is every year; anything unrecognised is this year. */
export function parseCrimpYear(raw: string | null, thisYear: number): CrimpCheckScope {
  if (raw === "all") return { kind: "all" };
  if (raw && /^\d{4}$/.test(raw)) {
    const y = parseInt(raw, 10);
    if (y >= CRIMP_FIRST_YEAR && y <= thisYear) return { kind: "year", year: y };
  }
  return { kind: "year", year: thisYear };
}

/** "In spec" / "Out of spec" / "Not judged" — the Result column and its filter. */
export function crimpResult(c: CrimpCheck): "In spec" | "Out of spec" | "Not judged" {
  if (c.outOfSpec) return "Out of spec";
  return crimpLimits(c.crimpHeight, c.tolerance) ? "In spec" : "Not judged";
}

function checkedAtText(d: Date | null): string {
  return d ? d.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }) : "—";
}

const reading = (i: number) => (c: CrimpCheck) => c.readings[i];

const CRIMP_COLUMNS: SortColumn<CrimpCheck>[] = [
  { key: "checkedAt", label: "Checked", kind: "date", value: (c) => dayLabel(c.checkedAt), sortValue: (c) => c.checkedAt },
  { key: "checkPoint", label: "Check", value: (c) => c.checkPoint ?? "" },
  { key: "terminal", label: "Terminal", value: (c) => c.terminal },
  { key: "wireGauge", label: "Gauge", value: (c) => gaugeLabel(c.wireGauge) },
  { key: "applicator", label: "Applicator", value: (c) => c.applicator },
  { key: "spec", label: "Spec", value: (c) => specText(c.crimpHeight, c.tolerance) },
  ...[0, 1, 2].map(
    (i): SortColumn<CrimpCheck> => ({
      key: `reading${i + 1}`,
      label: `R${i + 1}`,
      kind: "number",
      value: (c) => formatCrimp(reading(i)(c)),
      sortValue: reading(i),
      noFilter: true,
    }),
  ),
  { key: "average", label: "Avg", kind: "number", value: (c) => formatCrimp(c.average), sortValue: (c) => c.average, noFilter: true },
  { key: "clockNumber", label: "Clock #", value: (c) => c.clockNumber },
  { key: "harnessOrAssembly", label: "Harness / Assembly", value: (c) => c.harnessOrAssembly, noFilter: true },
  { key: "workOrder", label: "Work Order", value: (c) => c.workOrder, noFilter: true },
  { key: "result", label: "Result", value: crimpResult },
];

export function CrimpChecksView() {
  const navigate = useNavigate();
  const { id: idParam } = useParams();
  const linkedId = idParam && /^\d+$/.test(idParam) ? parseInt(idParam, 10) : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const scope = parseCrimpYear(searchParams.get("year"), thisYear);
  const scopeLabel = scope.kind === "all" ? "all years" : String(scope.year);

  const { data: checks = [], isLoading, error, refetch } = useCrimpChecks(scope);
  const deleteCheck = useDeleteCrimpCheck();
  const { isAdmin, isResolving: adminResolving } = useAdminAccess();
  const { data: recipients, isSuccess: recipientsLoaded } = useHarnessAlertRecipients();
  const nobodyToTell = recipientsLoaded && !recipients.some((r) => r.alert === "Crimp out of spec");

  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<CrimpCheck | null>(null);
  const [showAll, setShowAll] = useState(false);

  // The deep link: the check from the loaded year if it's there, else read alone.
  const linkedInList = linkedId !== null ? checks.find((c) => c.id === linkedId) ?? null : null;
  const { data: linkedAlone } = useCrimpCheck(linkedId !== null && !isLoading && !linkedInList ? linkedId : null);
  const linked = linkedInList ?? linkedAlone ?? null;
  const open = editing ?? linked;
  const closeEditor = () => {
    setEditing(null);
    if (linkedId !== null) navigate({ pathname: "/harness/crimp-checks", search: searchParams.toString() }, { replace: true });
  };

  const setParam = (key: string, value: string) => {
    const sp = new URLSearchParams(searchParams);
    if (value) sp.set(key, value);
    else sp.delete(key);
    setSearchParams(sp, { replace: true });
  };
  const query = searchParams.get("q") ?? "";
  const terminals = (searchParams.get("terminal") ?? "").split(",").filter(Boolean);
  const outOnly = searchParams.get("result") === "out";

  const terminalOptions = useMemo(
    () => byFrequency(checks.map((c) => c.terminal)).map((t) => ({ value: t, label: t })),
    [checks],
  );
  const clockSuggestions = useMemo(
    () => byFrequency(checks.flatMap((c) => [c.clockNumber, c.verifierClock])),
    [checks],
  );

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return checks.filter((c) => {
      if (terminals.length && !terminals.includes(c.terminal)) return false;
      if (outOnly && !c.outOfSpec) return false;
      if (tokens.length) {
        const hay = [c.terminal, c.applicator, c.wireGauge, c.clockNumber, c.verifierClock, c.harnessOrAssembly, c.workOrder, c.applicatorChange, c.notes]
          .join(" ")
          .toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [checks, query, terminals, outOnly]);

  const outCount = useMemo(() => filtered.filter((c) => c.outOfSpec).length, [filtered]);

  const table = useSortableTable<CrimpCheck>({
    rows: filtered,
    columns: CRIMP_COLUMNS,
    stableKey: (c) => c.id,
    initialKey: "checkedAt",
    initialDirection: "desc",
    onChange: () => setShowAll(false),
  });
  const capped = !showAll && table.rows.length > INITIAL_ROWS;
  const visible = capped ? table.rows.slice(0, INITIAL_ROWS) : table.rows;

  async function handleDelete(c: CrimpCheck) {
    if (!isAdmin) return;
    const ok = window.confirm(
      `Delete this check?\n\n${c.title}\n${checkedAtText(c.checkedAt)}\n\nThis removes it from SharePoint and can't be undone.`,
    );
    if (ok) await deleteCheck.mutateAsync(c.id);
  }

  const listUnavailable = !!error && isPermissionDenied(error);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <Ruler className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Crimp Height Checks</h1>
            <p className="text-xs text-fg-muted">
              Three readings at the start of a run, every 100 terminations and the end of the run. Showing {scopeLabel}.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* ARC admins only (Tim, 2026-10-27) — they're the ones who change it. */}
          {isAdmin && (
            <Link
              to="/harness/alert-recipients"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
            >
              <BellRing className="h-4 w-4" />
              Who's notified
            </Link>
          )}
          <Link
            to="/harness/crimp-checks/specs"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
          >
            <ListOrdered className="h-4 w-4" />
            Specs
          </Link>
          <button
            onClick={() => setShowNew(true)}
            disabled={!CRIMP_CONFIGURED || listUnavailable}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            New check
          </button>
        </div>
      </header>

      {isAdmin && CRIMP_CONFIGURED && nobodyToTell && (
        <div className="flex items-start gap-2 rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 p-3 text-xs text-fg">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-ajax-yellow" />
          <span>
            Nobody is set up to be emailed when a check is out of spec.{" "}
            <Link to="/harness/alert-recipients" className="font-semibold text-accent underline-offset-2 hover:underline">
              Choose who's notified
            </Link>
            . Until then, the person recording an out-of-spec check is told to tell their supervisor.
          </span>
        </div>
      )}

      {!CRIMP_CONFIGURED ? (
        <div className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 p-4 text-sm text-fg">
          Crimp Height Checks aren't set up yet. The two SharePoint lists are created by
          <code className="mx-1 font-mono text-xs">scripts/create-crimp-lists.ps1</code>
          and their ids go in the <code className="font-mono text-xs">VITE_SP_CRIMP_*</code> repo variables. A new build is
          needed after they're set.
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
                  ...crimpYears(thisYear).map((y) => ({ value: String(y), label: y === thisYear ? `${y} (current)` : String(y) })),
                  { value: "all", label: "All years" },
                ]}
                selected={scope.kind === "all" ? "all" : String(scope.year)}
                onChange={(v) => {
                  setParam("year", !v || v === String(thisYear) ? "" : v);
                  setShowAll(false);
                }}
              />
            </Field>
            <Field label="Terminal">
              <MultiSelect
                allLabel="All terminals"
                searchPlaceholder="Search terminals…"
                options={terminalOptions}
                selected={terminals}
                onChange={(next) => setParam("terminal", next.join(","))}
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
                placeholder="Terminal, clock #, harness, WO…"
                className="select"
              />
            </Field>
          </div>

          {listUnavailable ? (
            <ListAccessNotice list="Crimp Height Checks" site="Altronic_PMO" onRetry={() => void refetch()} />
          ) : error != null ? (
            <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs">
              <div className="mb-1 font-semibold text-cooper-red">Couldn't load the crimp height checks from SharePoint</div>
              <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg">
                {(error as Error)?.message ?? "Unknown error"}
              </pre>
              <button onClick={() => void refetch()} className="mt-2 font-semibold text-accent hover:underline">
                Try again
              </button>
            </div>
          ) : isLoading ? (
            <LoadingTasks noun="the crimp height checks" />
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
                      <span className="font-mono text-sm font-semibold text-fg">
                        {c.terminal} <span className="font-sans font-normal text-fg-muted">{gaugeLabel(c.wireGauge)}</span>
                      </span>
                      <ResultChip check={c} />
                    </div>
                    <div className="mt-1 font-mono text-xs tabular-nums">
                      <Readings check={c} />
                    </div>
                    <div className="mt-1 text-[11px] text-fg-muted">
                      {c.checkPoint ?? "—"} · {checkedAtText(c.checkedAt)} · Clock {c.clockNumber || "—"}
                    </div>
                  </button>
                ))}
              </div>

              <div className="scroll-elegant hidden overflow-x-auto rounded-lg border border-border sm:block">
                <table className="w-full min-w-[1200px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2 text-left">
                      {CRIMP_COLUMNS.map((column) => (
                        <SortableHeader key={column.key} label={column.label} {...table.headerProps(column.key)} />
                      ))}
                      <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => {
                      const limits = crimpLimits(c.crimpHeight, c.tolerance);
                      return (
                        <tr key={c.id} className="group border-b border-border last:border-0 hover:bg-surface-2/60">
                          <Td className="whitespace-nowrap tabular-nums text-fg-muted">{checkedAtText(c.checkedAt)}</Td>
                          <Td className="whitespace-nowrap">{c.checkPoint ?? "—"}</Td>
                          <Td className="whitespace-nowrap font-mono text-[12px] font-medium">{c.terminal || "—"}</Td>
                          <Td className="whitespace-nowrap">{gaugeLabel(c.wireGauge) || "—"}</Td>
                          <Td className="whitespace-nowrap font-mono text-[12px] text-fg-muted">{c.applicator || "—"}</Td>
                          <Td className="whitespace-nowrap font-mono text-[12px]">{specText(c.crimpHeight, c.tolerance)}</Td>
                          {c.readings.map((v, i) => {
                            const s = readingStatus(v, limits);
                            return (
                              <Td
                                key={i}
                                className={cn(
                                  "text-right font-mono text-[12px] tabular-nums",
                                  (s === "low" || s === "high") && "font-semibold text-cooper-red",
                                )}
                              >
                                {formatCrimp(v)}
                              </Td>
                            );
                          })}
                          <Td className="text-right font-mono text-[12px] tabular-nums">{formatCrimp(c.average)}</Td>
                          <Td className="whitespace-nowrap text-fg-muted">{c.clockNumber || "—"}</Td>
                          <Td className="max-w-48 text-fg-muted">
                            <span className="block truncate" title={c.harnessOrAssembly}>
                              {c.harnessOrAssembly || "—"}
                            </span>
                          </Td>
                          <Td className="whitespace-nowrap font-mono text-[12px] text-fg-muted">{c.workOrder || "—"}</Td>
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
                      );
                    })}
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
                    You can record checks and correct mistakes. Deleting a check, and changing the crimp specs, is limited to
                    ARC admins.
                  </span>
                </p>
              )}
            </>
          )}
        </>
      )}

      {showNew && <CrimpCheckFormModal clockSuggestions={clockSuggestions} onClose={() => setShowNew(false)} />}
      {open && <CrimpCheckFormModal key={open.id} check={open} clockSuggestions={clockSuggestions} onClose={closeEditor} />}
    </div>
  );
}

function Readings({ check }: { check: CrimpCheck }) {
  const limits = crimpLimits(check.crimpHeight, check.tolerance);
  return (
    <>
      {check.readings.map((v, i) => {
        const s = readingStatus(v, limits);
        return (
          <span key={i} className={cn("mr-2", (s === "low" || s === "high") && "font-semibold text-cooper-red")}>
            {formatCrimp(v)}
          </span>
        );
      })}
      <span className="text-fg-muted">avg {formatCrimp(check.average)}</span>
    </>
  );
}

/** Words AND colour — colour is never the only carrier. */
function ResultChip({ check }: { check: CrimpCheck }) {
  const result = crimpResult(check);
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

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 align-top text-fg", className)}>{children}</td>;
}
