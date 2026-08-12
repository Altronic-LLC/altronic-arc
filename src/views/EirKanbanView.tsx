import { useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useProjects } from "@/hooks/useTasks";
import { useEirs, useUpdateEirFields } from "@/hooks/useEirs";
import { eirFilterSearch, useEirFilters } from "@/hooks/useEirFilters";
import { useKanbanAvailable } from "@/hooks/useIsPhone";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { EIR_STATUSES, type Eir, type EirStatus } from "@/types/task";
import { EirFilterBar } from "@/components/EirFilterBar";
import { EirKanbanCard } from "@/components/EirKanbanCard";
import { EirViewTabs } from "@/components/EirViewTabs";
import { EirFormModal } from "@/components/EirFormModal";
import { LoadingTasks } from "@/components/LoadingTasks";
import { eirStatusColor } from "@/components/atoms";
import {
  applyEirFilters,
  collectEirPeople,
  matchesEirView,
  sortEirsForView,
} from "@/lib/eirFilters";
import { withPerson } from "@/lib/people";
import { cn } from "@/lib/cn";

// =============================================================================
// EIRs board — the same board as the task Kanban, over EIRs. Columns are the
// five EIR statuses; the view tabs and filter bar above it are the same
// controls as the EIRs list, so the two are views of ONE filtered set.
//
// Dropping a card writes Status through `useUpdateEirFields`, which is
// already optimistic with rollback, a toast and Undo — a failed write puts
// the card back where it came from. Status is not one of the role-gated EIR
// fields (that's Engineering Response, Technical Priority, Buyer Code, Risk
// Part, Risk Part Level), so any signed-in user can drag.
// =============================================================================

export function EirKanbanView() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { data: eirs = [], isLoading, error: eirsError } = useEirs();
  const { data: projects = [] } = useProjects();
  const {
    filters,
    setSearch,
    setProjectIds,
    setReporter,
    setEngineers,
    view,
    setView,
  } = useEirFilters();
  const updateFields = useUpdateEirFields();
  const [activeEir, setActiveEir] = useState<Eir | null>(null);
  const [showNew, setShowNew] = useState(false);
  // Board is only offered on tablets wider than an iPad mini. Below that we
  // bounce to the list (drag-and-drop isn't a good touch experience on a
  // phone-sized screen).
  const kanbanAvailable = useKanbanAvailable();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // People for the Engineer / Reporter dropdowns — drawn from the full EIR
  // set, not the filtered subset, so the options are stable as you filter.
  const currentUser = useCurrentUser();
  const people = useMemo(
    () => withPerson(collectEirPeople(eirs), currentUser),
    [eirs, currentUser],
  );

  const filteredByBar = useMemo(() => applyEirFilters(eirs, filters), [eirs, filters]);

  // The view tab narrows which EIRs reach the board. The status pill has no
  // equivalent here — the columns ARE the statuses.
  const filtered = useMemo(
    () => filteredByBar.filter((e) => matchesEirView(e, view)),
    [filteredByBar, view],
  );

  const eirsByStatus = useMemo(() => {
    const out: Record<EirStatus, Eir[]> = {
      "Under Review": [],
      "EIR Not Accepted": [],
      "Response Accepted": [],
      "Response Not Accepted": [],
      Closed: [],
    };
    for (const e of filtered) out[e.status].push(e);
    for (const s of EIR_STATUSES) out[s] = sortEirsForView(out[s], view);
    return out;
  }, [filtered, view]);

  function handleDragStart(event: DragStartEvent) {
    const e = eirs.find((x) => x.id === event.active.id);
    if (e) setActiveEir(e);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveEir(null);
    const { active, over } = event;
    if (!over) return;

    const eirId = Number(active.id);
    const eir = eirs.find((x) => x.id === eirId);
    if (!eir) return;

    let target: EirStatus | null = null;
    if (EIR_STATUSES.includes(over.id as EirStatus)) {
      target = over.id as EirStatus;
    } else {
      const overEir = eirs.find((x) => x.id === Number(over.id));
      if (overEir) target = overEir.status;
    }

    if (target && target !== eir.status) {
      updateFields.mutate({ id: eir.id, fields: { Status: target } });
    }
  }

  // Phones / small tablets: the board isn't offered — send them to the list,
  // carrying the filters so the bounce doesn't reset them.
  if (!kanbanAvailable) {
    return <Navigate to={`/eirs${eirFilterSearch(search)}`} replace />;
  }

  if (isLoading) {
    return <LoadingTasks noun="the board" />;
  }

  return (
    // Lock the board to (about) the viewport so the column area's horizontal
    // scrollbar always sits at the bottom of the screen — same treatment as
    // the task Kanban, where a page-level scroll put the scrollbar out of
    // reach below the filters.
    <div className="mx-auto flex h-[calc(100dvh-12rem)] max-w-full flex-col gap-3 px-4 py-3 sm:h-[calc(100dvh-7rem)] sm:gap-4 sm:px-6 sm:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EirViewTabs eirs={filteredByBar} view={view} onChange={setView} />
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New EIR</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      <EirFilterBar
        filters={filters}
        projects={projects}
        people={people}
        onSearch={setSearch}
        onProjectIds={setProjectIds}
        onReporter={setReporter}
        onEngineers={setEngineers}
      />

      {eirsError && (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs">
          <div className="mb-1 font-semibold text-cooper-red">
            Couldn't load EIRs from SharePoint
          </div>
          <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg">
            {(eirsError as Error)?.message ?? "Unknown error"}
          </pre>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* min-h-0 is load-bearing: without it the flex child won't shrink
            below its content height and the horizontal scrollbar disappears
            off the bottom of the screen. */}
        <div className="min-h-0 flex-1">
          <div className="scroll-elegant flex h-full gap-4 overflow-x-auto overflow-y-hidden pb-2">
            {EIR_STATUSES.map((status) => (
              <Column
                key={status}
                status={status}
                eirs={eirsByStatus[status]}
                onOpen={(id) => navigate(`/eir/${id}`)}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeEir ? (
            <EirKanbanCard eir={activeEir} onOpen={() => {}} dragDisabled={false} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {showNew && <EirFormModal mode="create" onClose={() => setShowNew(false)} />}
    </div>
  );
}

interface ColumnProps {
  status: EirStatus;
  eirs: Eir[];
  onOpen: (id: number) => void;
}

function Column({ status, eirs, onOpen }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="flex w-72 shrink-0 flex-col sm:w-80" data-testid={`eir-column-${status}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              eirStatusColor(status),
            )}
          >
            {status}
          </span>
          <span className="text-xs text-fg-muted">{eirs.length}</span>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "scroll-elegant flex min-h-[200px] flex-1 flex-col gap-2 overflow-y-auto rounded-lg border bg-surface-2/40 p-2 transition-colors",
          isOver ? "border-accent bg-accent/5" : "border-border",
        )}
      >
        <SortableContext items={eirs.map((e) => e.id)} strategy={verticalListSortingStrategy}>
          {eirs.map((e) => (
            <EirKanbanCard key={e.id} eir={e} onOpen={onOpen} />
          ))}
        </SortableContext>
        {eirs.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-xs text-fg-muted">
            Drop EIRs here
          </div>
        )}
      </div>
    </div>
  );
}
