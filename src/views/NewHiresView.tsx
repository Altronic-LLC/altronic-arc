import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, UserPlus } from "lucide-react";
import { useNewHires } from "@/hooks/useNewHires";
import { NEW_HIRES_CONFIGURED } from "@/api/config";
import { NEW_HIRE_STATUSES, type NewHire } from "@/types/hr";
import { isOpenNewHire, startDateLabel, startLabel, stepProgress } from "@/lib/newHire";
import { parseIsoDate } from "@/lib/dateInput";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import type { SortColumn } from "@/lib/tableSort";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableHeader } from "@/components/SortableTableHeader";
import { SearchInput } from "@/components/SearchInput";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { NewHireFormModal } from "@/components/NewHireFormModal";
import { HrAccessGate, HrNav, NewHireStatusChip } from "@/components/hrAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// New Hires (/hr/new-hires) — everybody HR is bringing in, soonest start
// first. Opens on the OPEN ones (Submitted, In progress); Complete, Cancelled
// and All are a click away, and the choice is in the URL. Every column sorts
// and filters; a phone gets cards. Only people with the New Hire role get
// here (HrAccessGate) — and the list's own SharePoint permissions are what
// actually keep it private.
// =============================================================================

const OPEN = "Open";
const ALL = "All";

function inStatus(h: NewHire, status: string): boolean {
  if (status === OPEN) return isOpenNewHire(h);
  if (status === ALL) return true;
  return h.status === status;
}

function progressText(h: NewHire): string {
  const { done, total } = stepProgress(h);
  return `${done}/${total}`;
}

const COLUMNS: SortColumn<NewHire>[] = [
  { key: "name", label: "Name", value: (h) => h.displayName, noFilter: true },
  {
    key: "start",
    label: "Start date",
    kind: "date",
    value: (h) => startDateLabel(h.startDate),
    sortValue: (h) => parseIsoDate(h.startDate),
  },
  { key: "department", label: "Department", value: (h) => h.department },
  { key: "jobTitle", label: "Job title", value: (h) => h.jobTitle },
  { key: "type", label: "Type", value: (h) => h.employmentType ?? "" },
  { key: "manager", label: "Manager", value: (h) => h.manager?.displayName ?? "" },
  {
    key: "progress",
    label: "Steps",
    kind: "number",
    value: progressText,
    sortValue: (h) => {
      const { done, total } = stepProgress(h);
      return total === 0 ? 0 : done / total;
    },
  },
  { key: "status", label: "Status", value: (h) => h.status },
];

export function NewHiresView() {
  return (
    <HrAccessGate app="newHire">
      <NewHiresList />
    </HrAccessGate>
  );
}

