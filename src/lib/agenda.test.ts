// Pinned to a US zone BEFORE any Date below is built: the local-not-UTC day
// rule only shows where the two disagree, and at UTC the late-evening case
// would pass with the bug in place. No @types/node here — reach process.env
// the way dateInput.writtenDate.test.ts does. Restored after the file.
const env = (globalThis as unknown as {
  process: { env: Record<string, string | undefined> };
}).process.env;
const previousTz = env.TZ;
env.TZ = "America/New_York";

import { describe, it, expect, afterAll } from "vitest";
import type { Eir, Person } from "@/types/task";
import { makeTask } from "@/test/taskFixtures";
import {
  agendaAttentionCount,
  agendaDayLabel,
  buildAgenda,
  DEFAULT_AGENDA_DAYS,
  groupAgenda,
  parseAgendaDays,
  type AgendaOptions,
} from "./agenda";

afterAll(() => {
  env.TZ = previousTz;
});

const ME: Person = { displayName: "Tim Webster", email: "tim.webster@altronic-llc.com" };
const OTHER: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };

/** Local date-time on Oct 2026 — `day` 13 is "today" throughout. */
const oct = (day: number, hour = 9) => new Date(2026, 9, day, hour);
const NOW = oct(13, 10);

function opts(over: Partial<AgendaOptions> = {}): AgendaOptions {
  return {
    emails: ["tim.webster@altronic-llc.com"],
    days: 14,
    includeWatching: false,
    now: NOW,
    ...over,
  };
}

function makeEir(id: number, over: Partial<Eir> = {}): Eir {
  return {
    id,
    eirNo: `EIR_2026-${String(id).padStart(4, "0")}`,
    title: `EIR ${id}`,
    status: "Under Review",
    resolution: "Pending",
    parentProjects: [],
    assignedEngineers: [],
    watchers: [],
    requestedCompletionDate: null,
    ltbDate: null,
    ...over,
  } as unknown as Eir;
}

describe("buildAgenda — who it's for", () => {
  it("includes a task assigned to me and leaves out one assigned to somebody else", () => {
    const items = buildAgenda(
      [
        makeTask(1, { assigned: [ME], dueDate: oct(15) }),
        makeTask(2, { assigned: [OTHER], dueDate: oct(15) }),
      ],
      [],
      opts(),
    );
    expect(items.map((i) => i.key)).toEqual(["task:1"]);
  });

  it("matches ANY of my addresses, not just the primary one", () => {
    const items = buildAgenda(
      [makeTask(1, { assigned: [{ displayName: "Me", email: "Tim.Webster@altronic-llc.com" }], dueDate: oct(15) })],
      [],
      opts({ emails: ["twebster@cmsg.energy", "tim.webster@altronic-llc.com"] }),
    );
    expect(items).toHaveLength(1);
  });

  it("includes watched items only when asked, and marks them as watching", () => {
    const tasks = [makeTask(1, { assigned: [OTHER], watchers: [ME], dueDate: oct(15) })];
    expect(buildAgenda(tasks, [], opts())).toHaveLength(0);
    const items = buildAgenda(tasks, [], opts({ includeWatching: true }));
    expect(items).toHaveLength(1);
    expect(items[0].watchingOnly).toBe(true);
  });

  it("an item I'm assigned to and also watch is NOT marked watching-only", () => {
    const items = buildAgenda(
      [makeTask(1, { assigned: [ME], watchers: [ME], dueDate: oct(15) })],
      [],
      opts({ includeWatching: true }),
    );
    expect(items[0].watchingOnly).toBe(false);
  });

  it("returns nothing while the signed-in addresses are unknown", () => {
    const items = buildAgenda([makeTask(1, { assigned: [ME], dueDate: oct(15) })], [], opts({ emails: [] }));
    expect(items).toEqual([]);
  });

  it("an EIR counts through its ASSIGNED ENGINEERS", () => {
    const items = buildAgenda(
      [],
      [
        makeEir(1, { assignedEngineers: [ME], requestedCompletionDate: oct(16) }),
        makeEir(2, { assignedEngineers: [OTHER], requestedCompletionDate: oct(16) }),
      ],
      opts(),
    );
    expect(items.map((i) => i.key)).toEqual(["eir:1"]);
    expect(items[0].dateLabel).toBe("Requested completion");
    expect(items[0].path).toBe("/eir/1");
  });
});

describe("buildAgenda — what's left out", () => {
  it("leaves out a Complete task and an undated one", () => {
    const items = buildAgenda(
      [
        makeTask(1, { assigned: [ME], dueDate: oct(15), status: "Complete" }),
        makeTask(2, { assigned: [ME], dueDate: null }),
      ],
      [],
      opts(),
    );
    expect(items).toEqual([]);
  });

  it("leaves out EIRs with nothing left for the engineer, keeps Response Not Accepted", () => {
    const eir = (id: number, status: Eir["status"]) =>
      makeEir(id, { status, assignedEngineers: [ME], requestedCompletionDate: oct(10) });
    const items = buildAgenda(
      [],
      [
        eir(1, "Closed"),
        eir(2, "EIR Not Accepted"),
        eir(3, "Response Accepted"),
        eir(4, "Response Not Accepted"),
        eir(5, "Under Review"),
      ],
      opts(),
    );
    expect(items.map((i) => i.id).sort()).toEqual([4, 5]);
  });

  it("does NOT use an EIR's LTB date", () => {
    const items = buildAgenda(
      [],
      [makeEir(1, { assignedEngineers: [ME], ltbDate: oct(15), requestedCompletionDate: null })],
      opts(),
    );
    expect(items).toEqual([]);
  });
});

