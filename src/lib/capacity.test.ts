import { describe, expect, it } from "vitest";
import type { Person } from "@/types/task";
import {
  addDays,
  buildCapacity,
  capacityLevel,
  daysBetween,
  parsePlan,
  prunePlan,
  serializePlan,
  applyCapacityChanges,
  mergeChange,
  placeOnDay,
  describeSpread,
  rescheduled,
  formatHours,
  isWorkingDay,
  samePerson,
  scheduleProblem,
  spreadItem,
  timeOffByDay,
  timeOffFor,
  hoursEach,
  reassigned,
  samePeople,
  weekStart,
  type CapacityTimeOff,
  type CapacityWorkItem,
} from "./capacity";

// 2026-11-02 is a Monday.
const MON = "2026-11-02";
const d = (key: string) => new Date(`${key}T12:00:00Z`);

const ANA: Person = { displayName: "Ana Engineer", email: "ana@example.com", lookupId: 1 };
const BOB: Person = { displayName: "Bob Builder", email: "bob@example.com", lookupId: 2 };

// Work items are generic — any task list's adapter produces this shape.
function task(over: Partial<Omit<CapacityWorkItem, "id">> & { id: number }): CapacityWorkItem {
  const { id, ...rest } = over;
  return {
    id: String(id),
    title: `Task ${id}`,
    href: `/x/${id}`,
    assignees: [ANA],
    startDate: d(MON),
    dueDate: d(addDays(MON, 4)),
    estimatedHours: 20,
    done: false,
    ...rest,
  };
}

function off(over: Partial<CapacityTimeOff> & { id: number }): CapacityTimeOff {
  const { id: _id, ...rest } = over;
  void _id;
  return {
    person: ANA,
    startDate: d(MON),
    endDate: d(MON),
    hoursPerDay: null,
    ...rest,
  };
}

describe("capacityLevel", () => {
  it("is blue up to 85%, amber above it, red above 100%", () => {
    expect(capacityLevel(0, 8)).toBe("none");
    expect(capacityLevel(6.8, 8)).toBe("ok"); // exactly 85%
    expect(capacityLevel(6.81, 8)).toBe("amber");
    expect(capacityLevel(8, 8)).toBe("amber"); // exactly 100% is not over
    expect(capacityLevel(8.05, 8)).toBe("red"); // Wrike: any amount over is red
  });

  it("treats any load against zero capacity as over", () => {
    expect(capacityLevel(1, 0)).toBe("red");
  });

  it("isn't fooled by floating-point sums", () => {
    expect(capacityLevel(16 / 3 + 8 / 3, 8)).toBe("amber");
  });
});

describe("days", () => {
  it("knows weekdays, week starts and ranges", () => {
    expect(isWorkingDay(MON)).toBe(true);
    expect(isWorkingDay(addDays(MON, 5))).toBe(false); // Saturday
    expect(weekStart(addDays(MON, 6))).toBe(MON); // Sunday → the Monday before
    expect(daysBetween(MON, addDays(MON, 2))).toEqual([MON, "2026-11-03", "2026-11-04"]);
    expect(daysBetween(MON, addDays(MON, -1))).toEqual([]);
  });
});

describe("samePerson", () => {
  it("matches on lookupId, then email", () => {
    expect(samePerson(ANA, { displayName: "", lookupId: 1 })).toBe(true);
    expect(samePerson(ANA, BOB)).toBe(false);
    expect(samePerson({ displayName: "A", email: "Ana@Example.com" }, ANA)).toBe(true);
  });
});

describe("scheduleProblem", () => {
  it("names what's missing", () => {
    expect(scheduleProblem(task({ id: 1 }))).toBeNull();
    expect(scheduleProblem(task({ id: 1, assignees: [] }))).toBe("Nobody assigned");
    expect(scheduleProblem(task({ id: 1, estimatedHours: null }))).toBe("No estimated hours");
    expect(scheduleProblem(task({ id: 1, startDate: null }))).toBe("No start date");
    expect(scheduleProblem(task({ id: 1, dueDate: null }))).toBe("No due date");
    expect(scheduleProblem(task({ id: 1, startDate: null, dueDate: null }))).toBe(
      "No start or due date",
    );
    expect(scheduleProblem(task({ id: 1, dueDate: d(addDays(MON, -1)) }))).toMatch(/before/);
  });
});

