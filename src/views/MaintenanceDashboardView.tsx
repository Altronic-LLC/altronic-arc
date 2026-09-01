import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarCheck,
  Gauge,
  PauseCircle,
  TimerReset,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useMaintenanceTasks } from "@/hooks/useMaintenanceTasks";
import { useScheduledMaintenance } from "@/hooks/useScheduledMaintenance";
import { useEquipment } from "@/hooks/useEquipment";
import {
  NO_DEPARTMENT_LABEL,
  assetsDown,
  backlogTrend,
  type BacklogWeek,
  type DepartmentCount,
  departmentCoverage,
  downtimeByAsset,
  equipmentByDepartment,
  openByPriority,
  openByStatus,
  openMaintenanceTasks,
  openWorkByDepartment,
  overdueSummary,
  plannedVsUnplanned,
  pmCompliance,
  workloadByAssignee,
} from "@/lib/maintenanceMetrics";
import { referenceLabel } from "@/lib/maintenanceReferences";
import { equipmentLabel } from "@/lib/equipmentMapper";
import {
  AssetStatusChip,
  CriticalityChip,
  MaintenancePriorityFlag,
  MaintenanceStatusBadge,
} from "@/components/maintenanceAtoms";
import { LoadingTasks } from "@/components/LoadingTasks";
import { MaintenanceViewSwitcher } from "@/components/MaintenanceViewSwitcher";

// =============================================================================
// The maintenance dashboard — the overview surface for the CMMS module.
//
// Every number on this page comes out of `lib/maintenanceMetrics.ts`, which is
// pure and takes `now` as a parameter. This view supplies `now` once and
// passes it down, so the whole page is one consistent instant rather than nine
// charts each reading the clock a few milliseconds apart.
//
// **Charts are CSS, not a charting library.** They are a handful of horizontal
// bars and one column chart; adding a ~200KB dependency to draw them would
// cost every user of ARC page weight for a screen most of them never open.
// Colours come from the brand palette and the semantic CSS variables, so both
// themes work without a second palette.
//
// **Every chart is readable without seeing the bars.** Each row prints its own
// number as text and the bars are `aria-hidden`, so a screen reader gets the
// figures rather than a wall of unlabelled divs.
//
// The one rule this screen exists to respect: **grouping is by Department,
// never Location**, and the assets with no Department are shown as their own
// labelled bucket with the count said out loud. 184 of 378 assets have no
// Department, and a chart that quietly covered half the plant while looking
// complete would be worse than showing nothing at all.
// =============================================================================

/** How far back the compliance / planned-ratio figures look. */
const PERIODS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
] as const;

type PeriodDays = (typeof PERIODS)[number]["days"];

const MS_PER_DAY = 86_400_000;

interface MaintenanceDashboardViewProps {
  /**
   * The instant the page is computed against. Defaults to the current time;
   * a caller (and every test) can pin it so the whole page is deterministic.
   */
  now?: Date;
}