function NewHiresList() {
  const navigate = useNavigate();
  const { data: hires = [], isLoading, error, refetch } = useNewHires();
  const listUnavailable = !!error && isPermissionDenied(error);
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const q = params.get("q") ?? "";
  const status = params.get("status") || OPEN;
  const today = new Date();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const searched = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return hires.filter((h) => matchesSearch(h, tokens));
  }, [hires, q]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { [OPEN]: 0, [ALL]: searched.length };
    for (const s of NEW_HIRE_STATUSES) out[s] = 0;
    for (const h of searched) {
      if (isOpenNewHire(h)) out[OPEN] += 1;
      out[h.status] += 1;
    }
    return out;
  }, [searched]);

  const filtered = useMemo(() => searched.filter((h) => inStatus(h, status)), [searched, status]);

  const table = useSortableTable<NewHire>({
    rows: filtered,
    columns: COLUMNS,
    stableKey: (h) => h.id,
    initialKey: "start",
    initialDirection: "asc",
  });

  const pills = [OPEN, ALL, ...NEW_HIRE_STATUSES];

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-green/10 text-cooper-green">
            <UserPlus className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">New Hires</h1>
            <p className="text-sm text-fg-muted">
              Kick off SAP and IT for somebody starting — and see when everything is ready for their first day.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowNew(true)}
          disabled={!NEW_HIRES_CONFIGURED}
          className="inline-flex items-center gap-1.5 self-start rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          New hire
        </button>
      </header>

      <HrNav />

      {!NEW_HIRES_CONFIGURED ? (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-fg-muted">
          The New Hires list isn't set up yet: VITE_SP_NEW_HIRES_LIST_ID is not set.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-surface-2 p-1">
            {pills.map((pill) => (
              <button
                key={pill}
                onClick={() => setParam("status", pill === OPEN ? "" : pill)}
                aria-pressed={status === pill}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  status === pill ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg",
                )}
              >
                {pill}
                <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-bold tabular-nums">{counts[pill] ?? 0}</span>
              </button>
            ))}
          </div>

          <div role="search" aria-label="New hire search" className="rounded-xl border border-border bg-surface p-3">
            <SearchInput value={q} onChange={(v) => setParam("q", v)} placeholder="Name, job, department, manager…" />
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
              {isLoading ? "Loading…" : `${filtered.length} new hire${filtered.length === 1 ? "" : "s"}`}
            </div>

            {isLoading ? (
              <LoadingTasks noun="new hires" />
            ) : listUnavailable ? (
              <div className="p-4">
                <ListAccessNotice list="New Hires" site="the HR site" onRetry={() => void refetch()} />
              </div>
            ) : error ? (
              <div className="px-4 py-10 text-center text-sm text-fg-muted">
                <p className="font-medium text-fg">Couldn't load new hires.</p>
                <p className="mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
                >
                  Try again
                </button>
              </div>
            ) : hires.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-fg-muted">
                <p className="font-medium text-fg">No new hires yet.</p>
                <p className="mt-1">Submit the first one with New hire.</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-fg-muted">
                {status === OPEN && !q ? "Nobody in progress. Switch to All to see complete and cancelled new hires." : "No new hires match."}
              </div>
            ) : (
              <>
                {/* Two renderings of the SAME rows, split at `sm`. jsdom renders
                    both — tests use getAllBy*. */}
                <div className="divide-y divide-border sm:hidden">
                  {table.rows.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => navigate(`/hr/new-hires/${h.id}`)}
                      className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-fg">{h.displayName || `#${h.id}`}</span>
                        <span className="ml-auto">
                          <NewHireStatusChip status={h.status} />
                        </span>
                      </span>
                      <span className="truncate text-sm text-fg">{[h.jobTitle, h.department].filter(Boolean).join(" · ")}</span>
                      <span className="truncate text-xs text-fg-muted">
                        {[startDateLabel(h.startDate), isOpenNewHire(h) ? startLabel(h.startDate, today) : "", `Steps ${progressText(h)}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                      <tr>
                        {COLUMNS.map((c) => (
                          <SortableHeader key={c.key} label={c.label} {...table.headerProps(c.key)} />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((h) => (
                        <tr
                          key={h.id}
                          onClick={() => navigate(`/hr/new-hires/${h.id}`)}
                          className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
                        >
                          <td className="whitespace-nowrap px-4 py-2 font-medium text-fg">
                            <Link
                              to={`/hr/new-hires/${h.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="hover:text-accent hover:underline"
                            >
                              {h.displayName || `#${h.id}`}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
                            <span className="block">{startDateLabel(h.startDate) || "—"}</span>
                            {isOpenNewHire(h) && <span className="block text-[11px]">{startLabel(h.startDate, today)}</span>}
                          </td>
                          <td className="max-w-[12rem] truncate px-4 py-2 text-fg-muted">{h.department || "—"}</td>
                          <td className="max-w-[14rem] truncate px-4 py-2 text-fg">{h.jobTitle || "—"}</td>
                          <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{h.employmentType ?? "—"}</td>
                          <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{h.manager?.displayName ?? "—"}</td>
                          <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">{progressText(h)}</td>
                          <td className="px-4 py-2">
                            <NewHireStatusChip status={h.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {showNew && <NewHireFormModal onClose={() => setShowNew(false)} onCreated={(id) => navigate(`/hr/new-hires/${id}`)} />}
    </div>
  );
}