describe("spreadItem", () => {
  it("spreads evenly over the working days, skipping the weekend", () => {
    // Thu → next Tue: Thu, Fri, Mon, Tue.
    const spread = spreadItem(
      task({ id: 1, startDate: d(addDays(MON, 3)), dueDate: d(addDays(MON, 8)), estimatedHours: 16 }),
    );
    expect([...spread.keys()]).toEqual(["2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"]);
    expect([...spread.values()]).toEqual([4, 4, 4, 4]);
  });

  it("moves hours off a whole day off, but not off a part day", () => {
    const wholeDay = timeOffByDay([off({ id: 1 })]);
    expect(spreadItem(task({ id: 1 }), wholeDay).has(MON)).toBe(false);
    expect(spreadItem(task({ id: 1 }), wholeDay).get(addDays(MON, 1))).toBe(5);

    const partDay = timeOffByDay([off({ id: 1, hoursPerDay: 4 })]);
    expect(spreadItem(task({ id: 1 }), partDay).get(MON)).toBe(4);
  });

  it("still places a task that sits entirely on a weekend", () => {
    const sat = addDays(MON, 5);
    const spread = spreadItem(task({ id: 1, startDate: d(sat), dueDate: d(sat), estimatedHours: 3 }));
    expect(spread.get(sat)).toBe(3);
  });
});

describe("timeOffByDay", () => {
  it("covers the whole range, and a whole day wins over a part day", () => {
    const map = timeOffByDay([
      off({ id: 1, endDate: d(addDays(MON, 1)) }),
      off({ id: 2, hoursPerDay: 2 }),
      off({ id: 3, startDate: d(addDays(MON, 2)), endDate: d(addDays(MON, 2)), hoursPerDay: 2 }),
      off({ id: 4, startDate: d(addDays(MON, 2)), endDate: d(addDays(MON, 2)), hoursPerDay: 1 }),
    ]);
    expect(map.get(MON)).toBeNull();
    expect(map.get(addDays(MON, 1))).toBeNull();
    expect(map.get(addDays(MON, 2))).toBe(3);
  });
});

