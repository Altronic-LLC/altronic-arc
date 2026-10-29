import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  GripVertical,
  Inbox,
  Loader2,
} from "lucide-react";
import type { Person } from "@/types/task";
import {
  addDays,
  applyCapacityChanges,
  buildCapacity,
  CAPACITY_AMBER_RATIO,
  dayKeyOf,
  daysBetween,
  describeSpread,
  formatHours,
  isWorkingDay,
  mergeChange,
  parsePlan,
  placeOnDay,
  prunePlan,
  rescheduled,
  samePerson,
  serializePlan,
  timeOffByDay,
  timeOffFor,
  reassigned,
  weekStart,
  type DragMode,
  type CapacityCell,
  type CapacityChange,
  type CapacityLevel,
  type CapacityRow,
  type CapacityTimeOff,
  type CapacityWorkItem,
} from "@/lib/capacity";
import { toIsoDate } from "@/lib/dateInput";
import { cn } from "@/lib/cn";

// =============================================================================
// The capacity screen's body — SHARED, so any task system can show one
// (BusinessIT#42 built it for Panels; Engineering and Operations are meant to
// follow). A department view supplies the header, gating and data, already
// turned into `CapacityWorkItem`s by its adapter; this draws the rest:
//
//  - the Days/Weeks toggle and week navigation, both in the URL
//    (`?view=week&from=…`) so a shared link opens on the same weeks;
//  - a row per person, a cell per day or week (rules: lib/capacity.ts);
//  - click a person for their task bars, a cell for the items behind it;
//  - the BACKLOG of unfinished items that can't be placed, with the reason;
//  - a hover card on every bar: hours a day, total, dates, context (Wrike's);
//  - with `onSave`, PLANNING in day view, mouse and pen only:
//      drag a bar to move it, or an end to change that date;
//      drag a bar onto another person's row to reassign it;
//      drag a backlog task (by its grip) onto a person and a day to assign
//      and schedule it.
//    Nothing is written while you plan. Every drag is STAGED; the cells
//    recalculate as you go, changed bars are outlined, and Save sends the
//    lot to `onSave` at once — so an engineer gets ONE assignment email,
//    not one per drag (Tim, 2026-10-28). Discard throws the plan away.
//    The total hours never change: a longer span means fewer hours a day.
//    A finger on a bar still opens the task; the task page's fields remain
//    the keyboard way to change dates and assignees.
//
// Colour is never the only signal: every cell carries its numbers in its
// accessible name and tooltip, and an over-capacity cell carries a "!".
// =============================================================================

type Mode = "day" | "week";

const DAY_SPAN = 14;
const WEEK_SPAN = 8;

const LEVEL_CELL: Record<CapacityLevel, string> = {
  none: "",
  ok: "bg-superior-blue text-white",
  amber: "bg-ajax-yellow text-black",
  red: "bg-cooper-red text-white",
};

const LEVEL_WORDS: Record<CapacityLevel, string> = {
  none: "nothing scheduled",
  ok: "within capacity",
  amber: "near capacity",
  red: "over capacity",
};

/** Hatching for time off — the pattern carries "off" without relying on colour. */
const HATCH: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--color-border) 0 2px, transparent 2px 7px)",
};

export interface CapacityGridProps {
  items: readonly CapacityWorkItem[];
  timeOff: readonly CapacityTimeOff[];
  /** People who always get a row, loaded or not. */
  people: readonly Person[];
  /** Hours a day each person can work; defaults to the engine's 8. */
  dailyHours?: number;
  /** The share of capacity above which a day is amber; defaults to the engine's 0.85. */
  amberRatio?: number;
  /** Only `people` get a row; anyone else's work waits in the backlog with this reason. */
  onlyPeople?: boolean;
  notOnGridReason?: (assignees: Person[]) => string;
  /** Shown when nobody has a row. */
  emptyHint: string;
  /**
   * Keep an unsaved plan in this browser under this name, so leaving the page
   * doesn't lose it — e.g. "panels". Omit and the plan lives only on screen
   * (and leaving asks first instead).
   */
  draftKey?: string;
  /**
   * Save the staged plan: each item AS SAVED, with what changes. Resolves with
   * the ids that failed, which stay staged so they can be retried. Omit it
   * and nothing drags (a reader without edit rights, say).
   */
  onSave?: (
    changes: Array<{ item: CapacityWorkItem; change: CapacityChange }>,
  ) => Promise<{ failed: string[] }>;
}

