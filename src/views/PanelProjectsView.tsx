import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FolderKanban } from "lucide-react";
import { usePanelOrders, usePanelProjects } from "@/hooks/usePanelOrders";
import { usePanelTasks } from "@/hooks/usePanelTasks";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableHeader } from "@/components/SortableTableHeader";
import { PhoneSortBar } from "@/components/PhoneSortBar";
import { useIsPhone } from "@/hooks/useIsPhone";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { SearchInput } from "@/components/SearchInput";
import { isAccessDeniedError } from "@/lib/listAccess";
import { matchesTokens } from "@/lib/itemSearch";
import { dayLabel, type SortColumn } from "@/lib/tableSort";
import {
  panelProjectPath,
  summarisePanelProjects,
  type PanelProjectSummary,
} from "@/lib/panelProjectDashboard";

// =============================================================================
// Panel Project Dashboard — the project list (/panels/projects). One row per
// Panel Project Reference with what hangs off it; a row opens that project's
// dashboard. Read-only (BusinessIT#42, from the live demo with Mark,
// 2026-11-19). Sortable and filterable like every table in ARC.
// =============================================================================

/** Only the rows put in the DOM are capped — counts and filters run over everything. */
const INITIAL_ROWS = 150;

/**
 * Widths that keep the table inside the page (Tim, 2026-11-19: it scrolled
 * sideways at 1400px). Project takes what the rest leave and truncates; every
 * other column is short and never wraps. Type is the first to go on a
 * narrower screen — it's on the project's own page.
 */
const COLUMN_CLASS: Record<string, string> = {
  project: "w-full px-3",
  type: "hidden px-3 lg:table-cell",
  orders: "px-3",
  customers: "px-3",
  openOrders: "px-3",
  openTasks: "px-3",
  activity: "px-3",
};

/** The description under the project, unless the title already says it. */
function extraDescription(r: PanelProjectSummary): string {
  const d = r.project.description.trim();
  return d && !r.project.title.toLowerCase().includes(d.toLowerCase()) ? d : "";
}

const COLUMNS: SortColumn<PanelProjectSummary>[] = [
  { key: "project", label: "Project", value: (r) => r.project.title, noFilter: true },
  { key: "type", label: "Type", value: (r) => r.project.projectType ?? "" },
  { key: "orders", label: "Orders", kind: "number", value: (r) => String(r.orders), sortValue: (r) => r.orders },
  {
    key: "customers",
    label: "Customers",
    kind: "number",
    value: (r) => String(r.customers),
    sortValue: (r) => r.customers,
  },
  {
    key: "openOrders",
    label: "Open orders",
    kind: "number",
    value: (r) => String(r.openOrders),
    sortValue: (r) => r.openOrders,
  },
  {
    key: "openTasks",
    label: "Open tasks",
    kind: "number",
    value: (r) => String(r.openTasks),
    sortValue: (r) => r.openTasks,
  },
  {
    key: "activity",
    label: "Last activity",
    kind: "date",
    value: (r) => dayLabel(r.lastActivity),
    sortValue: (r) => r.lastActivity,
    noFilter: true,
  },
];