describe("buildCapacity", () => {
  const week = daysBetween(MON, addDays(MON, 6));

  it("adds overlapping tasks into each day and colours by capacity", () => {
    const grid = buildCapacity({
      items: [task({ id: 1, estimatedHours: 20 }), task({ id: 2, estimatedHours: 20 })],
      timeOff: [],
      people: [],
      days: week,
      mode: "day",
    });
    const row = grid.rows[0];
    expect(row.person).toBe(ANA);
    expect(row.cells[0]).toMatchObject({ load: 8, capacity: 8, level: "amber" });
    expect(row.cells[0].items.map((s) => s.item.id)).toEqual(["1", "2"]);
    expect(row.cells[5]).toMatchObject({ load: 0, capacity: 0, level: "none" }); // Saturday
  });

  it("gives seeded people a row with nothing on it, and adds anyone else with work", () => {
    const grid = buildCapacity({
      items: [task({ id: 1, assignees: [BOB] })],
      timeOff: [],
      people: [ANA],
      days: week,
      mode: "day",
    });
    expect(grid.rows.map((r) => r.person.displayName)).toEqual(["Ana Engineer", "Bob Builder"]);
    expect(grid.rows[0].worst).toBe("none");
  });

  it("takes time off out of that person's capacity only", () => {
    const grid = buildCapacity({
      items: [task({ id: 1, estimatedHours: 32 })],
      timeOff: [off({ id: 1 }), off({ id: 2, person: BOB, hoursPerDay: 8 })],
      people: [BOB],
      days: week,
      mode: "day",
    });
    const ana = grid.rows.find((r) => r.person === ANA)!;
    expect(ana.cells[0]).toMatchObject({ load: 0, capacity: 0, allOff: true, offHours: 8 });
    expect(ana.cells[1]).toMatchObject({ load: 8, capacity: 8 }); // 32h over 4 days
    const bob = grid.rows.find((r) => r.person === BOB)!;
    expect(bob.cells[0]).toMatchObject({ capacity: 0, allOff: false, offHours: 8 });
  });

  it("puts unschedulable tasks in the backlog with the reason, and drops finished ones", () => {
    const grid = buildCapacity({
      items: [
        task({ id: 1, assignees: [] }),
        task({ id: 2, estimatedHours: null }),
        task({ id: 3, done: true }),
      ],
      timeOff: [],
      people: [],
      days: week,
      mode: "day",
    });
    expect(grid.backlog.map((b) => [b.item.id, b.reason])).toEqual([
      ["1", "Nobody assigned"],
      ["2", "No estimated hours"],
    ]);
    expect(grid.rows).toEqual([]);
  });

  it("leaves out tasks outside the window", () => {
    const grid = buildCapacity({
      items: [task({ id: 1, startDate: d(addDays(MON, 14)), dueDate: d(addDays(MON, 15)) })],
      timeOff: [],
      people: [ANA],
      days: week,
      mode: "day",
    });
    expect(grid.rows[0].items).toEqual([]);
  });

  it("counts a task that started before the window at its real daily share", () => {
    // 10 working days, 40h → 4h/day, even though only this week is on screen.
    const grid = buildCapacity({
      items: [task({ id: 1, startDate: d(addDays(MON, -7)), estimatedHours: 40 })],
      timeOff: [],
      people: [],
      days: week,
      mode: "day",
    });
    expect(grid.rows[0].cells[0].load).toBe(4);
  });

  it("totals a week from the unrounded days", () => {
    const grid = buildCapacity({
      items: [task({ id: 1, startDate: d(MON), dueDate: d(addDays(MON, 2)), estimatedHours: 20 })],
      timeOff: [],
      people: [],
      days: daysBetween(MON, addDays(MON, 6)),
      mode: "week",
    });
    // 6.666… × 3, not 6.67 × 3 = 20.01.
    expect(grid.rows[0].cells[0].load).toBe(20);
  });

  it("in week mode sums the week but is red if ANY day was", () => {
    const grid = buildCapacity({
      items: [
        task({ id: 1, startDate: d(MON), dueDate: d(MON), estimatedHours: 14 }),
        task({ id: 2, startDate: d(addDays(MON, 1)), dueDate: d(addDays(MON, 1)), estimatedHours: 2 }),
      ],
      timeOff: [],
      people: [],
      days: daysBetween(MON, addDays(MON, 13)),
      mode: "week",
    });
    expect(grid.columns).toEqual([MON, addDays(MON, 7)]);
    expect(grid.rows[0].cells[0]).toMatchObject({ load: 16, capacity: 40, level: "red" });
    expect(grid.rows[0].cells[1]).toMatchObject({ load: 0, level: "none" });
    expect(grid.rows[0].worst).toBe("red");
  });
});

describe("formatHours", () => {
  it("drops trailing zeros", () => {
    expect(formatHours(8)).toBe("8h");
    expect(formatHours(16 / 3)).toBe("5.33h");
  });
});

describe("rescheduled", () => {
  it("moves both dates by the same number of days, either way", () => {
    expect(rescheduled("move", "2026-11-02", "2026-11-04", "2026-11-03", "2026-11-06")).toEqual({
      start: "2026-11-05",
      due: "2026-11-07",
    });
    expect(rescheduled("move", "2026-11-02", "2026-11-04", "2026-11-03", "2026-11-01")).toEqual({
      start: "2026-10-31",
      due: "2026-11-02",
    });
    expect(rescheduled("move", "2026-11-02", "2026-11-04", "2026-11-03", "2026-11-03")).toEqual({
      start: "2026-11-02",
      due: "2026-11-04",
    });
  });

  it("moves one end, never past the other", () => {
    expect(rescheduled("start", "2026-11-02", "2026-11-04", "2026-11-02", "2026-10-30").start).toBe("2026-10-30");
    expect(rescheduled("start", "2026-11-02", "2026-11-04", "2026-11-02", "2026-11-09").start).toBe("2026-11-04");
    expect(rescheduled("end", "2026-11-02", "2026-11-04", "2026-11-04", "2026-11-10").due).toBe("2026-11-10");
    expect(rescheduled("end", "2026-11-02", "2026-11-04", "2026-11-04", "2026-10-28").due).toBe("2026-11-02");
  });
});

describe("describeSpread", () => {
  it("says how many days the hours land on, how many a day, and what time off skipped", () => {
    expect(describeSpread(task({ id: 1, estimatedHours: 20 }))).toEqual({ days: 5, perDay: 4, skippedOff: 0 });
    const offMon = timeOffByDay([off({ id: 1 })]);
    expect(describeSpread(task({ id: 1, estimatedHours: 20 }), offMon)).toEqual({ days: 4, perDay: 5, skippedOff: 1 });
    expect(describeSpread(task({ id: 1, estimatedHours: null }))).toEqual({ days: 0, perDay: null, skippedOff: 0 });
  });
});

