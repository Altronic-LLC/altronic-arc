import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, BellRing, ListOrdered, Lock, Pencil, Plus, Trash2, Weight } from "lucide-react";
import { useHarnessAlertRecipients } from "@/hooks/useHarnessAlertRecipients";
import { PULL_TESTS_CONFIGURED, useDeletePullTest, usePullTest, usePullTests } from "@/hooks/usePullTests";
import { useAdminAccess } from "@/hooks/useIsAdmin";
import { useSortableTable } from "@/hooks/useSortableTable";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { LoadingTasks } from "@/components/LoadingTasks";
import { MultiSelect, SingleSelect } from "@/components/SearchableSelect";
import { SearchInput } from "@/components/SearchInput";
import { SortableHeader } from "@/components/SortableTableHeader";
import { PullTestFormModal } from "@/components/PullTestFormModal";
import { PULL_TEST_FIRST_YEAR, type PullTestScope } from "@/api/pullTests";
import { dayLabel, type SortColumn } from "@/lib/tableSort";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { byFrequency } from "@/lib/harnessLogMapper";
import { gaugeLabel } from "@/lib/crimpCheck";
import { failureModeSuggestions, formatForce, forceText, minimumShort, pullResult, pullStatus } from "@/lib/pullTest";
import { cn } from "@/lib/cn";
import type { PullTest } from "@/types/pullTest";

// =============================================================================
// Pull Tests (BusinessIT#64) — the harness area's log of pulls on the Mark-10
// WT-205, judged against each terminal's minimum. For the machined DriveCOM
// pins that crimp height can't judge, and for stamped terminals too.
//
// The Crimp Height Checks screen, copied: a log-style table with no detail
// page — the row opens its edit form, and `/harness/pull-tests/:id` opens one
// test (the link in a failed-pull email). Every filter lives in the URL
// (year, terminal, result, q).
// =============================================================================

const INITIAL_ROWS = 200;

export function pullTestYears(thisYear: number): number[] {
  const out: number[] = [];
  for (let y = thisYear; y >= Math.min(PULL_TEST_FIRST_YEAR, thisYear); y--) out.push(y);
  return out;
}

/** `?year=` → a scope. "all" is every year; anything unrecognised is this year. */
export function parsePullTestYear(raw: string | null, thisYear: number): PullTestScope {
  if (raw === "all") return { kind: "all" };
  if (raw && /^\d{4}$/.test(raw)) {
    const y = parseInt(raw, 10);
    if (y >= PULL_TEST_FIRST_YEAR && y <= thisYear) return { kind: "year", year: y };
  }
  return { kind: "year", year: thisYear };
}

function testedAtText(d: Date | null): string {
  return d ? d.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }) : "—";
}

/** "31.2 · 30.8 · 32.0" — every pull that's there, in the test's own unit. */
function pullsText(t: PullTest): string {
  return t.readings.filter((v): v is number => v !== null).map(formatForce).join(" · ");
}

const PULL_TEST_COLUMNS: SortColumn<PullTest>[] = [
  { key: "testedAt", label: "Tested", kind: "date", value: (t) => dayLabel(t.testedAt), sortValue: (t) => t.testedAt },
  { key: "checkPoint", label: "Test", value: (t) => t.checkPoint ?? "" },
  { key: "terminal", label: "Terminal", value: (t) => t.terminal },
  { key: "wireGauge", label: "Gauge", value: (t) => gaugeLabel(t.wireGauge) },
  { key: "minimum", label: "Minimum", kind: "number", value: (t) => minimumShort(t.minimumForce, t.specUnit), sortValue: (t) => t.minimumForce },
  { key: "pulls", label: "Pulls", value: pullsText, noFilter: true },
  { key: "lowest", label: "Lowest", kind: "number", value: (t) => forceText(t.lowest, t.unit), sortValue: (t) => t.lowest, noFilter: true },
  { key: "clockNumber", label: "Clock #", value: (t) => t.clockNumber },
  { key: "readingSource", label: "Read by", value: (t) => t.readingSource ?? "" },
  { key: "howFailed", label: "How it failed", value: (t) => t.howFailed },
  { key: "harnessOrAssembly", label: "Harness / Assembly", value: (t) => t.harnessOrAssembly, noFilter: true },
  { key: "workOrder", label: "Work Order", value: (t) => t.workOrder, noFilter: true },
  { key: "result", label: "Result", value: pullResult },
];

