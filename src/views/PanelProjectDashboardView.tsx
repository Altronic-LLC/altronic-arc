import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Archive, ArrowLeft, Building2, ExternalLink, FolderKanban, LayoutDashboard, ListChecks, MessageSquare, Package } from "lucide-react";
import { usePanelOrders, usePanelProjects } from "@/hooks/usePanelOrders";
import { usePanelTasks } from "@/hooks/usePanelTasks";
import { usePanelBoms } from "@/hooks/usePanelBom";
import { usePanelTeamAccess } from "@/hooks/usePanelRoles";
import { useSortableTable } from "@/hooks/useSortableTable";
import { PANEL_BOMS_CONFIGURED } from "@/api/panelBoms";
import { SortableHeader } from "@/components/SortableTableHeader";
import { PhoneSortBar } from "@/components/PhoneSortBar";
import { useIsPhone } from "@/hooks/useIsPhone";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { DetailTopBar } from "@/components/DetailTopBar";
import { PanelOrderStatusBadge, PanelTaskStatusBadge } from "@/components/panelAtoms";
import { isAccessDeniedError } from "@/lib/listAccess";
import { cn } from "@/lib/cn";
import { dayLabel, type SortColumn } from "@/lib/tableSort";
import { sanitiseHtml } from "@/lib/sanitiseHtml";
import { formatHours } from "@/lib/capacity";
import { panelOrderCreatedAt } from "@/lib/panelOrderArchive";
import { isPanelTaskOpen } from "@/lib/panelTaskStatus";
import {
  isPanelOrderOpen,
  narrowToCustomer,
  NO_CUSTOMER,
  ordersForProject,
  projectCustomers,
  projectCommunications,
  tasksForProject,
  type ProjectComment,
  type ProjectCustomer,
} from "@/lib/panelProjectDashboard";
import { PANEL_ORDER_STATUSES, PANEL_TASK_STATUSES, type PanelOrder, type PanelTask } from "@/types/task";

// =============================================================================
// Panel Project Dashboard — one project (/panels/projects/:id). Everything on
// one Panel Project Reference: its orders, their tasks, their BOMs, and every
// comment posted on any of them, newest first. READ-ONLY by design (Tim, from
// the live demo with Mark, 2026-11-19): each record links down to the app
// that owns it, and that's where it's changed.
// =============================================================================

/** The discussion is long on a busy project; the rest is one click away. */
const INITIAL_COMMENTS = 30;

const ORDER_COLUMNS: SortColumn<PanelOrder>[] = [
  {
    key: "status",
    label: "Status",
    kind: "number",
    value: (o) => o.status,
    sortValue: (o) => PANEL_ORDER_STATUSES.indexOf(o.status),
  },
  { key: "order", label: "Order", value: (o) => o.title, noFilter: true },
  { key: "salesOrder", label: "Sales Order", value: (o) => o.salesOrder, noFilter: true },
  { key: "sap", label: "SAP #", value: (o) => o.sapNumber, noFilter: true },
  { key: "drawing", label: "Drawing", value: (o) => o.drawingNumber },
  { key: "engineer", label: "Engineer", value: (o) => o.engineerAssigned?.displayName ?? "" },
  { key: "customer", label: "Customer", value: (o) => o.customer },
  {
    key: "created",
    label: "Created",
    kind: "date",
    value: (o) => dayLabel(panelOrderCreatedAt(o)),
    sortValue: (o) => panelOrderCreatedAt(o),
    noFilter: true,
  },
];

function taskOrderTitle(task: PanelTask, orderTitles: Map<number, string>): string {
  if (!task.orderRef) return "";
  return orderTitles.get(task.orderRef.lookupId) || task.orderRef.title || `Order #${task.orderRef.lookupId}`;
}