describe("planning helpers", () => {
  const saved = task({ id: 1 }); // Ana, Mon–Fri

  it("applies unsaved changes over the saved items", () => {
    const shown = applyCapacityChanges([saved], new Map([["1", { assignees: [BOB] }]]));
    expect(shown[0].assignees).toEqual([BOB]);
    expect(shown[0].startDate).toBe(saved.startDate);
  });

  it("drops a field put back to its saved value, and the whole change when nothing is left", () => {
    expect(mergeChange(saved, undefined, { assignees: [BOB] })).toEqual({ assignees: [BOB] });
    expect(mergeChange(saved, { assignees: [BOB] }, { startDate: d(addDays(MON, 1)) })).toEqual({
      assignees: [BOB],
      startDate: d(addDays(MON, 1)),
    });
    expect(mergeChange(saved, { assignees: [BOB] }, { assignees: [ANA] })).toBeNull();
    expect(mergeChange(saved, { startDate: d(addDays(MON, 1)) }, { startDate: d(MON) })).toBeNull();
  });

  it("places an undated item from the first working day, as many days as its hours need", () => {
    const undated = task({ id: 2, startDate: null, dueDate: null, estimatedHours: 20 });
    // 20h at 8h a day = 3 days, Thu → Fri → (weekend) → Mon.
    expect(placeOnDay(undated, addDays(MON, 3))).toEqual({ start: "2026-11-05", due: "2026-11-09" });
    // Dropped on a Saturday: starts Monday.
    expect(placeOnDay({ ...undated, estimatedHours: 4 }, addDays(MON, 5))).toEqual({
      start: "2026-11-09",
      due: "2026-11-09",
    });
    expect(placeOnDay({ ...undated, estimatedHours: null }, MON)).toEqual({ start: MON, due: MON });
  });

  it("keeps a dated item's length when it's dropped on a new day", () => {
    expect(placeOnDay(saved, addDays(MON, 7))).toEqual({ start: "2026-11-09", due: "2026-11-13" });
  });
});

describe("keeping a plan", () => {
  const NOW = Date.UTC(2026, 10, 4, 15);
  const plan = new Map([["1", { assignees: [BOB], startDate: d(addDays(MON, 7)), dueDate: d(addDays(MON, 9)) }]]);

  it("round-trips through JSON without shifting a day", () => {
    const back = parsePlan(serializePlan(plan, NOW), NOW);
    expect(back.get("1")?.assignees).toEqual([BOB]);
    expect(back.get("1")?.startDate?.toISOString()).toBe("2026-11-09T12:00:00.000Z");
    expect(back.get("1")?.dueDate?.toISOString()).toBe("2026-11-11T12:00:00.000Z");
  });

  it("comes back empty when missing, unreadable or over a week old", () => {
    expect(parsePlan(null, NOW).size).toBe(0);
    expect(parsePlan("{not json", NOW).size).toBe(0);
    expect(parsePlan(serializePlan(plan, NOW - 8 * 24 * 60 * 60 * 1000), NOW).size).toBe(0);
  });

  it("drops what's gone, done, or already saved", () => {
    const kept = new Map([
      ["1", { assignees: [BOB] }],
      ["2", { assignees: [BOB] }],
      ["3", { assignees: [BOB] }],
    ]);
    const pruned = prunePlan(kept, [
      task({ id: 1 }), // still Ana's: the change stands
      task({ id: 2, assignees: [BOB] }), // already saved as Bob: nothing left
      // 3 is gone
    ]);
    expect([...pruned.keys()]).toEqual(["1"]);
    expect(prunePlan(new Map([["1", { assignees: [BOB] }]]), [task({ id: 1, done: true })]).size).toBe(0);
  });
});