export function MaintenanceDashboardView({ now }: MaintenanceDashboardViewProps = {}) {
  // One clock reading for the whole page, taken once per mount.
  const fallbackNow = useMemo(() => new Date(), []);
  const asOf = now ?? fallbackNow;

  const [periodDays, setPeriodDays] = useState<PeriodDays>(90);

  const tasksQuery = useMaintenanceTasks();
  const schedulesQuery = useScheduledMaintenance();
  const equipmentQuery = useEquipment();

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const schedules = useMemo(() => schedulesQuery.data ?? [], [schedulesQuery.data]);
  const equipment = useMemo(() => equipmentQuery.data ?? [], [equipmentQuery.data]);

  const period = useMemo(
    () => ({ from: new Date(asOf.getTime() - (periodDays - 1) * MS_PER_DAY), to: asOf }),
    [asOf, periodDays],
  );

  const open = useMemo(() => openMaintenanceTasks(tasks), [tasks]);
  const overdue = useMemo(() => overdueSummary(tasks, asOf), [tasks, asOf]);
  const compliance = useMemo(
    () => pmCompliance(tasks, schedules, period, asOf),
    [tasks, schedules, period, asOf],
  );
  const inPeriod = useMemo(
    () => tasks.filter((t) => t.createdAt >= period.from && t.createdAt <= period.to),
    [tasks, period],
  );
  const planned = useMemo(() => plannedVsUnplanned(inPeriod), [inPeriod]);
  const down = useMemo(() => assetsDown(equipment), [equipment]);
  const byStatus = useMemo(() => openByStatus(tasks), [tasks]);
  const byPriority = useMemo(() => openByPriority(tasks), [tasks]);
  const workload = useMemo(() => workloadByAssignee(tasks, asOf), [tasks, asOf]);
  const assetsByDept = useMemo(() => equipmentByDepartment(equipment), [equipment]);
  const workByDept = useMemo(() => openWorkByDepartment(tasks, equipment), [tasks, equipment]);
  const coverage = useMemo(() => departmentCoverage(equipment), [equipment]);
  const downtime = useMemo(
    () => downtimeByAsset(inPeriod, equipment, 10),
    [inPeriod, equipment],
  );
  const trend = useMemo(() => backlogTrend(tasks, asOf, 8), [tasks, asOf]);

  const isLoading = tasksQuery.isLoading || schedulesQuery.isLoading || equipmentQuery.isLoading;
  const loadError = tasksQuery.error ?? schedulesQuery.error ?? equipmentQuery.error;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1300px] px-4 py-6 sm:px-6">
        <LoadingTasks noun="the maintenance dashboard" />
      </div>
    );
  }

  const periodLabel = PERIODS.find((p) => p.days === periodDays)?.label ?? `${periodDays} days`;

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
              Maintenance dashboard
            </h1>
            <p className="text-sm text-fg-muted">
              Where the plant's work stands right now — {open.length} open work order
              {open.length === 1 ? "" : "s"} across {equipment.length} asset
              {equipment.length === 1 ? "" : "s"}.
            </p>
          </div>
          <PeriodToggle value={periodDays} onChange={setPeriodDays} />
        </div>
        {loadError && (
          <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-fg-muted">
            Some maintenance data couldn't load, so these figures may be incomplete.{" "}
            {loadError instanceof Error ? loadError.message : String(loadError)}
          </p>
        )}
      </header>

      <MaintenanceViewSwitcher />

      <section aria-label="Headline figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="cooper-red"
          label="Overdue work orders"
          value={String(overdue.count)}
          detail={
            overdue.oldest ? (
              <>
                Oldest:{" "}
                <Link
                  to={`/operations/maintenance-task/${overdue.oldest.id}`}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {overdue.oldest.woNumber || overdue.oldest.title}
                </Link>
                , {overdue.oldestDaysLate} day{overdue.oldestDaysLate === 1 ? "" : "s"} late
              </>
            ) : (
              "Nothing is past its due date."
            )
          }
        />
        <StatTile
          icon={<CalendarCheck className="h-4 w-4" />}
          tone="cooper-green"
          label="PM compliance"
          value={compliance.percent === null ? "—" : `${compliance.percent}%`}
          detail={
            compliance.percent === null
              ? `No scheduled maintenance was due in the last ${periodLabel}.`
              : `${compliance.onTime} of ${compliance.due} PMs due in the last ${periodLabel} were done inside their grace window` +
                (compliance.pending > 0 ? ` · ${compliance.pending} still open and not yet late` : "")
          }
        />
        <StatTile
          icon={<Gauge className="h-4 w-4" />}
          tone="superior-blue"
          label="Planned work"
          value={planned.plannedPercent === null ? "—" : `${planned.plannedPercent}%`}
          detail={
            planned.total === 0
              ? `No work orders were raised in the last ${periodLabel}.`
              : `${planned.planned} planned · ${planned.unplanned} unplanned, of ${planned.total} raised in the last ${periodLabel}`
          }
        />
        <StatTile
          icon={<PauseCircle className="h-4 w-4" />}
          tone="ajax-yellow"
          label="Assets down"
          value={String(down.total)}
          detail={
            down.total === 0 ? (
              "Every asset is in service or on standby."
            ) : (
              <span className="flex flex-wrap items-center gap-1">
                <span>Criticality weight {down.weight} ·</span>
                {down.byCriticality.map((c) => (
                  <span key={c.label} className="inline-flex items-center gap-1">
                    <CriticalityChip criticality={c.criticality} />
                    {c.criticality === null && <span className="text-fg-muted">{c.label}</span>}
                    <span className="tabular-nums">{c.count}</span>
                  </span>
                ))}
              </span>
            )
          }
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Open work orders by status" icon={<Wrench className="h-4 w-4" />}>
          {open.length === 0 ? (
            <Empty>No open work orders.</Empty>
          ) : (
            <BarList
              rows={byStatus.map((s) => ({
                key: s.status,
                label: <MaintenanceStatusBadge status={s.status} />,
                srLabel: s.status,
                count: s.count,
              }))}
            />
          )}
        </Card>

        <Card title="Open work orders by priority" icon={<AlertTriangle className="h-4 w-4" />}>
          {open.length === 0 ? (
            <Empty>No open work orders.</Empty>
          ) : (
            <BarList
              rows={byPriority.map((p) => ({
                key: p.label,
                label: p.priority ? (
                  <MaintenancePriorityFlag priority={p.priority} />
                ) : (
                  <span className="text-xs text-fg-muted">{p.label}</span>
                ),
                srLabel: p.label,
                count: p.count,
              }))}
            />
          )}
        </Card>

        <Card
          title="Workload by technician"
          icon={<Wrench className="h-4 w-4" />}
          className="lg:col-span-2"
          caption="Open work orders only. Anything with no due date is counted separately rather than folded in with the work that simply isn't urgent yet."
        >
          {workload.length === 0 ? (
            <Empty>Nobody has open work.</Empty>
          ) : (
            <>
              <WorkloadLegend />
              <ul className="mt-3 flex flex-col gap-2.5">
                {workload.map((row) => (
                  <li key={row.key || "unassigned"} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-sm",
                          row.person ? "text-fg" : "italic text-fg-muted",
                        )}
                      >
                        {row.name}
                      </span>
                      <span className="shrink-0 text-xs text-fg-muted">
                        <span className="font-semibold tabular-nums text-fg">{row.total}</span> open
                        {row.overdue > 0 && (
                          <span className="ml-1.5 font-semibold text-cooper-red">
                            {row.overdue} overdue
                          </span>
                        )}
                      </span>
                    </div>
                    <StackedBar
                      total={row.total}
                      segments={[
                        { label: "Overdue", count: row.overdue, className: "bg-cooper-red" },
                        {
                          label: "Due this week",
                          count: row.dueThisWeek,
                          className: "bg-ajax-yellow",
                        },
                        { label: "Later", count: row.later, className: "bg-superior-blue" },
                        {
                          label: "No due date",
                          count: row.noDueDate,
                          className: "bg-fg-muted/50",
                        },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card
          title="Assets by department"
          icon={<Gauge className="h-4 w-4" />}
          caption={departmentCaption(coverage.filled, coverage.total, coverage.missing)}
        >
          {assetsByDept.length === 0 ? (
            <Empty>The equipment register is empty.</Empty>
          ) : (
            <DepartmentBars rows={assetsByDept} unit="assets" />
          )}
        </Card>

        <Card
          title="Open work by department"
          icon={<Wrench className="h-4 w-4" />}
          caption="Grouped by the work order's own department, falling back to its asset's. The last bucket is what has neither — a job with no department set, against an asset with none either (or no asset at all)."
        >
          {workByDept.length === 0 ? (
            <Empty>No open work orders.</Empty>
          ) : (
            <DepartmentBars rows={workByDept} unit="work orders" />
          )}
        </Card>

        <Card
          title="Downtime by asset"
          icon={<TimerReset className="h-4 w-4" />}
          caption={`The ten worst actors of the last ${periodLabel}, by recorded downtime hours.`}
        >
          {downtime.rows.length === 0 ? (
            <Empty>No downtime has been recorded in this period.</Empty>
          ) : (
            <>
              <BarList
                rows={downtime.rows.map((r) => ({
                  key: String(r.lookupId),
                  label: (
                    <Link
                      to={`/operations/maintenance/asset/${r.lookupId}`}
                      className="truncate text-sm text-fg hover:text-accent hover:underline"
                    >
                      {r.name}
                    </Link>
                  ),
                  srLabel: r.name,
                  count: r.hours,
                  suffix: "h",
                  note: `${r.workOrders} work order${r.workOrders === 1 ? "" : "s"}${
                    r.department ? ` · ${referenceLabel(r.department)}` : ""
                  }`,
                }))}
              />
              {downtime.unassigned.hours > 0 && (
                <p className="mt-3 border-t border-border pt-2 text-xs text-fg-muted">
                  A further <span className="font-semibold text-fg">{downtime.unassigned.hours}h</span>{" "}
                  is recorded on {downtime.unassigned.workOrders} work order
                  {downtime.unassigned.workOrders === 1 ? "" : "s"} with no asset set, so it can't be
                  attributed to a machine. It is included in the {downtime.totalHours}h plant total.
                </p>
              )}
            </>
          )}
        </Card>

        <Card
          title="Backlog trend"
          icon={<TimerReset className="h-4 w-4" />}
          caption="Work orders raised against work orders completed, by week. A canceled job isn't counted as completed work."
        >
          <TrendChart weeks={trend} />
        </Card>

        <Card
          title="Assets currently down"
          icon={<PauseCircle className="h-4 w-4" />}
          className="lg:col-span-2"
        >
          {down.assets.length === 0 ? (
            <Empty>Nothing is marked Down.</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {down.assets.map((a) => (
                <li key={a.lookupId} className="flex flex-wrap items-center gap-2 py-2">
                  <Link
                    to={`/operations/maintenance/asset/${a.lookupId}`}
                    className="text-sm font-medium text-fg hover:text-accent hover:underline"
                  >
                    {equipmentLabel(a)}
                  </Link>
                  <CriticalityChip criticality={a.criticality} />
                  <AssetStatusChip assetStatus={a.assetStatus} />
                  <span className="text-xs text-fg-muted">
                    {a.department ? referenceLabel(a.department) : NO_DEPARTMENT_LABEL}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="text-xs text-fg-muted">
        Mean time to repair and mean time between failures are deliberately not shown. Both need a
        consistent failure-start and back-in-service time on every work order, and that isn't
        recorded yet — a number computed without it would look authoritative and be wrong.
      </p>
    </div>
  );
}

export default MaintenanceDashboardView;

/**
 * The caption every department chart carries.
 *
 * It states the coverage in words because the whole risk with this column is a
 * chart that looks complete while covering half the plant. Exported so the
 * asset detail page (and any later department grouping) says the same thing
 * the same way.
 */
export function departmentCaption(filled: number, total: number, missing: number): string {
  if (total === 0) return "The equipment register is empty.";
  const percent = Math.round((filled / total) * 100);
  if (missing === 0) return `Every one of the ${total} assets has a department set.`;
  return (
    `Department is set on ${filled} of ${total} assets (${percent}%). ` +
    `The ${missing} without one are grouped as "${NO_DEPARTMENT_LABEL}" — they are counted here, not hidden. ` +
    `Grouping is by Department rather than Location, which has 62 near-duplicate values.`
  );
}

// -----------------------------------------------------------------------------
// Presentation
// -----------------------------------------------------------------------------

const TONE: Record<string, { chip: string; text: string }> = {
  "superior-blue": { chip: "bg-superior-blue/10", text: "text-superior-blue" },
  "cooper-red": { chip: "bg-cooper-red/10", text: "text-cooper-red" },
  "cooper-green": { chip: "bg-cooper-green/10", text: "text-cooper-green" },
  "ajax-yellow": { chip: "bg-ajax-yellow/15", text: "text-ajax-yellow" },
};

function StatTile({
  icon,
  tone,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONE;
  label: string;
  value: string;
  detail: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-md", t.chip, t.text)}>
          {icon}
        </span>
        <span className="font-display text-sm font-semibold text-fg">{label}</span>
      </div>
      <span className="font-display text-3xl font-bold tabular-nums text-fg">{value}</span>
      <div className="text-xs leading-snug text-fg-muted">{detail}</div>
    </div>
  );
}

function PeriodToggle({
  value,
  onChange,
}: {
  value: PeriodDays;
  onChange: (days: PeriodDays) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Reporting period"
      className="inline-flex items-center rounded-md border border-border bg-surface-2 p-0.5 text-sm"
    >
      {PERIODS.map((p) => (
        <button
          key={p.days}
          type="button"
          onClick={() => onChange(p.days)}
          aria-pressed={value === p.days}
          className={cn(
            "rounded-sm px-3 py-1 font-medium transition-colors",
            value === p.days ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function Card({
  title,
  icon,
  caption,
  className,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  caption?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn("rounded-xl border border-border bg-surface p-4 sm:p-5", className)}
    >
      <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
        {icon}
        {title}
      </h2>
      {caption && <p className="mt-1 text-xs leading-snug text-fg-muted">{caption}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-fg-muted">{children}</p>;
}

interface BarRow {
  key: string;
  label: React.ReactNode;
  /** Plain text of the label, for the row's accessible name. */
  srLabel: string;
  count: number;
  suffix?: string;
  note?: string;
}

/**
 * A list of horizontal bars.
 *
 * The bar itself is `aria-hidden`; the number is printed as text beside the
 * label, so the chart reads correctly with no bars visible at all — which is
 * also what happens if a browser refuses the inline width.
 */
function BarList({ rows }: { rows: BarRow[] }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate">{row.label}</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
              {row.count}
              {row.suffix ?? ""}
            </span>
          </div>
          <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent/70"
              style={{ width: max > 0 ? `${(row.count / max) * 100}%` : "0%" }}
            />
          </div>
          {row.note && <span className="text-[11px] text-fg-muted">{row.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function WorkloadLegend() {
  const items = [
    { label: "Overdue", className: "bg-cooper-red" },
    { label: "Due this week", className: "bg-ajax-yellow" },
    { label: "Later", className: "bg-superior-blue" },
    { label: "No due date", className: "bg-fg-muted/50" },
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1 text-[11px] text-fg-muted">
          <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", i.className)} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function StackedBar({
  total,
  segments,
}: {
  total: number;
  segments: { label: string; count: number; className: string }[];
}) {
  const shown = segments.filter((s) => s.count > 0);
  return (
    <>
      <div aria-hidden className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
        {total > 0 &&
          shown.map((s) => (
            <div
              key={s.label}
              className={s.className}
              style={{ width: `${(s.count / total) * 100}%` }}
              title={`${s.label}: ${s.count}`}
            />
          ))}
      </div>
      {/* The same breakdown as text — the bar is decoration, this is the data. */}
      <span className="sr-only">
        {shown.map((s) => `${s.label}: ${s.count}`).join(", ") || "No open work"}
      </span>
    </>
  );
}

function DepartmentBars({ rows, unit }: { rows: DepartmentCount[]; unit: string }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const missing = row.department === null;
        return (
          <li key={row.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={cn("min-w-0 truncate text-sm", missing ? "italic text-fg-muted" : "text-fg")}
              >
                {row.label}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                {row.count}
              </span>
            </div>
            <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className={cn(
                  "h-full rounded-full",
                  // The missing bucket is drawn hatched-grey rather than in the
                  // accent colour: it is a gap in the data, not a department,
                  // and it must not read as one more shop on the floor.
                  missing ? "bg-fg-muted/40" : "bg-accent/70",
                )}
                style={{ width: max > 0 ? `${(row.count / max) * 100}%` : "0%" }}
              />
            </div>
          </li>
        );
      })}
      <li className="pt-1 text-[11px] text-fg-muted">
        {rows.reduce((sum, r) => sum + r.count, 0)} {unit} in total.
      </li>
    </ul>
  );
}

function TrendChart({ weeks }: { weeks: BacklogWeek[] }) {
  const max = weeks.reduce((m, w) => Math.max(m, w.created, w.closed), 0);
  const label = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1 text-[11px] text-fg-muted">
          <span aria-hidden className="h-2 w-2 rounded-full bg-superior-blue" />
          Raised
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] text-fg-muted">
          <span aria-hidden className="h-2 w-2 rounded-full bg-cooper-green" />
          Completed
        </span>
      </div>
      <ul className="mt-3 flex h-36 items-end gap-1.5">
        {weeks.map((w) => (
          <li key={w.weekStart.toISOString()} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div aria-hidden className="flex h-24 w-full items-end justify-center gap-0.5">
              <div
                className="w-2 rounded-t bg-superior-blue"
                style={{ height: max > 0 ? `${(w.created / max) * 100}%` : "0%" }}
              />
              <div
                className="w-2 rounded-t bg-cooper-green"
                style={{ height: max > 0 ? `${(w.closed / max) * 100}%` : "0%" }}
              />
            </div>
            <span className="truncate text-[10px] text-fg-muted">
              {label(w.weekStart)}
            </span>
            <span className="sr-only">
              Week of {label(w.weekStart)}: {w.created} raised, {w.closed} completed
            </span>
          </li>
        ))}
      </ul>
      {max === 0 && (
        <p className="text-center text-sm text-fg-muted">
          No work orders were raised or completed in these weeks.
        </p>
      )}
    </div>
  );
}