function taskColumns(orderTitles: Map<number, string>): SortColumn<PanelTask>[] {
  return [
    {
      key: "status",
      label: "Status",
      kind: "number",
      value: (t) => t.status,
      sortValue: (t) => PANEL_TASK_STATUSES.indexOf(t.status),
    },
    { key: "task", label: "Task", value: (t) => t.title, noFilter: true },
    { key: "order", label: "Order", value: (t) => taskOrderTitle(t, orderTitles) || "No order" },
    { key: "assigned", label: "Assigned", value: (t) => t.assigned.map((p) => p.displayName).join(", ") },
    {
      key: "due",
      label: "Due",
      kind: "date",
      value: (t) => dayLabel(t.dueDate),
      sortValue: (t) => t.dueDate,
      noFilter: true,
    },
    {
      key: "hours",
      label: "Hours",
      kind: "number",
      value: (t) => (t.estimatedHours === null ? "" : String(t.estimatedHours)),
      sortValue: (t) => t.estimatedHours,
      noFilter: true,
    },
  ];
}

export function PanelProjectDashboardView() {
  const { id } = useParams<{ id: string }>();
  const projectId = id ? parseInt(id, 10) : NaN;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectsQ = usePanelProjects();
  const ordersQ = usePanelOrders();
  const tasksQ = usePanelTasks();

  const project = (projectsQ.data ?? []).find((p) => p.id === projectId) ?? null;
  const orders = useMemo(
    () => (Number.isNaN(projectId) ? [] : ordersForProject(ordersQ.data ?? [], projectId)),
    [ordersQ.data, projectId],
  );
  const tasks = useMemo(
    () =>
      Number.isNaN(projectId)
        ? []
        : tasksForProject(tasksQ.data ?? [], projectId, new Set(orders.map((o) => o.id))),
    [tasksQ.data, projectId, orders],
  );
  // One customer's part of the project (?customer=, Tim 2026-11-19): a
  // repeat panel is built for several customers. An unknown value is ignored
  // rather than showing an empty page.
  const customers = useMemo(() => projectCustomers(orders), [orders]);
  const wanted = (searchParams.get("customer") ?? "").trim().toLowerCase();
  const activeCustomer = wanted ? customers.find((c) => c.key.toLowerCase() === wanted)?.key ?? null : null;
  const shown = useMemo(() => narrowToCustomer(orders, tasks, activeCustomer), [orders, tasks, activeCustomer]);
  const comments = useMemo(() => projectCommunications(shown.orders, shown.tasks), [shown]);
  function pickCustomer(key: string | null) {
    const sp = new URLSearchParams(searchParams);
    if (key) sp.set("customer", key);
    else sp.delete("customer");
    setSearchParams(sp, { replace: true });
  }

  useEffect(() => {
    if (project) document.title = `${project.title} — Panel Project Dashboard — ARC`;
    return () => {
      document.title = "ARC — Altronic Resource Center";
    };
  }, [project]);

  const failed = [
    { name: "Panel Project Reference", q: projectsQ },
    { name: "Panel Order Headers", q: ordersQ },
    { name: "Panel Tasks", q: tasksQ },
  ].find((f) => f.q.isError);

  if (failed) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        {isAccessDeniedError(failed.q.error) ? (
          <ListAccessNotice list={failed.name} site="ALTRONICPANELTEAM" onRetry={() => void failed.q.refetch()} />
        ) : (
          <p className="text-sm text-cooper-red">
            Couldn't load the {failed.name} list:{" "}
            {failed.q.error instanceof Error ? failed.q.error.message : String(failed.q.error)}{" "}
            <button type="button" className="underline" onClick={() => void failed.q.refetch()}>
              Try again
            </button>
          </p>
        )}
      </div>
    );
  }

  if (projectsQ.isPending || ordersQ.isPending || tasksQ.isPending) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <LoadingTasks noun="this panel project" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-12 text-center">
        <p className="text-fg-muted">Panel project not found.</p>
        <button
          onClick={() => navigate("/panels/projects")}
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent underline-offset-2 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to the Panel Project Dashboard
        </button>
      </div>
    );
  }

  const openOrders = shown.orders.filter(isPanelOrderOpen).length;
  const openTasks = shown.tasks.filter((t) => isPanelTaskOpen(t.status)).length;
  const hidden = shown.hiddenUnlinkedTasks;
  const facts: [string, string][] = [
    ["Type", project.projectType ?? ""],
    ["Customer", project.customer],
    ["DWG No.", project.dwgNo],
    ["Department", project.department ?? ""],
  ];

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Panel Project Dashboard" listTo="/panels/projects" keepOpenLabel={project.title} />

      <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <FolderKanban className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-semibold leading-tight text-fg sm:text-2xl">{project.title}</h1>
            {project.description && <p className="mt-1 text-sm text-fg">{project.description}</p>}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</dt>
              <dd className="truncate text-fg" title={value}>
                {value || <span className="text-fg-muted">Not set</span>}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t border-border pt-3 text-sm text-fg-muted">
          {activeCustomer && (
            <>
              For <strong className="text-fg">{customerLabel(activeCustomer)}</strong>:{" "}
            </>
          )}
          {shown.orders.length} order{shown.orders.length === 1 ? "" : "s"} ({openOrders} open) · {shown.tasks.length} task
          {shown.tasks.length === 1 ? "" : "s"} ({openTasks} open) · {comments.length} comment
          {comments.length === 1 ? "" : "s"}. This page is read-only — open an order or a task to change it.
        </p>
      </div>

      {customers.length > 1 && (
        <CustomerPills customers={customers} total={orders.length} active={activeCustomer} onPick={pickCustomer} />
      )}

      <ProjectOrdersCard projectId={project.id} orders={shown.orders} />
      <ProjectTasksCard
        projectId={project.id}
        tasks={shown.tasks}
        orders={orders}
        hiddenNote={
          activeCustomer && hidden > 0
            ? hidden === 1
              ? "1 task isn't tied to one of this project's orders, so it has no customer and is hidden while a customer is picked."
              : `${hidden} tasks aren't tied to one of this project's orders, so they have no customer and are hidden while a customer is picked.`
            : null
        }
      />
      <ProjectBomsCard orders={shown.orders} />
      <ProjectCommentsCard comments={comments} />
    </div>
  );
}