interface DragState {
  item: CapacityWorkItem;
  mode: DragMode;
  /** The day the pointer went down on, and the day it is over now. */
  from: string;
  over: string;
  startX: number;
  /** Past the few pixels that still count as a click. */
  moved: boolean;
  /** Moving the whole bar over another person's row reassigns it. */
  overPerson: Person | null;
  /** The row the bar was picked up from — whose place on the item moves. */
  rowPerson: Person;
}

/** A backlog item being carried by its grip. */
interface CarryState {
  item: CapacityWorkItem;
  x: number;
  y: number;
  overPerson: Person | null;
  overDay: string | null;
}

interface HoverState {
  item: CapacityWorkItem;
  person: Person;
  x: number;
  y: number;
}

const DRAG_THRESHOLD_PX = 4;

const keyDate = (key: string) => new Date(`${key}T12:00:00Z`);

/** A plan kept under `key`, or an empty one. Never throws: storage can be blocked. */
function readStoredPlan(key: string | null): Map<string, CapacityChange> {
  if (!key) return new Map();
  try {
    return parsePlan(localStorage.getItem(key), Date.now());
  } catch {
    return new Map();
  }
}

function shortDay(key: string): { dow: string; date: string } {
  const d = new Date(`${key}T12:00:00Z`);
  return {
    dow: d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }),
    date: d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
  };
}