describe("buildAgenda — the window", () => {
  it("keeps overdue items however old they are", () => {
    const items = buildAgenda(
      [makeTask(1, { assigned: [ME], dueDate: new Date(2024, 4, 31) })],
      [],
      opts(),
    );
    expect(items).toHaveLength(1);
    expect(items[0].overdue).toBe(true);
  });

  it("includes the last day of the window and stops after it", () => {
    const tasks = [
      makeTask(1, { assigned: [ME], dueDate: oct(20, 23) }), // today + 7, late evening
      makeTask(2, { assigned: [ME], dueDate: oct(21, 0) }), // today + 8, first minute
    ];
    expect(buildAgenda(tasks, [], opts({ days: 7 })).map((i) => i.id)).toEqual([1]);
  });

  it("an item due LATER TODAY isn't overdue, and one due earlier today isn't either", () => {
    const items = buildAgenda(
      [
        makeTask(1, { assigned: [ME], dueDate: oct(13, 0) }),
        makeTask(2, { assigned: [ME], dueDate: oct(13, 23) }),
      ],
      [],
      opts(),
    );
    expect(items.every((i) => !i.overdue)).toBe(true);
    expect(items.every((i) => i.dayKey === "2026-10-13")).toBe(true);
  });

  it("files a late-evening due date under its LOCAL day, not the UTC one", () => {
    // 23:00 New York on the 14th is 03:00 UTC on the 15th.
    const items = buildAgenda([makeTask(1, { assigned: [ME], dueDate: oct(14, 23) })], [], opts());
    expect(items[0].dayKey).toBe("2026-10-14");
  });

  it("sorts soonest first", () => {
    const items = buildAgenda(
      [
        makeTask(1, { assigned: [ME], dueDate: oct(18) }),
        makeTask(2, { assigned: [ME], dueDate: oct(2) }),
      ],
      [makeEir(3, { assignedEngineers: [ME], requestedCompletionDate: oct(14) })],
      opts(),
    );
    expect(items.map((i) => i.key)).toEqual(["task:2", "eir:3", "task:1"]);
  });
});

describe("groupAgenda", () => {
  it("puts every overdue item in ONE group first, then a group per day", () => {
    const items = buildAgenda(
      [
        makeTask(1, { assigned: [ME], dueDate: oct(1) }),
        makeTask(2, { assigned: [ME], dueDate: oct(9) }),
        makeTask(3, { assigned: [ME], dueDate: oct(13, 15) }),
        makeTask(4, { assigned: [ME], dueDate: oct(14) }),
        makeTask(5, { assigned: [ME], dueDate: oct(14, 16) }),
      ],
      [],
      opts(),
    );
    const groups = groupAgenda(items, NOW);
    expect(groups.map((g) => g.label)).toEqual(["Overdue", "Today", "Tomorrow"]);
    expect(groups[0].items.map((i) => i.id)).toEqual([1, 2]);
    expect(groups[2].items.map((i) => i.id)).toEqual([4, 5]);
  });

  it("returns no groups for an empty agenda", () => {
    expect(groupAgenda([], NOW)).toEqual([]);
  });
});

describe("agendaDayLabel", () => {
  it("names today and tomorrow, and dates anything later", () => {
    expect(agendaDayLabel("2026-10-13", NOW)).toBe("Today");
    expect(agendaDayLabel("2026-10-14", NOW)).toBe("Tomorrow");
    expect(agendaDayLabel("2026-10-16", NOW)).toMatch(/Oct/);
  });
});

describe("parseAgendaDays", () => {
  it("accepts the offered choices and defaults anything else", () => {
    expect(parseAgendaDays("30")).toBe(30);
    expect(parseAgendaDays("90")).toBe(90);
    expect(parseAgendaDays("13")).toBe(DEFAULT_AGENDA_DAYS);
    expect(parseAgendaDays("")).toBe(DEFAULT_AGENDA_DAYS);
    expect(parseAgendaDays(null)).toBe(DEFAULT_AGENDA_DAYS);
  });
});

describe("agendaAttentionCount", () => {
  it("counts overdue + due today, assigned only — not tomorrow, not watching", () => {
    const tasks = [
      makeTask(1, { assigned: [ME], dueDate: oct(1) }), // overdue
      makeTask(2, { assigned: [ME], dueDate: oct(13, 20) }), // today
      makeTask(3, { assigned: [ME], dueDate: oct(14) }), // tomorrow
      makeTask(4, { assigned: [OTHER], watchers: [ME], dueDate: oct(1) }), // watching
    ];
    const eirs = [makeEir(5, { assignedEngineers: [ME], requestedCompletionDate: oct(12) })];
    expect(agendaAttentionCount(tasks, eirs, ME.email ? [ME.email] : [], NOW)).toBe(3);
  });
});