function customerLabel(key: string): string {
  return key === NO_CUSTOMER ? "No customer" : key;
}

/**
 * One pill per customer on the project's orders, with its order count, most
 * first. Picking one narrows every card below to that customer; picking it
 * again (or All customers) shows everything.
 */
function CustomerPills({
  customers,
  total,
  active,
  onPick,
}: {
  customers: ProjectCustomer[];
  total: number;
  active: string | null;
  onPick: (key: string | null) => void;
}) {
  const pill = (selected: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
      selected
        ? "border-accent bg-accent text-white"
        : "border-border bg-surface text-fg hover:border-fg-muted hover:bg-surface-2",
    );
  const badge = (selected: boolean) =>
    cn(
      "rounded-full px-1.5 text-xs font-semibold tabular-nums",
      selected ? "bg-white/20 text-white" : "bg-surface-2 text-fg-muted",
    );
  return (
    <section aria-label="Customers" className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
        <Building2 className="h-4 w-4" />
        Customers ({customers.length})
      </h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={active === null} onClick={() => onPick(null)} className={pill(active === null)}>
          All customers <span className={badge(active === null)}>{total}</span>
        </button>
        {customers.map((c) => {
          const selected = active === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(selected ? null : c.key)}
              title={`${c.orders} order${c.orders === 1 ? "" : "s"}, ${c.openOrders} open`}
              className={pill(selected)}
            >
              {customerLabel(c.key)} <span className={badge(selected)}>{c.orders}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CardHeader({
  icon,
  title,
  to,
  linkLabel,
}: {
  icon: React.ReactNode;
  title: string;
  to?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted [&>svg]:h-4 [&>svg]:w-4">
        {icon}
        {title}
      </h2>
      {to && linkLabel && (
        <Link to={to} className="ml-auto inline-flex items-center gap-1 text-sm text-accent hover:underline">
          {linkLabel} <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

/** Only the rows put in the DOM are capped — counts, sorting and filters run over everything. */
const INITIAL_ROWS = 150;

/**
 * Column widths so neither table scrolls sideways (Tim, 2026-11-19). The
 * title column takes what the rest leave and truncates; the least-needed
 * columns go first on a narrower screen — they're on the order's own page.
 */
const ORDER_COLUMN_CLASS: Record<string, string> = {
  status: "px-3",
  order: "w-full px-3",
  salesOrder: "hidden px-3 xl:table-cell",
  sap: "px-3",
  drawing: "hidden px-3 xl:table-cell",
  engineer: "hidden px-3 lg:table-cell",
  customer: "px-3",
  created: "px-3",
};
const TASK_COLUMN_CLASS: Record<string, string> = {
  status: "px-3",
  task: "w-full px-3",
  order: "hidden px-3 lg:table-cell",
  assigned: "px-3",
  due: "px-3",
  hours: "px-3",
};
const cell = (cls: string | undefined, extra = "") => cn("py-2", cls?.replace("w-full", "").trim(), extra);

function ShowAllRows({ total, onShowAll, noun }: { total: number; onShowAll: () => void; noun: string }) {
  return (
    <p className="mt-2 text-center text-sm text-fg-muted">
      Showing {INITIAL_ROWS} of {total}.{" "}
      <button type="button" onClick={onShowAll} className="text-accent underline">
        Show all {total} {noun}
      </button>
    </p>
  );
}

function ProjectOrdersCard({ projectId, orders }: { projectId: number; orders: PanelOrder[] }) {
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const [showAll, setShowAll] = useState(false);
  const table = useSortableTable({
    rows: orders,
    columns: ORDER_COLUMNS,
    stableKey: (o) => o.id,
    initialKey: "created",
    initialDirection: "desc",
    onChange: () => setShowAll(false),
  });
  const rows = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);
  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <CardHeader
        icon={<LayoutDashboard />}
        title={`Orders (${orders.length})`}
        to={`/panels/orders?project=${projectId}&archived=all`}
        linkLabel="Open in Panel Orders"
      />
      {orders.length === 0 ? (
        <p className="text-sm text-fg-muted">No orders on this project.</p>
      ) : isPhone ? (
        <div className="-mx-4 border-t border-border">
          <PhoneSortBar columns={ORDER_COLUMNS} table={table} />
          <ul className="divide-y divide-border">
            {rows.map((o) => (
              <li key={o.id}>
                <Link to={`/panels/order/${o.id}`} className="block px-4 py-3 hover:bg-surface-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <PanelOrderStatusBadge status={o.status} />
                    {o.archived && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                        <Archive className="h-3 w-3" /> Archived
                      </span>
                    )}
                    <span className="ml-auto text-xs tabular-nums text-fg-muted">{dayLabel(panelOrderCreatedAt(o))}</span>
                  </div>
                  <div className="mt-1 font-medium text-fg">{o.title}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-fg-muted">
                    {o.customer && <span>{o.customer}</span>}
                    {o.sapNumber && <span>SAP # {o.sapNumber}</span>}
                    {o.salesOrder && <span>SO {o.salesOrder}</span>}
                    {o.engineerAssigned?.displayName && <span>{o.engineerAssigned.displayName}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-muted">
                {ORDER_COLUMNS.map((c) => (
                  <SortableHeader key={c.key} label={c.label} className={ORDER_COLUMN_CLASS[c.key]} {...table.headerProps(c.key)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => navigate(`/panels/order/${o.id}`)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2"
                >
                  <td className={cell(ORDER_COLUMN_CLASS.status)}>
                    <PanelOrderStatusBadge status={o.status} />
                  </td>
                  {/* max-w-0 + the header's w-full: takes the width left over, truncates. */}
                  <td className={cell(ORDER_COLUMN_CLASS.order, "max-w-0 font-medium text-fg")}>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/panels/order/${o.id}`}
                        className="truncate hover:underline"
                        title={o.title}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {o.title}
                      </Link>
                      {o.archived && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                          <Archive className="h-3 w-3" /> Archived
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={cell(ORDER_COLUMN_CLASS.salesOrder, "whitespace-nowrap text-fg-muted")}>{o.salesOrder}</td>
                  <td className={cell(ORDER_COLUMN_CLASS.sap, "whitespace-nowrap text-fg-muted")}>{o.sapNumber}</td>
                  <td className={cell(ORDER_COLUMN_CLASS.drawing, "whitespace-nowrap text-fg-muted")}>{o.drawingNumber}</td>
                  <td className={cell(ORDER_COLUMN_CLASS.engineer, "whitespace-nowrap text-fg-muted")}>
                    {o.engineerAssigned?.displayName ?? ""}
                  </td>
                  <td className={cell(ORDER_COLUMN_CLASS.customer, "whitespace-nowrap text-fg-muted")}>{o.customer}</td>
                  <td className={cell(ORDER_COLUMN_CLASS.created, "whitespace-nowrap tabular-nums text-fg-muted")}>
                    {dayLabel(panelOrderCreatedAt(o))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {table.rows.length > INITIAL_ROWS && !showAll && (
        <ShowAllRows total={table.rows.length} onShowAll={() => setShowAll(true)} noun="orders" />
      )}
    </section>
  );
}

function ProjectTasksCard({
  projectId,
  tasks,
  orders,
  hiddenNote,
}: {
  projectId: number;
  tasks: PanelTask[];
  orders: PanelOrder[];
  hiddenNote?: string | null;
}) {
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const [showAll, setShowAll] = useState(false);
  const orderTitles = useMemo(() => new Map(orders.map((o) => [o.id, o.title])), [orders]);
  const columns = useMemo(() => taskColumns(orderTitles), [orderTitles]);
  const table = useSortableTable({
    rows: tasks,
    columns,
    stableKey: (t) => t.id,
    initialKey: "status",
    onChange: () => setShowAll(false),
  });
  const rows = showAll ? table.rows : table.rows.slice(0, INITIAL_ROWS);
  const assignees = (t: PanelTask) => t.assigned.map((p) => p.displayName).join(", ") || "Unassigned";
  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <CardHeader
        icon={<ListChecks />}
        title={`Tasks (${tasks.length})`}
        to={`/panels/tasks?project=${projectId}`}
        linkLabel="Open in Panel Tasks"
      />
      {hiddenNote && <p className="mb-2 text-xs text-fg-muted">{hiddenNote}</p>}
      {tasks.length === 0 ? (
        <p className="text-sm text-fg-muted">No tasks on this project.</p>
      ) : isPhone ? (
        <div className="-mx-4 border-t border-border">
          <PhoneSortBar columns={columns} table={table} />
          <ul className="divide-y divide-border">
            {rows.map((t) => (
              <li key={t.id}>
                <Link to={`/panels/task/${t.id}`} className="block px-4 py-3 hover:bg-surface-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <PanelTaskStatusBadge status={t.status} />
                    {t.dueDate && <span className="ml-auto text-xs tabular-nums text-fg-muted">Due {dayLabel(t.dueDate)}</span>}
                  </div>
                  <div className="mt-1 font-medium text-fg">{t.title}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-fg-muted">
                    <span>{assignees(t)}</span>
                    {t.estimatedHours !== null && <span>{formatHours(t.estimatedHours)}</span>}
                    {t.orderRef && <span>Order: {taskOrderTitle(t, orderTitles)}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-muted">
                {columns.map((c) => (
                  <SortableHeader key={c.key} label={c.label} className={TASK_COLUMN_CLASS[c.key]} {...table.headerProps(c.key)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => navigate(`/panels/task/${t.id}`)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2"
                >
                  <td className={cell(TASK_COLUMN_CLASS.status)}>
                    <PanelTaskStatusBadge status={t.status} />
                  </td>
                  <td className={cell(TASK_COLUMN_CLASS.task, "max-w-0 font-medium text-fg")}>
                    <Link
                      to={`/panels/task/${t.id}`}
                      className="block truncate hover:underline"
                      title={t.title}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.title}
                    </Link>
                  </td>
                  <td className={cell(TASK_COLUMN_CLASS.order, "max-w-[18rem]")}>
                    {t.orderRef ? (
                      <Link
                        to={`/panels/order/${t.orderRef.lookupId}`}
                        className="block truncate text-fg-muted hover:underline"
                        title={taskOrderTitle(t, orderTitles)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {taskOrderTitle(t, orderTitles)}
                      </Link>
                    ) : (
                      <span className="text-fg-muted">No order</span>
                    )}
                  </td>
                  <td className={cell(TASK_COLUMN_CLASS.assigned, "whitespace-nowrap text-fg-muted")}>{assignees(t)}</td>
                  <td className={cell(TASK_COLUMN_CLASS.due, "whitespace-nowrap tabular-nums text-fg-muted")}>{dayLabel(t.dueDate)}</td>
                  <td className={cell(TASK_COLUMN_CLASS.hours, "whitespace-nowrap tabular-nums text-fg-muted")}>
                    {t.estimatedHours === null ? "" : formatHours(t.estimatedHours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {table.rows.length > INITIAL_ROWS && !showAll && (
        <ShowAllRows total={table.rows.length} onShowAll={() => setShowAll(true)} noun="tasks" />
      )}
    </section>
  );
}

/** The BOMs on the project's orders — panel team only, like the BOM Builder itself. */
function ProjectBomsCard({ orders }: { orders: PanelOrder[] }) {
  const access = usePanelTeamAccess();
  const { data: boms = [], isPending, error } = usePanelBoms();
  const orderTitles = useMemo(() => new Map(orders.map((o) => [o.id, o.title])), [orders]);
  if (!PANEL_BOMS_CONFIGURED || !access.canOpenBom) return null;
  const mine = boms
    .filter((b) => b.panelOrder !== null && orderTitles.has(b.panelOrder.lookupId))
    .sort((a, b) => (b.modifiedAt?.getTime() ?? 0) - (a.modifiedAt?.getTime() ?? 0));

  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <CardHeader icon={<Package />} title={`BOMs (${mine.length})`} />
      {isPending ? (
        <p className="text-sm text-fg-muted">Loading BOMs…</p>
      ) : error ? (
        <p className="text-sm text-cooper-red">
          {isAccessDeniedError(error) ? "You don't have access to the saved BOMs." : "Couldn't load the saved BOMs."}
        </p>
      ) : mine.length === 0 ? (
        <p className="text-sm text-fg-muted">No BOMs are linked to this project's orders.</p>
      ) : (
        <ul className="divide-y divide-border">
          {mine.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <Link to={`/panels/bom-builder/${b.id}`} className="font-medium text-fg hover:underline">
                {b.panelSystemNumber || `BOM ${b.id}`}
              </Link>
              <Link to={`/panels/order/${b.panelOrder!.lookupId}`} className="text-fg-muted hover:underline">
                {orderTitles.get(b.panelOrder!.lookupId)}
              </Link>
              <span className="ml-auto text-xs text-fg-muted">
                {b.modifiedAt ? `Saved ${dayLabel(b.modifiedAt)}` : ""}
                {b.modifiedBy ? ` by ${b.modifiedBy.displayName}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectCommentsCard({ comments }: { comments: ProjectComment[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? comments : comments.slice(0, INITIAL_COMMENTS);
  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <CardHeader icon={<MessageSquare />} title={`Discussion (${comments.length})`} />
      <p className="mb-3 text-xs text-fg-muted">
        Every comment on this project's orders and tasks, newest first. To reply, open the order or task it was
        posted on.
      </p>
      {comments.length === 0 ? (
        <p className="text-sm text-fg-muted">Nobody has commented on this project's orders or tasks yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((c, i) => (
            <li
              key={`${c.source.kind}-${c.source.id}-${c.comment.timestamp.getTime()}-${i}`}
              className="rounded-md border border-border bg-bg p-3"
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                <span className="font-semibold text-fg">{c.comment.authorName}</span>
                <span>
                  {c.comment.timestamp.toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <span>on {c.source.kind === "order" ? "order" : "task"}</span>
                <Link
                  to={c.source.kind === "order" ? `/panels/order/${c.source.id}` : `/panels/task/${c.source.id}`}
                  className="min-w-0 truncate text-accent hover:underline"
                >
                  {c.source.title}
                </Link>
              </div>
              <div
                className="comment-html text-sm text-fg"
                dangerouslySetInnerHTML={{ __html: sanitiseHtml(c.comment.bodyHtml) }}
              />
            </li>
          ))}
        </ul>
      )}
      {comments.length > INITIAL_COMMENTS && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="mt-3 text-sm text-accent underline">
          Show all {comments.length} comments
        </button>
      )}
    </section>
  );
}
