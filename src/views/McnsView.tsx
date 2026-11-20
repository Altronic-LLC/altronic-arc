import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Factory, MessageSquare, Paperclip, Plus } from "lucide-react";
import { useMcns } from "@/hooks/useMcns";
import { useMyMcnAccess } from "@/hooks/useMcnRoles";
import { useMaintenanceDepartments } from "@/hooks/useMaintenanceReferenceLists";
import { MCN_OPEN_STATUSES, MCN_STATUSES, type Mcn } from "@/types/mcn";
import { scopeDepartmentLabel } from "@/lib/mcnMapper";
import { raiseMcnGate } from "@/lib/mcnRoles";
import { awaitingApproval } from "@/lib/mcnWorkflow";
import { parseMcnNumber } from "@/lib/mcnNumber";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { isPermissionDenied } from "@/lib/listWriteErrors";
import { dayLabel, type SortColumn } from "@/lib/tableSort";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableHeader } from "@/components/SortableTableHeader";
import { SearchInput } from "@/components/SearchInput";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { McnFormModal } from "@/components/McnFormModal";
import { McnAccessGate, McnNav, McnPriorityChip, McnStatusChip } from "@/components/mcnAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// The MCN register — every Manufacturing Change Notice, searchable.
//
// Opens on OPEN MCNs (Draft, Submitted, Approved); Implemented, Rejected and
// All are one click away, and the choice is in the URL. What's RENDERED is
// capped (`INITIAL_ROWS`); the filters and counts always run over everything.
// Every column sorts and filters; a phone gets cards.
//
// New MCN shows for team members only; an approver sees what's waiting for
// them.
// =============================================================================

const INITIAL_ROWS = 150;
const OPEN = "Open";
const ALL = "All";

function inStatus(m: Mcn, status: string): boolean {
  if (status === OPEN) return MCN_OPEN_STATUSES.includes(m.status);
  if (status === ALL) return true;
  return m.status === status;
}

function departmentsOf(m: Mcn, names: Map<number, string>): string {
  return [...new Set(m.scope.map((l) => scopeDepartmentLabel(l, names)).filter(Boolean))].join(", ");
}

export function McnsView() {
  return (
    <McnAccessGate>
      <McnRegister />
    </McnAccessGate>
  );
}