export function PullTestsView() {
  const navigate = useNavigate();
  const { id: idParam } = useParams();
  const linkedId = idParam && /^\d+$/.test(idParam) ? parseInt(idParam, 10) : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const scope = parsePullTestYear(searchParams.get("year"), thisYear);
  const scopeLabel = scope.kind === "all" ? "all years" : String(scope.year);

  const { data: tests = [], isLoading, error, refetch } = usePullTests(scope);
  const deleteTest = useDeletePullTest();
  const { isAdmin, isResolving: adminResolving } = useAdminAccess();
  const { data: recipients, isSuccess: recipientsLoaded } = useHarnessAlertRecipients();
  const nobodyToTell = recipientsLoaded && !recipients.some((r) => r.alert === "Pull test failed");

  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<PullTest | null>(null);
  const [showAll, setShowAll] = useState(false);

  // The deep link: the test from the loaded year if it's there, else read alone.
  const linkedInList = linkedId !== null ? tests.find((t) => t.id === linkedId) ?? null : null;
  const { data: linkedAlone } = usePullTest(linkedId !== null && !isLoading && !linkedInList ? linkedId : null);
  const linked = linkedInList ?? linkedAlone ?? null;
  const open = editing ?? linked;
  const closeEditor = () => {
    setEditing(null);
    if (linkedId !== null) navigate({ pathname: "/harness/pull-tests", search: searchParams.toString() }, { replace: true });
  };

  const setParam = (key: string, value: string) => {
    const sp = new URLSearchParams(searchParams);
    if (value) sp.set(key, value);
    else sp.delete(key);
    setSearchParams(sp, { replace: true });
  };
  const query = searchParams.get("q") ?? "";
  const terminals = (searchParams.get("terminal") ?? "").split(",").filter(Boolean);
  const failedOnly = searchParams.get("result") === "fail";

  const terminalOptions = useMemo(
    () => byFrequency(tests.map((t) => t.terminal)).map((t) => ({ value: t, label: t })),
    [tests],
  );
  const clockSuggestions = useMemo(() => byFrequency(tests.map((t) => t.clockNumber)), [tests]);
  const terminalSuggestions = useMemo(() => byFrequency(tests.map((t) => t.terminal)), [tests]);
  const howFailedSuggestions = useMemo(() => failureModeSuggestions(tests.map((t) => t.howFailed)), [tests]);

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return tests.filter((t) => {
      if (terminals.length && !terminals.includes(t.terminal)) return false;
      if (failedOnly && !t.failed) return false;
      if (tokens.length) {
        const hay = [t.terminal, t.wireGauge, t.reference, t.applicator, t.clockNumber, t.howFailed, t.harnessOrAssembly, t.workOrder, t.notes]
          .join(" ")
          .toLowerCase();
        if (!tokens.every((tok) => hay.includes(tok))) return false;
      }
      return true;
    });
  }, [tests, query, terminals, failedOnly]);

  const failedCount = useMemo(() => filtered.filter((t) => t.failed).length, [filtered]);

  const table = useSortableTable<PullTest>({
    rows: filtered,
    columns: PULL_TEST_COLUMNS,
    stableKey: (t) => t.id,
    initialKey: "testedAt",
    initialDirection: "desc",
    onChange: () => setShowAll(false),
  });
  const capped = !showAll && table.rows.length > INITIAL_ROWS;
  const visible = capped ? table.rows.slice(0, INITIAL_ROWS) : table.rows;

  async function handleDelete(t: PullTest) {
    if (!isAdmin) return;
    const ok = window.confirm(
      `Delete this pull test?\n\n${t.title}\n${testedAtText(t.testedAt)}\n\nThis removes it from SharePoint and can't be undone.`,
    );
    if (ok) await deleteTest.mutateAsync(t.id);
  }

  const listUnavailable = !!error && isPermissionDenied(error);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ajax-yellow/15 text-ajax-yellow">
            <Weight className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Pull Tests</h1>
            <p className="text-xs text-fg-muted">
              Pulls on the Mark-10 tester at the start of a run, in process and at the end, against each terminal's
              minimum. Showing {scopeLabel}.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
            to="/harness/pull-tests/specs"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
          >
            <ListOrdered className="h-4 w-4" />
            Specs
          </Link>
          <button
            onClick={() => setShowNew(true)}
            disabled={!PULL_TESTS_CONFIGURED || listUnavailable}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            New test
          </button>
        </div>
      </header>

      {isAdmin && PULL_TESTS_CONFIGURED && nobodyToTell && (
        <div className="flex items-start gap-2 rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 p-3 text-xs text-fg">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-ajax-yellow" />
          <span>
            Nobody is set up to be emailed when a pull test fails.{" "}
            <Link to="/harness/alert-recipients" className="font-semibold text-accent underline-offset-2 hover:underline">
              Choose who's notified
            </Link>
            . Until then, the person recording a failed test is told to tell their supervisor.
          </span>
        </div>
      )}

      {!PULL_TESTS_CONFIGURED ? (
        <div className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 p-4 text-sm text-fg">
          Pull Tests aren't set up yet. The two SharePoint lists are created by
          <code className="mx-1 font-mono text-xs">scripts/create-pull-test-lists.ps1</code>
          and their ids go in the <code className="font-mono text-xs">VITE_SP_PULL_TEST*</code> repo variables. A new build
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
                  ...pullTestYears(thisYear).map((y) => ({ value: String(y), label: y === thisYear ? `${y} (current)` : String(y) })),
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
                allLabel="All tests"
                ariaLabel="Result"
                options={[{ value: "fail", label: "Failed only" }]}
                selected={failedOnly ? "fail" : null}
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
            <ListAccessNotice list="Pull Tests" site="Altronic_PMO" onRetry={() => void refetch()} />
          ) : error != null ? (
            <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs">
              <div className="mb-1 font-semibold text-cooper-red">Couldn't load the pull tests from SharePoint</div>
              <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg">
                {(error as Error)?.message ?? "Unknown error"}
              </pre>
              <button onClick={() => void refetch()} className="mt-2 font-semibold text-accent hover:underline">
                Try again
              </button>
            </div>
          ) : isLoading ? (
            <LoadingTasks noun="the pull tests" />
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
              {tests.length === 0
                ? `No pull tests recorded in ${scopeLabel} yet. Click 'New test' to record the first one.`
                : "No pull tests match the current filters."}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-fg-muted">
                <span>
                  {capped
                    ? `Showing the first ${INITIAL_ROWS.toLocaleString()} of ${filtered.length.toLocaleString()} matching tests`
                    : `Showing ${filtered.length.toLocaleString()} of ${tests.length.toLocaleString()} tests in ${scopeLabel}`}
                </span>
                <span className={cn(failedCount > 0 && "font-semibold text-cooper-red")}>
                  {failedCount.toLocaleString()} failed
                </span>
                {capped && (
                  <button onClick={() => setShowAll(true)} className="font-semibold text-accent underline-offset-2 hover:underline">
                    Show all {filtered.length.toLocaleString()}
                  </button>
                )}
              </div>

              {/* Phone: cards. Desktop: the sortable table. Both render the same rows. */}
              <div className="flex flex-col gap-2 sm:hidden">
                {visible.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setEditing(t)}
                    className={cn("rounded-lg border bg-surface p-3 text-left", t.failed ? "border-cooper-red/50" : "border-border")}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-fg">
                        {t.terminal} <span className="font-sans font-normal text-fg-muted">{gaugeLabel(t.wireGauge)}</span>
                      </span>
                      <ResultChip test={t} />
                    </div>
                    <div className="mt-1 font-mono text-xs tabular-nums">
                      <Pulls test={t} /> <span className="text-fg-muted">{t.unit}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-fg-muted">
                      {t.checkPoint ?? "—"} · {testedAtText(t.testedAt)} · Clock {t.clockNumber || "—"} ·{" "}
                      {minimumShort(t.minimumForce, t.specUnit)}
                    </div>
                    {t.howFailed && <div className="mt-1 text-[11px] text-fg-muted">How it failed: {t.howFailed}</div>}
                  </button>
                ))}
              </div>

              <div className="scroll-elegant hidden overflow-x-auto rounded-lg border border-border sm:block">
                <table className="w-full min-w-[1200px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2 text-left">
                      {PULL_TEST_COLUMNS.map((column) => (
                        <SortableHeader key={column.key} label={column.label} {...table.headerProps(column.key)} />
                      ))}
                      <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((t) => (
                      <tr key={t.id} className="group border-b border-border last:border-0 hover:bg-surface-2/60">
                        <Td className="whitespace-nowrap tabular-nums text-fg-muted">{testedAtText(t.testedAt)}</Td>
                        <Td className="whitespace-nowrap">{t.checkPoint ?? "—"}</Td>
                        <Td className="whitespace-nowrap font-mono text-[12px] font-medium">{t.terminal || "—"}</Td>
                        <Td className="whitespace-nowrap">{gaugeLabel(t.wireGauge) || "—"}</Td>
                        <Td className="whitespace-nowrap font-mono text-[12px]" title={t.reference || undefined}>
                          {minimumShort(t.minimumForce, t.specUnit)}
                        </Td>
                        <Td className="whitespace-nowrap font-mono text-[12px] tabular-nums">
                          <Pulls test={t} /> <span className="text-fg-muted">{t.unit}</span>
                        </Td>
                        <Td className="text-right font-mono text-[12px] tabular-nums">{formatForce(t.lowest)}</Td>
                        <Td className="whitespace-nowrap text-fg-muted">{t.clockNumber || "—"}</Td>
                        <Td className="whitespace-nowrap text-fg-muted">{t.readingSource ?? "—"}</Td>
                        <Td className="max-w-48 text-fg-muted">
                          <span className="block truncate" title={t.howFailed}>
                            {t.howFailed || "—"}
                          </span>
                        </Td>
                        <Td className="max-w-48 text-fg-muted">
                          <span className="block truncate" title={t.harnessOrAssembly}>
                            {t.harnessOrAssembly || "—"}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap font-mono text-[12px] text-fg-muted">{t.workOrder || "—"}</Td>
                        <Td className="whitespace-nowrap">
                          <ResultChip test={t} />
                        </Td>
                        <Td className="whitespace-nowrap text-right">
                          <button
                            onClick={() => setEditing(t)}
                            className="rounded-sm p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
                            aria-label={`Edit ${t.title}`}
                            title="Edit test"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => handleDelete(t)}
                              className="rounded-sm p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-cooper-red focus:opacity-100 group-hover:opacity-100"
                              aria-label={`Delete ${t.title}`}
                              title="Delete test"
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
                    Show all {filtered.length.toLocaleString()} tests
                  </button>
                </div>
              )}

              {!isAdmin && !adminResolving && (
                <p className="flex items-start gap-1.5 text-[11px] text-fg-muted">
                  <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>
                    You can record pull tests and correct mistakes. Deleting a test, and changing the specs, is limited to
                    ARC admins.
                  </span>
                </p>
              )}
            </>
          )}
        </>
      )}

      {showNew && (
        <PullTestFormModal
          clockSuggestions={clockSuggestions}
          terminalSuggestions={terminalSuggestions}
          howFailedSuggestions={howFailedSuggestions}
          onClose={() => setShowNew(false)}
        />
      )}
      {open && (
        <PullTestFormModal
          key={open.id}
          test={open}
          clockSuggestions={clockSuggestions}
          terminalSuggestions={terminalSuggestions}
          howFailedSuggestions={howFailedSuggestions}
          onClose={closeEditor}
        />
      )}
    </div>
  );
}

/** The pulls, a failing one in red AND bold — colour is never the only carrier. */
function Pulls({ test }: { test: PullTest }) {
  return (
    <>
      {test.readings.map((v, i) =>
        v === null ? null : (
          <span
            key={i}
            className={cn(
              "mr-2",
              pullStatus(v, test.unit, test.minimumForce, test.specUnit) === "low" && "font-semibold text-cooper-red",
            )}
          >
            {formatForce(v)}
          </span>
        ),
      )}
    </>
  );
}

function ResultChip({ test }: { test: PullTest }) {
  const result = pullResult(test);
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-[11px] font-semibold",
        result === "Fail"
          ? "bg-cooper-red/15 text-cooper-red"
          : result === "Pass"
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
    <td className={cn("px-3 py-2 align-top text-fg", className)} title={title}>
      {children}
    </td>
  );
}
