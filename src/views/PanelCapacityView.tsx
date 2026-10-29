import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarOff, Gauge, Loader2 } from "lucide-react";
import { usePanelTasks, useSavePanelTaskPlan } from "@/hooks/usePanelTasks";
import { usePanelTimeOff } from "@/hooks/usePanelTimeOff";
import { usePanelRoles, usePanelTeamAccess } from "@/hooks/usePanelRoles";
import type { Person } from "@/types/task";
import { DAILY_CAPACITY_HOURS, type CapacityChange, type CapacityWorkItem } from "@/lib/capacity";
import { panelTaskIdOf, panelTaskWorkItem } from "@/lib/panelCapacity";
import { PanelTeamGate } from "@/components/PanelTeamGate";
import { LoadingTasks } from "@/components/LoadingTasks";
import { CapacityGrid } from "@/components/CapacityGrid";
import { usePanelSettings, useSetPanelAmberPercent } from "@/hooks/usePanelSettings";
import { PANEL_SETTINGS_CONFIGURED } from "@/api/panelSettings";
import { amberPercentProblem, DEFAULT_PANEL_SETTINGS } from "@/lib/panelSettings";

// =============================================================================
// Panel Engineering Capacity (BusinessIT#42) — who on the panel team is
// overloaded, and when. Modelled on the Wrike Workload chart the team used.
//
// This view is only the Panels-specific part: the gate, the header, and the
// data — Panel tasks through their adapter (lib/panelCapacity.ts), Panel Time
// Off, and everyone holding the Engineer role, who always gets a row. The
// grid itself is the shared components/CapacityGrid (rules: lib/capacity.ts),
// so Engineering or Operations can show the same screen over their own tasks.
// =============================================================================

export function PanelCapacityView() {
  return (
    <PanelTeamGate noun="panel capacity">
      <CapacityScreen />
    </PanelTeamGate>
  );
}

function CapacityScreen() {
  const tasksQuery = usePanelTasks();
  const timeOffQuery = usePanelTimeOff();
  const rolesQuery = usePanelRoles();
  const access = usePanelTeamAccess();
  const savePlan = useSavePanelTaskPlan();

  // The grid stages drags as a plan; Save hands them all over at once — one
  // PATCH per task, then the assignment emails. Viewers get no drag (no onSave).
  const { mutateAsync } = savePlan;
  const save = useCallback(
    async (changes: Array<{ item: CapacityWorkItem; change: CapacityChange }>) => {
      const byId = new Map<number, string>();
      const plan = changes.flatMap(({ item, change }) => {
        const id = panelTaskIdOf(item);
        if (id === null) return [];
        byId.set(id, item.id);
        return [{ id, assigned: change.assignees, startDate: change.startDate, dueDate: change.dueDate }];
      });
      try {
        const { failed } = await mutateAsync(plan);
        return { failed: failed.map((f) => byId.get(f.id) as string) };
      } catch {
        // Refused outright (not on the team): nothing saved, keep it all staged.
        return { failed: changes.map((c) => c.item.id) };
      }
    },
    [mutateAsync],
  );

  const items = useMemo(() => (tasksQuery.data ?? []).map(panelTaskWorkItem), [tasksQuery.data]);
  // A company holiday is off for everyone on the grid.
  const timeOff = useMemo(
    () => (timeOffQuery.data ?? []).map((e) => ({ ...e, everyone: e.companyHoliday })),
    [timeOffQuery.data],
  );
  const settings = usePanelSettings();
  const amberPercent = settings.data?.amberPercent ?? DEFAULT_PANEL_SETTINGS.amberPercent;
  const engineers = useMemo(
    () =>
      (rolesQuery.data ?? [])
        .filter((e) => e.role === "Engineer" && e.user?.displayName)
        .map((e) => e.user as Person),
    [rolesQuery.data],
  );

  if (tasksQuery.isLoading) return <LoadingTasks noun="panel capacity" />;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-superior-blue/10 text-superior-blue">
          <Gauge className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Panel Engineering Capacity
          </h1>
          <p className="text-sm text-fg-muted">
            Each engineer's task hours, day by day, against {DAILY_CAPACITY_HOURS} hours a day less
            any time off.
          </p>
        </div>
        <AmberSetting percent={amberPercent} canChange={access.canManageCapacity} />
        <Link
          to="/panels/time-off"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
        >
          <CalendarOff className="h-4 w-4" />
          Time off
        </Link>
      </header>

      {(tasksQuery.error || timeOffQuery.error) && (
        <div className="rounded-md border border-cooper-red/40 bg-cooper-red/10 px-3 py-2 text-sm text-cooper-red">
          {tasksQuery.error
            ? "Couldn't load the panel tasks, so this view can't be trusted. Refresh to try again."
            : "Couldn't load time off — capacity is shown as if nobody is off."}
        </div>
      )}

      <CapacityGrid
        items={items}
        timeOff={timeOff}
        people={engineers}
        // Only the Engineer role gets a row (Tim, 2026-10-29); anyone else's
        // work waits in the backlog, to be dragged onto an engineer.
        onlyPeople
        notOnGridReason={notAnEngineer}
        amberRatio={amberPercent / 100}
        onSave={access.canEdit ? save : undefined}
        draftKey="panels"
        emptyHint="Nobody holds the Engineer role on Panel User Roles yet, so there are no rows. An ARC admin adds engineers under Admin → Panel User Roles."
      />
    </div>
  );
}

function notAnEngineer(assignees: Person[]): string {
  const names = assignees.map((p) => p.displayName || "someone").join(", ");
  return assignees.length === 1
    ? `Assigned to ${names}, who isn't an Engineer on Panel User Roles`
    : `Assigned to ${names} — none an Engineer on Panel User Roles`;
}

/**
 * The amber threshold: shown to everyone, changed by a panel Super User or an
 * ARC admin (Tim, 2026-10-29). Stored on the Panel Settings list.
 */
function AmberSetting({ percent, canChange }: { percent: number; canChange: boolean }) {
  const setAmber = useSetPanelAmberPercent();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const allowed = canChange && PANEL_SETTINGS_CONFIGURED;

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
        <span className="inline-block h-3 w-3 rounded-sm bg-ajax-yellow" /> Amber above {percent}%
        {allowed && (
          <button
            type="button"
            onClick={() => {
              setDraft(String(percent));
              setEditing(true);
            }}
            className="rounded-md px-1.5 py-0.5 text-accent hover:bg-surface-2"
          >
            Change
          </button>
        )}
      </span>
    );
  }
  const n = Number(draft.trim());
  const problem = draft.trim() === "" ? "Enter a percentage." : amberPercentProblem(n);
  return (
    <form
      className="inline-flex flex-wrap items-center gap-1.5 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (problem) return;
        try {
          await setAmber.mutateAsync(n);
          setEditing(false);
        } catch {
          // The hook has toasted why; the box stays open to try again.
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setEditing(false);
      }}
    >
      <label className="flex items-center gap-1 text-fg-muted">
        Amber above
        <input
          className="select w-16!"
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Amber threshold percent"
          autoFocus
        />
        %
      </label>
      <button
        type="submit"
        disabled={!!problem || setAmber.isPending}
        title={problem ?? undefined}
        className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 font-medium text-white disabled:opacity-50"
      >
        {setAmber.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="px-1.5 text-fg-muted hover:text-fg">
        Cancel
      </button>
      {problem && draft.trim() !== "" && <span className="w-full text-xs text-cooper-red">{problem}</span>}
    </form>
  );
}