function McnRegister() {
  const navigate = useNavigate();
  const { data: mcns = [], isLoading, error, refetch } = useMcns();
  const access = useMyMcnAccess();
  const { data: departments = [] } = useMaintenanceDepartments();
  const names = useMemo(() => new Map(departments.map((d) => [d.lookupId, d.title])), [departments]);
  const listUnavailable = !!error && isPermissionDenied(error);

  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const q = params.get("q") ?? "";
  const status = params.get("status") || OPEN;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const columns = useMemo<SortColumn<Mcn>[]>(
    () => [
      {
        key: "mcnNumber",
        label: "MCN #",
        value: (m) => m.mcnNumber,
        kind: "number",
        // Year then sequence — the number's own order. Unparsable sorts last.
        sortValue: (m) => {
          const n = parseMcnNumber(m.mcnNumber);
          return n ? n.year * 100_000 + n.seq : null;
        },
      },
      { key: "process", label: "Process", value: (m) => m.process, noFilter: true },
      { key: "priority", label: "Priority", value: (m) => m.priority },
      { key: "departments", label: "Departments", value: (m) => departmentsOf(m, names) },
      { key: "engineer", label: "Assigned engineer", value: (m) => m.assignedEngineer?.displayName ?? "" },
      { key: "status", label: "Status", value: (m) => m.status },
      { key: "date", label: "Date", kind: "date", value: (m) => dayLabel(m.date), sortValue: (m) => m.date },
      {
        key: "dateImplemented",
        label: "Implemented",
        kind: "date",
        value: (m) => dayLabel(m.dateImplemented),
        sortValue: (m) => m.dateImplemented,
      },
    ],
    [names],
  );

  const searched = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return mcns.filter((m) =>
      matchesSearch({ ...m, departments: departmentsOf(m, names), items: Object.values(m.items).map((i) => i.reference) }, tokens),
    );
  }, [mcns, q, names]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { [OPEN]: 0, [ALL]: searched.length };
    for (const s of MCN_STATUSES) out[s] = 0;
    for (const m of searched) {
      if (MCN_OPEN_STATUSES.includes(m.status)) out[OPEN] += 1;
      out[m.status] += 1;
    }
    return out;
  }, [searched]);

  const filtered = useMemo(() => searched.filter((m) => inStatus(m, status)), [searched, status]);

  const table = useSortableTable<Mcn>({
    rows: filtered,
    columns,
    stableKey: (m) => m.id,
    initialKey: "mcnNumber",
    initialDirection: "desc",
    onChange: () => setShowAll(false),
  });

  useEffect(() => setShowAll(false), [q, status]);

  const shown = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);
  const canRaise = raiseMcnGate(access).allowed;
  const waiting = access.rights.canApprove ? awaitingApproval(mcns).length : 0;
  const pills = [OPEN, ALL, ...MCN_STATUSES];

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
            <Factory className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Manufacturing Change Notices</h1>
            <p className="text-sm text-fg-muted">
              Process and equipment changes on the shop floor — raised, approved and distributed here (MWI-762).
            </p>
          </div>
        </div>
        {canRaise && (
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 self-start rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            New MCN
          </button>
        )}
      </header>

      <McnNav />

      {waiting > 0 && (
        <button
          type="button"
          onClick={() => setParam("status", "Submitted")}
          className="self-start rounded-md border border-ajax-yellow/50 bg-ajax-yellow/15 px-3 py-1.5 text-sm font-medium text-fg hover:bg-ajax-yellow/25"
        >
          Waiting for your approval: {waiting}
        </button>
      )}

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

      <div role="search" aria-label="MCN search" className="rounded-xl border border-border bg-surface p-3">
        <SearchInput
          value={q}
          onChange={(v) => setParam("q", v)}
          placeholder="MCN #, process, equipment, work instruction, people…"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
          <span>{isLoading ? "Loading…" : `${filtered.length.toLocaleString()} MCN${filtered.length === 1 ? "" : "s"}`}</span>
          {!isLoading && shown.length < table.rows.length && (
            <button onClick={() => setShowAll(true)} className="text-xs font-medium text-accent hover:underline">
              Showing {shown.length.toLocaleString()} — show all
            </button>
          )}
        </div>

        {isLoading ? (
          <LoadingTasks noun="MCNs" />
        ) : listUnavailable ? (
          <div className="p-4">
            <ListAccessNotice list="Manufacturing Change Notices" site="Altronic_PMO" onRetry={() => void refetch()} />
          </div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">Couldn't load MCNs.</p>
            <p className="mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
            >
              Try again
            </button>
          </div>
        ) : mcns.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            <p className="font-medium text-fg">No MCNs yet.</p>
            {canRaise && <p className="mt-1">Raise the first one with New MCN.</p>}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            {status === OPEN && !q ? "Nothing open. Switch to All to see implemented and rejected MCNs." : "No MCNs match."}
          </div>
        ) : (
          <>
            {/* Two renderings of the SAME rows, split at `sm`. jsdom renders
                both — tests use getAllBy*. */}
            <div className="divide-y divide-border sm:hidden">
              {shown.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => navigate(`/operations/mcns/${m.id}`)}
                  className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{m.mcnNumber || `#${m.id}`}</span>
                    <McnPriorityChip priority={m.priority} />
                    <span className="ml-auto">
                      <McnStatusChip status={m.status} />
                    </span>
                  </span>
                  <span className="truncate text-sm text-fg">{m.process || "—"}</span>
                  <span className="truncate text-xs text-fg-muted">
                    {[departmentsOf(m, names), m.assignedEngineer?.displayName, dayLabel(m.date)].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    {columns.map((c) => (
                      <SortableHeader key={c.key} label={c.label} {...table.headerProps(c.key)} />
                    ))}
                    <th className="px-2 py-2" aria-label="Attachments" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <tr
                      key={m.id}
                      onClick={() => navigate(`/operations/mcns/${m.id}`)}
                      className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
                    >
                      <td className="whitespace-nowrap px-4 py-2 font-medium text-fg">
                        <span className="inline-flex items-center gap-1.5">
                          <Link to={`/operations/mcns/${m.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-accent hover:underline">
                            {m.mcnNumber || `#${m.id}`}
                          </Link>
                          {m.comments.length > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-fg-muted" title={`${m.comments.length} comments`}>
                              <MessageSquare className="h-3 w-3" />
                              {m.comments.length}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="max-w-[22rem] truncate px-4 py-2 text-fg" title={m.process}>
                        {m.process || "—"}
                      </td>
                      <td className="px-4 py-2">
                        <McnPriorityChip priority={m.priority} />
                      </td>
                      <td className="max-w-[14rem] truncate px-4 py-2 text-fg-muted">{departmentsOf(m, names) || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{m.assignedEngineer?.displayName ?? "—"}</td>
                      <td className="px-4 py-2">
                        <McnStatusChip status={m.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">{dayLabel(m.date) || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">{dayLabel(m.dateImplemented) || "—"}</td>
                      <td className="px-2 py-2">
                        {m.hasAttachments && <Paperclip className="h-3 w-3 text-fg-muted" aria-label="Has attachments" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showNew && <McnFormModal onClose={() => setShowNew(false)} onCreated={(id) => navigate(`/operations/mcns/${id}`)} />}
    </div>
  );
}