describe("several assignees", () => {
  const week = daysBetween(MON, addDays(MON, 6));

  it("split an item's hours evenly, each share spread over that person's days", () => {
    const item = task({ id: 1, assignees: [ANA, BOB], estimatedHours: 20 });
    expect(hoursEach(item)).toBe(10);
    const grid = buildCapacity({ items: [item], timeOff: [], people: [], days: week, mode: "day" });
    expect(grid.rows.map((r) => [r.person.displayName, r.cells[0].load])).toEqual([
      ["Ana Engineer", 2],
      ["Bob Builder", 2],
    ]);
  });

  it("follow each person's own time off", () => {
    const item = task({ id: 1, assignees: [ANA, BOB], estimatedHours: 20 });
    const grid = buildCapacity({
      items: [item],
      timeOff: [off({ id: 1, person: BOB, endDate: d(addDays(MON, 3)) })], // Bob off Mon–Thu
      people: [],
      days: week,
      mode: "day",
    });
    expect(grid.rows[0].cells[0].load).toBe(2); // Ana: 10h over five days
    expect(grid.rows[1].cells[4].load).toBe(10); // Bob: his 10h on Friday
  });

  it("swap the dragged row's person for the new one, keeping the rest", () => {
    const CY: Person = { displayName: "Cy", email: "cy@example.com" };
    expect(reassigned([ANA, BOB], ANA, CY)).toEqual([BOB, CY]);
    expect(reassigned([ANA, BOB], ANA, BOB)).toEqual([BOB]); // already on it
    expect(reassigned([ANA], ANA, ANA)).toEqual([ANA]);
  });

  it("compare as a set, so reordering isn't a change", () => {
    expect(samePeople([ANA, BOB], [BOB, ANA])).toBe(true);
    expect(samePeople([ANA], [ANA, BOB])).toBe(false);
    const saved = task({ id: 1, assignees: [ANA, BOB] });
    expect(mergeChange(saved, undefined, { assignees: [BOB, ANA] })).toBeNull();
  });

  it("read back a plan kept before several assignees, which stored one", () => {
    const raw = JSON.stringify({ savedAt: 1, changes: { "1": { assignee: BOB } } });
    expect(parsePlan(raw, 2).get("1")?.assignees).toEqual([BOB]);
  });
});

describe("only the listed people get a row", () => {
  const week = daysBetween(MON, addDays(MON, 6));

  it("sends work with nobody on the grid to the backlog, saying why", () => {
    const grid = buildCapacity({
      items: [task({ id: 1, assignees: [BOB] }), task({ id: 2 })],
      timeOff: [],
      people: [ANA],
      days: week,
      mode: "day",
      onlyPeople: true,
      notOnGridReason: (who) => `${who.map((p) => p.displayName).join(", ")} isn't an engineer`,
    });
    expect(grid.rows.map((r) => r.person.displayName)).toEqual(["Ana Engineer"]);
    expect(grid.backlog).toEqual([{ item: expect.objectContaining({ id: "1" }), reason: "Bob Builder isn't an engineer" }]);
  });

  it("still places a shared item on the listed person's row, at their share", () => {
    const grid = buildCapacity({
      items: [task({ id: 1, assignees: [ANA, BOB], estimatedHours: 20 })],
      timeOff: [],
      people: [ANA],
      days: week,
      mode: "day",
      onlyPeople: true,
    });
    expect(grid.rows).toHaveLength(1);
    expect(grid.rows[0].cells[0].load).toBe(2);
    expect(grid.backlog).toEqual([]);
  });
});

describe("company holidays", () => {
  it("apply to everyone, whoever the entry names", () => {
    const holiday = off({ id: 1, person: null, everyone: true });
    expect(timeOffFor([holiday], ANA)).toEqual([holiday]);
    expect(timeOffFor([holiday, off({ id: 2, person: BOB })], ANA)).toEqual([holiday]);
    const grid = buildCapacity({
      items: [task({ id: 1, assignees: [BOB] })],
      timeOff: [holiday],
      people: [ANA],
      days: daysBetween(MON, addDays(MON, 6)),
      mode: "day",
    });
    expect(grid.rows.every((r) => r.cells[0].allOff)).toBe(true);
  });
});

describe("an adjustable amber threshold", () => {
  it("turns amber above the share it's given", () => {
    expect(capacityLevel(7, 8)).toBe("amber"); // 87.5% > the default 85%
    expect(capacityLevel(7, 8, 0.9)).toBe("ok");
    const grid = buildCapacity({
      items: [task({ id: 1, estimatedHours: 35 })], // 7h a day
      timeOff: [],
      people: [],
      days: daysBetween(MON, addDays(MON, 6)),
      mode: "day",
      amberRatio: 0.9,
    });
    expect(grid.rows[0].cells[0].level).toBe("ok");
  });
});