function rangeLabel(first: string, last: string): string {
  const fmt = (k: string) =>
    new Date(`${k}T12:00:00Z`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(first)} – ${fmt(last)}`;
}

function personId(p: Person): string {
  return p.email?.toLowerCase() ?? (p.lookupId ? `id:${p.lookupId}` : p.displayName);
}

export function CapacityGrid({
  items,
  timeOff,
  people,
  dailyHours,
  amberRatio = CAPACITY_AMBER_RATIO,
  onlyPeople,
  notOnGridReason,
  emptyHint,
  onSave,
  draftKey,
}: CapacityGridProps) {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get("view") === "week" ? "week" : "day";
  const today = toIsoDate(new Date());
  const rawFrom = params.get("from");
  const from = weekStart(rawFrom && /^\d{4}-\d{2}-\d{2}$/.test(rawFrom) ? rawFrom : today);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [carry, setCarry] = useState<CarryState | null>(null);
  // A plan kept from an earlier visit comes back, and says so.
  const storageKey = draftKey ? `arc:capacity-plan:${draftKey}` : null;
  const [initialPlan] = useState(() => readStoredPlan(storageKey));
  const [pending, setPending] = useState<Map<string, CapacityChange>>(initialPlan);
  const [restored, setRestored] = useState(initialPlan.size > 0);
  const [saving, setSaving] = useState(false);
  const [hover, setHover] = useState<HoverState | null>(null);
  // A drag ends with a click on the bar's link; this swallows that one click.
  const justDragged = useRef(false);
  const colRefs = useRef(new Map<string, HTMLElement>());

  // What's on screen: the saved items, then the staged plan, then whatever
  // is being dragged right now — so the cells recalculate live.
  const planned = useMemo(() => applyCapacityChanges(items, pending), [items, pending]);
  const dragChange = drag ? changeForDrag(drag) : null;
  const carryChange =
    carry?.overPerson && carry.overDay ? changeForCarry(carry.item, carry.overPerson, carry.overDay) : null;
  const shownItems = useMemo(() => {
    const live = new Map<string, CapacityChange>();
    if (drag && dragChange) live.set(drag.item.id, dragChange);
    if (carry && carryChange) live.set(carry.item.id, carryChange);
    return applyCapacityChanges(planned, live);
    // the live changes derive from drag / carry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planned, drag, carry]);

  const grid = useMemo(
    () =>
      buildCapacity({
        items: shownItems,
        timeOff,
        people,
        days: daysBetween(from, addDays(from, (mode === "day" ? DAY_SPAN : WEEK_SPAN * 7) - 1)),
        mode,
        dailyHours,
        amberRatio,
        onlyPeople,
        notOnGridReason,
      }),
    [shownItems, timeOff, people, from, mode, dailyHours, amberRatio, onlyPeople, notOnGridReason],
  );

  const offFor = useCallback(
    (person: Person) => timeOffByDay(timeOffFor(timeOff, person)),
    [timeOff],
  );

  /** The day column under a screen x, clamped to the first or last. */
  const columnAt = useCallback((x: number): string | null => {
    const cols = [...colRefs.current.entries()]
      .map(([key, el]) => ({ key, rect: el.getBoundingClientRect() }))
      .sort((a, b) => a.rect.left - b.rect.left);
    if (cols.length === 0) return null;
    for (const c of cols) if (x >= c.rect.left && x < c.rect.right) return c.key;
    return x < cols[0].rect.left ? cols[0].key : cols[cols.length - 1].key;
  }, []);

  const canDrag = mode === "day" && !!onSave;
  const dirty = pending.size > 0;

  /** A dragged bar's change: new dates, and a new person if it crossed rows. */
  function changeForDrag(d: DragState): CapacityChange {
    const next = rescheduled(
      d.mode,
      dayKeyOf(d.item.startDate as Date),
      dayKeyOf(d.item.dueDate as Date),
      d.from,
      d.over,
    );
    const change: CapacityChange = { startDate: keyDate(next.start), dueDate: keyDate(next.due) };
    if (d.mode === "move" && d.overPerson && !samePerson(d.overPerson, d.rowPerson)) {
      change.assignees = reassigned(d.item.assignees, d.rowPerson, d.overPerson);
    }
    return change;
  }

  function changeForCarry(item: CapacityWorkItem, person: Person, day: string): CapacityChange {
    const at = placeOnDay(item, day, dailyHours);
    // Carried from the backlog: it becomes this person's (replacing anybody
    // with no row, which is why it was waiting there).
    return { assignees: [person], startDate: keyDate(at.start), dueDate: keyDate(at.due) };
  }

  /** Fold a change into the plan, against the item as SAVED. */
  function stage(id: string, change: CapacityChange) {
    const saved = items.find((i) => i.id === id);
    if (!saved) return;
    setPending((prev) => {
      const next = new Map(prev);
      const merged = mergeChange(saved, prev.get(id), change);
      if (merged) next.set(id, merged);
      else next.delete(id);
      return next;
    });
  }

  /** The person whose row is under a screen point, if any. */
  const personAt = useCallback(
    (x: number, y: number): Person | null => {
      const el = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
      const id = el?.closest("[data-person-id]")?.getAttribute("data-person-id");
      return id ? (grid.rows.find((r) => personId(r.person) === id)?.person ?? null) : null;
    },
    [grid.rows],
  );

  async function save() {
    if (!onSave || !dirty) return;
    setSaving(true);
    try {
      const changes = [...pending.entries()].flatMap(([id, change]) => {
        const item = items.find((i) => i.id === id);
        return item ? [{ item, change }] : [];
      });
      const { failed } = await onSave(changes);
      setPending((prev) => new Map([...prev].filter(([id]) => failed.includes(id))));
      setRestored(false);
    } finally {
      setSaving(false);
    }
  }

  // A kept plan is checked against the tasks once they've loaded: anything
  // gone, done or already saved meanwhile drops out.
  const pruned = useRef(false);
  useEffect(() => {
    if (pruned.current || items.length === 0) return;
    pruned.current = true;
    setPending((prev) => (prev.size ? prunePlan(prev, items) : prev));
  }, [items]);

  // Keep the plan as it changes; an empty plan leaves nothing behind.
  useEffect(() => {
    if (!storageKey) return;
    try {
      if (pending.size) localStorage.setItem(storageKey, serializePlan(pending, Date.now()));
      else localStorage.removeItem(storageKey);
    } catch {
      // Storage blocked (private window, say): the plan just isn't kept.
    }
  }, [pending, storageKey]);

  // Without a kept plan, leaving loses it — so leaving asks first.
  const warnOnLeave = dirty && !storageKey;

  /** Leaving through a link with an unkept plan staged asks first. */
  function confirmLeave(e: React.MouseEvent) {
    if (warnOnLeave && !window.confirm("You have unsaved changes on this plan. Leave without saving them?")) {
      e.preventDefault();
    }
  }

  // The browser's own prompt on close or reload, for an unkept plan.
  useEffect(() => {
    if (!warnOnLeave) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [warnOnLeave]);

  function beginCarry(e: React.PointerEvent, item: CapacityWorkItem) {
    if (!canDrag || e.button !== 0 || e.pointerType === "touch") return;
    e.preventDefault();
    setCarry({ item, x: e.clientX, y: e.clientY, overPerson: null, overDay: null });
  }

  useEffect(() => {
    if (!carry) return;
    function onMove(e: PointerEvent) {
      const overPerson = personAt(e.clientX, e.clientY);
      const overDay = overPerson ? columnAt(e.clientX) : null;
      setCarry((c) => (c ? { ...c, x: e.clientX, y: e.clientY, overPerson, overDay } : c));
    }
    function onUp() {
      const c = carry!;
      if (c.overPerson && c.overDay) stage(c.item.id, changeForCarry(c.item, c.overPerson, c.overDay));
      setCarry(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCarry(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
    // stage / changeForCarry read current props; re-subscribing per move is fine
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carry, personAt, columnAt]);

  function beginDrag(e: React.PointerEvent, item: CapacityWorkItem, dragMode: DragMode, rowPerson: Person) {
    if (!canDrag || e.button !== 0 || e.pointerType === "touch") return;
    const at = columnAt(e.clientX);
    if (!at) return;
    e.preventDefault(); // no text selection, no native link drag
    justDragged.current = false;
    setDrag({
      item,
      mode: dragMode,
      from: at,
      over: at,
      startX: e.clientX,
      moved: false,
      overPerson: null,
      rowPerson,
    });
  }

  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      const over = columnAt(e.clientX) ?? drag!.over;
      // Only a whole-bar move can change hands; an end drag stays in its row.
      const row = drag!.mode === "move" ? personAt(e.clientX, e.clientY) : null;
      setDrag((d) =>
        d
          ? {
              ...d,
              over,
              overPerson: row ?? d.overPerson,
              moved:
                d.moved ||
                Math.abs(e.clientX - d.startX) > DRAG_THRESHOLD_PX ||
                (!!row && !samePerson(row, d.rowPerson)),
            }
          : d,
      );
      setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h));
    }
    function onUp() {
      const d = drag!;
      justDragged.current = d.moved;
      if (d.moved) stage(d.item.id, changeForDrag(d));
      setDrag(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        justDragged.current = true;
        setDrag(null);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
    // stage / changeForDrag read current props; re-subscribing per move is fine
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, columnAt, personAt]);
  const firstDay = from;
  const lastDay = addDays(from, (mode === "day" ? DAY_SPAN : WEEK_SPAN * 7) - 1);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ person: string; key: string } | null>(null);

  function update(next: { view?: Mode; from?: string }) {
    const p = new URLSearchParams(params);
    if (next.view !== undefined) {
      if (next.view === "week") p.set("view", "week");
      else p.delete("view");
    }
    if (next.from !== undefined) {
      if (next.from === weekStart(today)) p.delete("from");
      else p.set("from", next.from);
    }
    setParams(p, { replace: true });
    setSelected(null);
  }

  const step = mode === "day" ? 7 : 28;
  const allExpanded =
    grid.rows.length > 0 && grid.rows.every((r) => expanded.has(personId(r.person)));

  function toggle(row: CapacityRow) {
    const id = personId(row.person);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const overCount = grid.rows.filter((r) => r.worst === "red").length;
  const selectedRow = selected ? grid.rows.find((r) => personId(r.person) === selected.person) : null;
  const selectedCell = selectedRow?.cells.find((c) => c.key === selected?.key) ?? null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border bg-surface p-0.5" role="group" aria-label="Show">
          {(["day", "week"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => update({ view: m })}
              className={cn(
                "rounded px-3 py-1 text-sm font-medium transition-colors",
                mode === m ? "bg-accent text-white" : "text-fg-muted hover:text-fg",
              )}
            >
              {m === "day" ? "Days" : "Weeks"}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => update({ from: addDays(from, -step) })}
            aria-label={mode === "day" ? "Previous week" : "Previous four weeks"}
            className="rounded-md border border-border bg-surface p-1.5 text-fg-muted hover:text-fg"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => update({ from: weekStart(today) })}
            className="rounded-md border border-border bg-surface px-3 py-1 text-sm font-medium text-fg hover:bg-surface-2"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => update({ from: addDays(from, step) })}
            aria-label={mode === "day" ? "Next week" : "Next four weeks"}
            className="rounded-md border border-border bg-surface p-1.5 text-fg-muted hover:text-fg"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <span className="text-sm text-fg-muted">{rangeLabel(firstDay, lastDay)}</span>
        <button
          type="button"
          onClick={() =>
            setExpanded(allExpanded ? new Set() : new Set(grid.rows.map((r) => personId(r.person))))
          }
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1 text-sm text-fg-muted hover:text-fg"
        >
          {allExpanded ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>
      </div>

      {dirty && (
        <div
          role="status"
          className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-ajax-yellow/60 bg-surface px-3 py-2 text-sm shadow-md"
        >
          <span className="min-w-0 flex-1 text-fg">
            <strong>
              {pending.size} unsaved change{pending.size === 1 ? "" : "s"}
            </strong>{" "}
            <span className="text-fg-muted">
              {restored ? "— kept from your last visit. " : "— "}
              nothing is saved or emailed until you press Save.
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              setPending(new Map());
              setRestored(false);
            }}
            disabled={saving}
            className="rounded-md border border-border bg-surface px-3 py-1 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save changes
          </button>
        </div>
      )}

      <Legend overCount={overCount} amberRatio={amberRatio} />

      {grid.rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-fg-muted">
          {emptyHint}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table
            className="w-full min-w-[56rem] table-fixed border-collapse text-sm"
            aria-label="Capacity by person"
          >
            <thead>
              <tr className="border-b border-border bg-surface-2 text-xs text-fg-muted">
                <th className="sticky left-0 z-10 w-32 bg-surface-2 px-3 py-2 text-left font-semibold sm:w-48">
                  Person
                </th>
                {grid.columns.map((key) => {
                  const working = mode === "week" || isWorkingDay(key);
                  const isToday = mode === "day" ? key === today : key === weekStart(today);
                  const { dow, date } = shortDay(key);
                  return (
                    <th
                      key={key}
                      ref={(el) => {
                        if (el && mode === "day") colRefs.current.set(key, el);
                        else colRefs.current.delete(key);
                      }}
                      scope="col"
                      data-day-key={key}
                      className={cn(
                        "px-1 py-1.5 text-center font-medium",
                        !working && "w-8 opacity-60",
                        isToday && "text-accent",
                      )}
                    >
                      {mode === "day" ? (
                        <>
                          <div>{working ? dow : dow.slice(0, 2)}</div>
                          <div className="text-[10px]">{working ? date : ""}</div>
                        </>
                      ) : (
                        <>
                          <div>Week of</div>
                          <div className="text-[10px]">{date}</div>
                        </>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => {
                const id = personId(row.person);
                const open = expanded.has(id);
                const dropTarget =
                  (carry?.overPerson && personId(carry.overPerson) === id) ||
                  (drag?.overPerson && personId(drag.overPerson) === id);
                return (
                  <Fragment key={id}>
                    <tr
                      data-person-id={id}
                      className={cn("border-b border-border", dropTarget && "bg-accent/10")}
                    >
                      <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-normal">
                        <button
                          type="button"
                          onClick={() => toggle(row)}
                          aria-expanded={open}
                          className="flex w-full items-center gap-1.5 text-left font-medium text-fg"
                        >
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 shrink-0 text-fg-muted transition-transform",
                              !open && "-rotate-90",
                            )}
                          />
                          <span className="truncate">{row.person.displayName}</span>
                          {row.worst === "red" && (
                            <AlertTriangle
                              className="h-3.5 w-3.5 shrink-0 text-cooper-red"
                              aria-label="Over capacity in this period"
                            />
                          )}
                        </button>
                        <span className="ml-5 text-[11px] text-fg-muted">
                          {row.items.length} task{row.items.length === 1 ? "" : "s"}
                        </span>
                      </th>
                      {row.cells.map((cell) => (
                        <CapacityTd
                          key={cell.key}
                          cell={cell}
                          person={row.person}
                          mode={mode}
                          selected={selected?.person === id && selected.key === cell.key}
                          onSelect={() =>
                            setSelected((s) =>
                              s?.person === id && s.key === cell.key ? null : { person: id, key: cell.key },
                            )
                          }
                        />
                      ))}
                    </tr>
                    {open && (
                      <ItemBars
                        row={row}
                        columns={grid.columns}
                        mode={mode}
                        personKey={id}
                        off={offFor(row.person)}
                        canDrag={canDrag}
                        unsaved={pending}
                        onLeave={confirmLeave}
                        dragging={drag?.item.id ?? null}
                        onBeginDrag={(e, item, m) => beginDrag(e, item, m, row.person)}
                        onHover={(item, e) =>
                          setHover(item && e ? { item, person: row.person, x: e.x, y: e.y } : null)
                        }
                        swallowClick={() => {
                          const was = justDragged.current;
                          justDragged.current = false;
                          return was;
                        }}
                      />
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(hover || drag) && (
        <BarHoverCard
          item={
            // Show the dragged item's live preview dates.
            shownItems.find((i) => i.id === (drag?.item.id ?? hover?.item.id)) ??
            (hover?.item as CapacityWorkItem)
          }
          off={offFor(drag ? drag.rowPerson : (hover as HoverState).person)}
          x={hover?.x ?? drag?.startX ?? 0}
          y={hover?.y ?? 0}
          dragHint={canDrag && !drag}
          weekHint={mode === "week" && !!onSave}
          unsaved={pending.has(drag?.item.id ?? hover?.item.id ?? "")}
        />
      )}

      {selectedRow && selectedCell && (
        <CellDetail
          person={selectedRow.person}
          cell={selectedCell}
          mode={mode}
          onClose={() => setSelected(null)}
          onLeave={confirmLeave}
        />
      )}

      <section className="rounded-xl border border-border bg-surface" aria-labelledby="capacity-backlog">
        <h2
          id="capacity-backlog"
          className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg"
        >
          <Inbox className="h-4 w-4 text-fg-muted" />
          Backlog — {grid.backlog.length} task{grid.backlog.length === 1 ? "" : "s"} not on the grid
          {canDrag && grid.backlog.length > 0 && (
            <span className="ml-auto text-xs font-normal text-fg-muted">
              Drag a task onto a person and a day
            </span>
          )}
        </h2>
        {grid.backlog.length === 0 ? (
          <p className="px-4 py-3 text-sm text-fg-muted">
            Every unfinished task has an assignee, dates and hours.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {grid.backlog.map(({ item, reason }) => (
              // The whole row drags, except the title: only the title's own
              // text is the link to the task (Tim, 2026-10-28).
              <li
                key={item.id}
                data-testid={`backlog-row-${item.id}`}
                title={canDrag ? "Drag onto a person and a day" : undefined}
                onPointerDown={
                  canDrag
                    ? (e) => {
                        if ((e.target as HTMLElement).closest("a")) return;
                        beginCarry(e, item);
                      }
                    : undefined
                }
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm",
                  canDrag && "cursor-grab select-none hover:bg-surface-2/60",
                  pending.has(item.id) && "bg-ajax-yellow/10",
                  carry?.item.id === item.id && "opacity-50",
                )}
              >
                {canDrag && (
                  <span data-testid={`backlog-grip-${item.id}`} className="-ml-2 text-fg-muted">
                    <GripVertical className="h-4 w-4" aria-hidden="true" />
                  </span>
                )}
                <Link
                  to={item.href}
                  onClick={confirmLeave}
                  draggable={false}
                  className="min-w-0 max-w-full cursor-pointer truncate font-medium text-fg hover:underline"
                >
                  {item.title}
                </Link>
                <span className="ml-auto text-xs text-fg-muted">
                  {item.assignees.map((a) => a.displayName).join(", ") || "Unassigned"}
                </span>
                {item.estimatedHours !== null && (
                  <span className="text-xs text-fg-muted">{formatHours(item.estimatedHours)}</span>
                )}
                {pending.has(item.id) && <span className="text-xs font-medium text-fg">Unsaved</span>}
                <span className="rounded-full bg-ajax-yellow/20 px-2 py-0.5 text-xs font-medium text-fg">
                  {reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {carry &&
        createPortal(
          <div
            aria-hidden="true"
            style={{ left: carry.x + 12, top: carry.y + 12 }}
            className="pointer-events-none fixed z-50 max-w-xs truncate rounded bg-cooper-green px-2 py-1 text-xs font-medium text-white shadow-lg"
          >
            {carry.item.title}
            {carry.overPerson && carry.overDay
              ? ` → ${carry.overPerson.displayName}, ${shortDay(carry.overDay).dow} ${shortDay(carry.overDay).date}`
              : ""}
          </div>,
          document.body,
        )}
    </>
  );
}

function Legend({ overCount, amberRatio }: { overCount: number; amberRatio: number }) {
  const amberPct = Math.round(amberRatio * 100);
  const swatch = "inline-block h-3 w-3 rounded-sm";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      <span className="flex items-center gap-1.5">
        <span className={cn(swatch, "bg-superior-blue")} /> Up to {amberPct}%
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn(swatch, "bg-ajax-yellow")} /> Over {amberPct}%
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn(swatch, "bg-cooper-red")} /> Over 100% (!)
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn(swatch, "border border-border")} style={HATCH} /> Time off
      </span>
      <span className="ml-auto font-medium text-fg">
        {overCount === 0
          ? "Nobody is over capacity in these weeks."
          : `${overCount} ${overCount === 1 ? "person is" : "people are"} over capacity in these weeks.`}
      </span>
    </div>
  );
}

function cellLabel(person: Person, cell: CapacityCell, mode: Mode): string {
  const when =
    mode === "day"
      ? new Date(`${cell.key}T12:00:00Z`).toLocaleDateString(undefined, {
          weekday: "long",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })
      : `week of ${shortDay(cell.key).date}`;
  const parts = [
    `${person.displayName}, ${when}: ${formatHours(cell.load)} of ${formatHours(cell.capacity)}`,
  ];
  parts.push(LEVEL_WORDS[cell.level]);
  if (cell.allOff) parts.push("off");
  else if (cell.offHours > 0) parts.push(`${formatHours(cell.offHours)} off`);
  return parts.join(", ");
}

function CapacityTd({
  cell,
  person,
  mode,
  selected,
  onSelect,
}: {
  cell: CapacityCell;
  person: Person;
  mode: Mode;
  selected: boolean;
  onSelect: () => void;
}) {
  const working = mode === "week" || isWorkingDay(cell.key);
  if (!working) {
    return <td className="bg-surface-2/60" aria-hidden="true" />;
  }
  const label = cellLabel(person, cell, mode);
  const showHatch = cell.offHours > 0 && cell.level === "none";
  return (
    <td className="p-0.5">
      <button
        type="button"
        onClick={onSelect}
        aria-label={label}
        title={label}
        aria-pressed={selected}
        style={showHatch ? HATCH : undefined}
        className={cn(
          "flex h-9 w-full items-center justify-center rounded text-xs font-semibold tabular-nums transition-shadow",
          LEVEL_CELL[cell.level],
          cell.level === "none" && "text-fg-muted hover:bg-surface-2",
          selected && "ring-2 ring-accent ring-offset-1 ring-offset-surface",
        )}
      >
        {cell.load > 0 ? (
          <>
            {formatHours(cell.load)}
            {cell.level === "red" && <span aria-hidden="true">!</span>}
          </>
        ) : cell.allOff ? (
          "Off"
        ) : (
          ""
        )}
      </button>
    </td>
  );
}

/** The person's items as bars across the columns they span. */
function ItemBars({
  row,
  columns,
  mode,
  personKey,
  off,
  canDrag,
  unsaved,
  onLeave,
  dragging,
  onBeginDrag,
  onHover,
  swallowClick,
}: {
  row: CapacityRow;
  columns: string[];
  mode: Mode;
  personKey: string;
  off: Map<string, number | null>;
  canDrag: boolean;
  unsaved: ReadonlyMap<string, CapacityChange>;
  onLeave: (e: React.MouseEvent) => void;
  dragging: string | null;
  onBeginDrag: (e: React.PointerEvent, item: CapacityWorkItem, mode: DragMode) => void;
  onHover: (item: CapacityWorkItem | null, at?: { x: number; y: number }) => void;
  swallowClick: () => boolean;
}) {
  if (row.items.length === 0) {
    return (
      <tr data-person-id={personKey} className="border-b border-border bg-surface-2/40">
        <td className="sticky left-0 z-10 bg-surface-2/40" />
        <td colSpan={columns.length} className="px-2 py-1.5 text-xs text-fg-muted">
          No tasks in these weeks.
        </td>
      </tr>
    );
  }
  const colOf = (date: Date) => (mode === "day" ? dayKeyOf(date) : weekStart(dayKeyOf(date)));
  return (
    <>
      {[...row.items]
        .sort((a, b) => (a.startDate as Date).getTime() - (b.startDate as Date).getTime())
        .map((item) => {
          const startKey = colOf(item.startDate as Date);
          const endKey = colOf(item.dueDate as Date);
          const startIdx = Math.max(0, columns.findIndex((c) => c >= startKey));
          let endIdx = columns.length - 1;
          for (let i = columns.length - 1; i >= 0; i--) {
            if (columns[i] <= endKey) {
              endIdx = i;
              break;
            }
          }
          const span = Math.max(1, endIdx - startIdx + 1);
          // An end off-screen has no handle: it can't be grabbed where it isn't.
          const startShown = columns[0] <= startKey;
          const endShown = columns[columns.length - 1] >= endKey;
          const perDay = describeSpread(item, off).perDay;
          const isDragging = dragging === item.id;
          const handle =
            "absolute top-0 z-[1] h-full w-2 cursor-ew-resize bg-black/25 opacity-0 transition-opacity group-hover:opacity-100";
          return (
            <tr key={item.id} data-person-id={personKey} className="border-b border-border/60 bg-surface-2/40">
              <td className="sticky left-0 z-10 bg-surface-2/40 px-3 py-1 pl-8 text-xs text-fg-muted">
                {formatHours(item.estimatedHours ?? 0)}
              </td>
              {startIdx > 0 && <td colSpan={startIdx} />}
              <td colSpan={span} className="px-0.5 py-1">
                <div className="group relative">
                  {canDrag && startShown && (
                    <span
                      aria-hidden="true"
                      data-testid={`bar-start-${item.id}`}
                      onPointerDown={(e) => onBeginDrag(e, item, "start")}
                      className={cn(handle, "left-0 rounded-l")}
                    />
                  )}
                  <Link
                    to={item.href}
                    draggable={false}
                    data-testid={`bar-${item.id}`}
                    aria-label={
                      perDay !== null ? `${item.title}, ${formatHours(perDay)} a day` : item.title
                    }
                    onPointerDown={canDrag ? (e) => onBeginDrag(e, item, "move") : undefined}
                    onPointerEnter={(e) => onHover(item, { x: e.clientX, y: e.clientY })}
                    onPointerMove={(e) => onHover(item, { x: e.clientX, y: e.clientY })}
                    onPointerLeave={() => onHover(null)}
                    onFocus={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      onHover(item, { x: r.left, y: r.bottom });
                    }}
                    onBlur={() => onHover(null)}
                    onClick={(e) => {
                      if (swallowClick()) e.preventDefault();
                      else onLeave(e);
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded bg-cooper-green px-2 py-1 text-xs font-medium text-white hover:bg-cooper-green/85",
                      canDrag && "cursor-grab select-none",
                      // Staged, not saved: a dashed yellow outline.
                      unsaved.has(item.id) && "outline-2 outline-offset-1 outline-dashed outline-ajax-yellow",
                      isDragging && "cursor-grabbing ring-2 ring-accent",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {perDay !== null && (
                      <span className="shrink-0 tabular-nums opacity-80">{formatHours(perDay)}/d</span>
                    )}
                  </Link>
                  {canDrag && endShown && (
                    <span
                      aria-hidden="true"
                      data-testid={`bar-end-${item.id}`}
                      onPointerDown={(e) => onBeginDrag(e, item, "end")}
                      className={cn(handle, "right-0 rounded-r")}
                    />
                  )}
                </div>
              </td>
              {columns.length - startIdx - span > 0 && <td colSpan={columns.length - startIdx - span} />}
            </tr>
          );
        })}
    </>
  );
}

function formatDay(d: Date | null): string {
  return d
    ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    : "—";
}

/** Wrike's hover card: hours a day and the total, then where it sits. */
function BarHoverCard({
  item,
  off,
  x,
  y,
  dragHint,
  weekHint,
  unsaved,
}: {
  item: CapacityWorkItem;
  off: Map<string, number | null>;
  x: number;
  y: number;
  dragHint: boolean;
  weekHint: boolean;
  unsaved: boolean;
}) {
  const spread = describeSpread(item, off);
  const width = 288;
  const left = Math.max(8, Math.min(x + 12, window.innerWidth - width - 8));
  return createPortal(
    <div
      role="tooltip"
      style={{ left, top: y + 16, width }}
      className="pointer-events-none fixed z-50 rounded-lg border border-border bg-surface p-3 text-xs shadow-xl"
    >
      <div className="font-semibold text-fg">{item.title}</div>
      <div className="mt-1 tabular-nums text-fg">
        {spread.perDay !== null ? `${formatHours(spread.perDay)}/d · ` : ""}
        {formatHours(item.estimatedHours ?? 0)} total
        {spread.days > 0 && ` over ${spread.days} day${spread.days === 1 ? "" : "s"}`}
      </div>
      <div className="mt-0.5 text-fg-muted">
        {formatDay(item.startDate)} – {formatDay(item.dueDate)}
        {spread.skippedOff > 0 &&
          ` · skips ${spread.skippedOff} day${spread.skippedOff === 1 ? "" : "s"} off`}
      </div>
      {(item.context || item.statusLabel) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.context && (
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-fg">{item.context}</span>
          )}
          {item.statusLabel && (
            <span className="rounded border border-border px-1.5 py-0.5 text-fg-muted">
              {item.statusLabel}
            </span>
          )}
        </div>
      )}
      {unsaved && <div className="mt-2 font-medium text-fg">Unsaved — press Save to keep it.</div>}
      {dragHint && (
        <div className="mt-2 text-fg-muted">
          Drag to move or onto another person · drag an end to change the dates
        </div>
      )}
      {weekHint && <div className="mt-2 text-fg-muted">Switch to Days to drag it.</div>}
    </div>,
    document.body,
  );
}

function CellDetail({
  person,
  cell,
  mode,
  onClose,
  onLeave,
}: {
  person: Person;
  cell: CapacityCell;
  mode: Mode;
  onClose: () => void;
  onLeave: (e: React.MouseEvent) => void;
}) {
  return (
    <section aria-label="Tasks behind the selected cell" className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
        <h2 className="min-w-0 flex-1 text-sm font-medium text-fg">{cellLabel(person, cell, mode)}</h2>
        <button type="button" onClick={onClose} className="text-xs text-fg-muted hover:text-fg">
          Close
        </button>
      </div>
      {cell.items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-fg-muted">No task hours here.</p>
      ) : (
        <ul className="divide-y divide-border">
          {cell.items.map(({ item, hours }) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
              <Link
                to={item.href}
                onClick={onLeave}
                className="min-w-0 flex-1 truncate font-medium text-fg hover:underline"
              >
                {item.title}
              </Link>
              {item.context && <span className="text-xs text-fg-muted">{item.context}</span>}
              {item.statusLabel && (
                <span className="rounded-full border border-border px-2 py-0.5 text-xs text-fg-muted">
                  {item.statusLabel}
                </span>
              )}
              <span className="tabular-nums text-xs font-semibold text-fg">{formatHours(hours)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