export function PanelProjectsView() {
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectsQ = usePanelProjects();
  const ordersQ = usePanelOrders();
  const tasksQ = usePanelTasks();
  const [showAll, setShowAll] = useState(false);

  const query = searchParams.get("q") ?? "";
  const openOnly = searchParams.get("open") === "1";
  function setParam(key: string, value: string | null) {
    const sp = new URLSearchParams(searchParams);
    if (value) sp.set(key, value);
    else sp.delete(key);
    setSearchParams(sp, { replace: true });
    setShowAll(false);
  }

  const summaries = useMemo(
    () => summarisePanelProjects(projectsQ.data ?? [], ordersQ.data ?? [], tasksQ.data ?? []),
    [projectsQ.data, ordersQ.data, tasksQ.data],
  );
  const rows = useMemo(
    () =>
      summaries.filter(
        (s) =>
          (!openOnly || s.openOrders > 0 || s.openTasks > 0) &&
          matchesTokens(
            `${s.project.title} ${s.project.description} ${s.project.customer} ${s.project.dwgNo} ${s.project.projectType ?? ""}`,
            query,
          ),
      ),
    [summaries, openOnly, query],
  );

  const table = useSortableTable({
    rows,
    columns: COLUMNS,
    stableKey: (r) => r.project.id,
    initialKey: "activity",
    initialDirection: "desc",
    onChange: () => setShowAll(false),
  });
  const shown = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);

  const failed = [
    { name: "Panel Project Reference", q: projectsQ },
    { name: "Panel Order Headers", q: ordersQ },
    { name: "Panel Tasks", q: tasksQ },
  ].find((f) => f.q.isError);
  const loading = projectsQ.isPending || ordersQ.isPending || tasksQ.isPending;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <FolderKanban className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold text-fg">Panel Project Dashboard</h1>
          <p className="text-sm text-fg-muted">
            Every panel project reference, with its orders, tasks and discussion in one place. Open a project to
            see it all, and follow the links to{" "}
            <Link to="/panels/orders" className="underline">
              Panel Orders
            </Link>{" "}
            and{" "}
            <Link to="/panels/tasks" className="underline">
              Panel Tasks
            </Link>{" "}
            to change anything.
          </p>
        </div>
      </div>

      {failed ? (
        isAccessDeniedError(failed.q.error) ? (
          <ListAccessNotice list={failed.name} site="ALTRONICPANELTEAM" onRetry={() => void failed.q.refetch()} />
        ) : (
          <p className="text-sm text-cooper-red">
            Couldn't load the {failed.name} list:{" "}
            {failed.q.error instanceof Error ? failed.q.error.message : String(failed.q.error)}{" "}
            <button type="button" className="underline" onClick={() => void failed.q.refetch()}>
              Try again
            </button>
          </p>
        )
      ) : loading ? (
        <LoadingTasks noun="panel projects" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-2 px-4 py-2.5">
            <h2 className="text-sm font-medium text-fg">
              {table.rows.length} project{table.rows.length === 1 ? "" : "s"}
            </h2>
            <label className="inline-flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => setParam("open", e.target.checked ? "1" : null)}
              />
              Only projects with open orders or tasks
            </label>
            <div className="ml-auto w-full sm:w-72">
              <SearchInput
                value={query}
                onChange={(v) => setParam("q", v || null)}
                placeholder="Search projects…"
              />
            </div>
          </div>
          {table.rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-fg-muted">
              {summaries.length === 0 ? "There are no panel project references yet." : "Nothing matches."}
            </p>
          ) : isPhone ? (
            // A phone gets cards, rendered INSTEAD of the table (the Parts List
            // way), so a 150-row list isn't in the DOM twice.
            <>
              <PhoneSortBar columns={COLUMNS} table={table} />
              <ul className="divide-y divide-border">
                {shown.map((r) => (
                  <li key={r.project.id}>
                    <Link
                      to={panelProjectPath(r.project.id)}
                      className="block px-4 py-3 hover:bg-surface-2"
                    >
                      <div className="font-medium text-fg">{r.project.title}</div>
                      {extraDescription(r) && <div className="mt-0.5 text-sm text-fg-muted">{extraDescription(r)}</div>}
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                        <span>
                          <strong className="text-fg">{r.orders}</strong> order{r.orders === 1 ? "" : "s"} (
                          {r.openOrders} open)
                        </span>
                        <span>
                          <strong className="text-fg">{r.openTasks}</strong> open task{r.openTasks === 1 ? "" : "s"}
                        </span>
                        {r.customers > 1 && (
                          <span>
                            <strong className="text-fg">{r.customers}</strong> customers
                          </span>
                        )}
                        {r.lastActivity && <span>Last activity {dayLabel(r.lastActivity)}</span>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-fg-muted">
                    {COLUMNS.map((c) => (
                      <SortableHeader key={c.key} label={c.label} className={COLUMN_CLASS[c.key]} {...table.headerProps(c.key)} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr
                      key={r.project.id}
                      onClick={() => navigate(panelProjectPath(r.project.id))}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2"
                    >
                      {/* max-w-0 + the header's w-full: this column takes the
                          width the others leave, and truncates. */}
                      <td className="max-w-0 px-3 py-2">
                        <Link
                          to={panelProjectPath(r.project.id)}
                          className="block truncate font-medium text-fg hover:underline"
                          title={r.project.title}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.project.title}
                        </Link>
                        {extraDescription(r) && (
                          <div className="truncate text-xs text-fg-muted" title={extraDescription(r)}>
                            {extraDescription(r)}
                          </div>
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-fg-muted lg:table-cell">
                        {r.project.projectType ?? ""}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-fg">{r.orders}</td>
                      <td className="px-3 py-2 tabular-nums text-fg">{r.customers}</td>
                      <td className="px-3 py-2 tabular-nums text-fg">{r.openOrders}</td>
                      <td className="px-3 py-2 tabular-nums text-fg">{r.openTasks}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-fg-muted">
                        {dayLabel(r.lastActivity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {table.rows.length > INITIAL_ROWS && !showAll && (
            <div className="border-t border-border px-4 py-2.5 text-center text-sm text-fg-muted">
              Showing {INITIAL_ROWS} of {table.rows.length}.{" "}
              <button type="button" onClick={() => setShowAll(true)} className="text-accent underline">
                Show all {table.rows.length} projects
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
