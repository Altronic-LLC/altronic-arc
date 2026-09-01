import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CalendarClock, ClipboardList, History, Info, User } from "lucide-react";
import { EQUIPMENT_ASSET_STATUSES, type MaintenanceTask, type Person } from "@/types/task";
import { useEquipment, useEquipmentItem, useSetEquipmentAssetStatus, useSetEquipmentResponsibleTech } from "@/hooks/useEquipment";
import { useMaintenanceTasks } from "@/hooks/useMaintenanceTasks";
import { useScheduledMaintenance } from "@/hooks/useScheduledMaintenance";
import { useDirectoryPeople } from "@/hooks/useDirectory";
import { equipmentLabel } from "@/lib/equipmentMapper";
import { referenceLabel } from "@/lib/maintenanceReferences";
import { collectMaintenanceTaskPeople } from "@/lib/maintenanceTaskMapper";
import { anchorDueDate, daysUntilDue, frequencyLabel } from "@/lib/maintenanceSchedule";
import {
  NO_DEPARTMENT_LABEL,
  assetWorkSummary,
  schedulesForAsset,
} from "@/lib/maintenanceMetrics";
import { mergePeople, personKey } from "@/lib/people";
import { cn } from "@/lib/cn";
import {
  AssetStatusChip,
  CriticalityChip,
  DueInLabel,
  MaintenancePriorityFlag,
  MaintenanceStatusBadge,
  ScheduleBasisChip,
} from "@/components/maintenanceAtoms";
import { ChoiceSelect, SingleSelect } from "@/components/SearchableSelect";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";

// =============================================================================
// One machine — the asset 360 page.
//
// Nameplate details, the work open on it, everything ever done to it, the PM
// schedules that drive it, and its manuals and drawings.
//
// **Only two fields are editable here: Asset Status and Responsible Tech.**
// The equipment register is maintained in SharePoint (there is no create and
// no delete in `api/operationsEquipment.ts` either) — these two are the edits
// a technician makes with the machine in front of them: marking it down, and
// moving who owns it. Everything else renders read-only, and the page says so
// rather than leaving people hunting for a pencil that isn't there.
//
// Both write immediately on pick, the same as a task's Assigned field — a
// single-value pick is not a batch of text to compose before committing.
// =============================================================================

interface AssetDetailViewProps {
  /** Pinned by tests so "days late" is deterministic; defaults to now. */
  now?: Date;
}

export function AssetDetailView({ now }: AssetDetailViewProps = {}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const lookupId = id ? parseInt(id, 10) : NaN;
  const assetId = Number.isFinite(lookupId) ? lookupId : null;

  const fallbackNow = useMemo(() => new Date(), []);
  const asOf = now ?? fallbackNow;

  const { data: asset, isLoading } = useEquipmentItem(assetId);
  const { data: register = [] } = useEquipment();
  const { data: tasks = [] } = useMaintenanceTasks();
  const { data: schedules = [] } = useScheduledMaintenance();
  const directory = useDirectoryPeople();

  const setAssetStatus = useSetEquipmentAssetStatus();
  const setResponsibleTech = useSetEquipmentResponsibleTech();

  const work = useMemo(
    () => (assetId === null ? null : assetWorkSummary(tasks, assetId)),
    [tasks, assetId],
  );
  const assetSchedules = useMemo(
    () => (assetId === null ? [] : schedulesForAsset(schedules, assetId)),
    [schedules, assetId],
  );
  const people = useMemo(
    () =>
      mergePeople(
        directory,
        collectMaintenanceTaskPeople(tasks),
        // The tech currently on the record may be a leaver, or an account
        // whose mailbox differs from the address the directory lists. Keeping
        // them in the option list is what stops a person who IS set rendering
        // as "Nobody" — the same stand-in rule the FAIT pickers follow.
        asset?.responsibleTech ? [asset.responsibleTech] : [],
      ),
    [directory, tasks, asset?.responsibleTech],
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1300px] px-4 py-6 sm:px-6">
        <LoadingTasks noun="the asset" />
      </div>
    );
  }

  if (!asset || !work) {
    return (
      <div className="mx-auto max-w-[1300px] px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-fg-muted">That asset isn't in the equipment register.</p>
        <button
          onClick={() => navigate("/operations/maintenance/dashboard")}
          className="mt-3 text-sm text-accent underline-offset-2 hover:underline"
        >
          Back to the maintenance dashboard
        </button>
      </div>
    );
  }

  const parent = asset.parentAsset
    ? register.find((e) => e.lookupId === asset.parentAsset?.lookupId) ?? null
    : null;

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <DetailTopBar category="Maintenance" listTo="/operations/maintenance/dashboard" />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {equipmentLabel(asset)}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <AssetStatusChip assetStatus={asset.assetStatus} />
            <CriticalityChip criticality={asset.criticality} />
            <span className="text-sm text-fg-muted">
              {asset.department ? referenceLabel(asset.department) : NO_DEPARTMENT_LABEL}
              {asset.equipmentType ? ` · ${asset.equipmentType}` : ""}
            </span>
          </div>
        </div>
        <div className="flex gap-3">
          <HeaderStat label="Downtime" value={`${work.totalDowntimeHours}h`} />
          <HeaderStat label="Labour" value={`${work.totalLaborHours}h`} />
          <HeaderStat label="Work orders" value={String(work.open.length + work.history.length)} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <Section
            icon={<ClipboardList className="h-4 w-4" />}
            title="Open work orders"
            count={work.open.length}
          >
            {work.open.length === 0 ? (
              <EmptyRow>Nothing is open on this asset.</EmptyRow>
            ) : (
              <WorkOrderList tasks={work.open} now={asOf} showDue />
            )}
          </Section>

          <Section
            icon={<CalendarClock className="h-4 w-4" />}
            title="Maintenance schedules"
            count={assetSchedules.length}
            caption="The PM rules attached to this asset. Schedules are created and edited in the PM library."
          >
            {assetSchedules.length === 0 ? (
              <EmptyRow>No preventive maintenance is scheduled on this asset.</EmptyRow>
            ) : (
              <ul className="divide-y divide-border">
                {assetSchedules.map((s) => {
                  const due = anchorDueDate(s);
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm",
                          s.active ? "text-fg" : "text-fg-muted line-through",
                        )}
                      >
                        {s.title}
                      </span>
                      <span className="text-xs text-fg-muted">
                        {frequencyLabel(s.frequencyInterval, s.frequencyUnit)}
                      </span>
                      <ScheduleBasisChip basis={s.scheduleBasis} />
                      {s.active ? (
                        due ? (
                          <DueInLabel days={daysUntilDue(s, asOf)} />
                        ) : (
                          <span className="text-xs text-fg-muted">No due date set</span>
                        )
                      ) : (
                        <span className="text-xs text-fg-muted">Inactive</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            icon={<History className="h-4 w-4" />}
            title="Maintenance history"
            count={work.history.length}
            caption="Every closed work order on this asset, newest first."
          >
            {work.history.length === 0 ? (
              <EmptyRow>Nothing has been closed out on this asset yet.</EmptyRow>
            ) : (
              <WorkOrderList tasks={work.history} now={asOf} />
            )}
          </Section>

          <AttachmentsSection parent="equipment" itemId={asset.lookupId} />
        </div>

        <aside className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-1.5 border-b border-border pb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            <Info className="h-3.5 w-3.5" />
            Nameplate
          </div>

          <SidebarField label="Asset Status">
            <ChoiceSelect
              ariaLabel="Asset Status"
              value={asset.assetStatus ?? ""}
              onChange={(v) =>
                setAssetStatus.mutate({ lookupId: asset.lookupId, assetStatus: v || null })
              }
              options={EQUIPMENT_ASSET_STATUSES}
              emptyLabel="Not set"
            />
          </SidebarField>

          <SidebarField label="Responsible Tech" icon={<User className="h-3.5 w-3.5" />}>
            <SingleSelect
              allLabel="Nobody assigned"
              searchPlaceholder="Search people…"
              options={people.map((p) => ({ value: personKey(p), label: p.displayName }))}
              selected={asset.responsibleTech ? personKey(asset.responsibleTech) : null}
              onChange={(key) => {
                const person: Person | null = key
                  ? people.find((p) => personKey(p) === key) ?? null
                  : null;
                setResponsibleTech.mutate({ lookupId: asset.lookupId, person });
              }}
            />
          </SidebarField>

          <div className="border-t border-border pt-3">
            <ReadOnlyField label="Description" value={asset.description} />
            <ReadOnlyField label="Manufacturer" value={asset.manufacturer} />
            <ReadOnlyField label="Model" value={asset.modelNumber} />
            <ReadOnlyField label="Serial No" value={asset.serialNo} />
            <ReadOnlyField label="Equipment Type" value={asset.equipmentType} />
            <ReadOnlyField label="Criticality" value={asset.criticality} />
            <ReadOnlyField
              label="Department"
              value={asset.department ? referenceLabel(asset.department) : null}
              emptyLabel={NO_DEPARTMENT_LABEL}
            />
            <ReadOnlyField
              label="Location"
              value={asset.location ? referenceLabel(asset.location) : null}
            />
            <ReadOnlyField
              label="Parent Asset"
              value={
                asset.parentAsset ? (
                  parent ? (
                    <Link
                      to={`/operations/maintenance/asset/${parent.lookupId}`}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      {equipmentLabel(parent)}
                    </Link>
                  ) : (
                    // A lookup pointing at a row that's gone stays visible —
                    // a dangling pointer is information, an empty cell isn't.
                    asset.parentAsset.title || `Asset #${asset.parentAsset.lookupId}`
                  )
                ) : null
              }
            />
            <ReadOnlyField label="Installed" value={formatDate(asset.installDate)} />
            <ReadOnlyField label="Warranty Expiry" value={formatDate(asset.warrantyExpiry)} />
          </div>

          <p className="border-t border-border pt-3 text-[11px] leading-snug text-fg-muted">
            Asset Status and Responsible Tech save as soon as you pick them. The rest of the
            register is maintained in SharePoint.
          </p>
        </aside>
      </div>
    </div>
  );
}

export default AssetDetailView;

// -----------------------------------------------------------------------------
// Presentation
// -----------------------------------------------------------------------------

function formatDate(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  // Date-only columns are held at midday UTC; formatting in UTC is what stops
  // them rendering as the day before for anyone west of Greenwich.
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function WorkOrderList({
  tasks,
  now,
  showDue = false,
}: {
  tasks: MaintenanceTask[];
  now: Date;
  showDue?: boolean;
}) {
  return (
    <ul className="divide-y divide-border">
      {tasks.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
          <Link
            to={`/operations/maintenance-task/${t.id}`}
            className="min-w-0 flex-1 truncate text-sm text-fg hover:text-accent hover:underline"
          >
            <span className="font-mono text-xs text-fg-muted">{t.woNumber}</span>{" "}
            {t.title || "Untitled work order"}
          </Link>
          <MaintenancePriorityFlag priority={t.priority} />
          <MaintenanceStatusBadge status={t.status} />
          {showDue && t.dueDate ? (
            <DueInLabel days={wholeDays(now, t.dueDate)} />
          ) : (
            <span className="text-xs text-fg-muted">
              {t.completedDate ? formatDate(t.completedDate) : formatDate(t.createdAt)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Whole days from `now` to `date`, in UTC day terms — negative when late. */
function wholeDays(now: Date, date: Date): number {
  const a = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const b = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-center">
      <div className="font-display text-lg font-bold tabular-nums text-fg">{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  caption,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-surface-2 px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          {icon}
          {title} ({count})
        </h2>
        {caption && <p className="mt-0.5 text-xs text-fg-muted">{caption}</p>}
      </div>
      {children}
    </section>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-center text-sm text-fg-muted">{children}</div>;
}

function SidebarField({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
  emptyLabel = "Not set",
}: {
  label: string;
  value: React.ReactNode;
  emptyLabel?: string;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      <span className={cn("min-w-0 text-right", empty ? "text-fg-muted" : "text-fg")}>
        {empty ? emptyLabel : value}
      </span>
    </div>
  );
}
