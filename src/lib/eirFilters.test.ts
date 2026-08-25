import { describe, it, expect } from "vitest";
import {
  EMPTY_EIR_FILTERS,
  applyEirFilters,
  applyEirStatusFilter,
  collectEirPeople,
  countEirsByStatus,
  effectiveEirStatusFilter,
  eirViewIgnoresStatus,
  isOpenEir,
  matchesEirView,
  sortEirsForView,
} from "./eirFilters";
import type { Eir } from "@/types/task";

// matchesEirView only reads parentProjects + assignedEngineers, so build a
// minimal EIR with just those two arrays sized as needed.
function eir(projectCount: number, engineerCount: number): Eir {
  return {
    parentProjects: Array.from({ length: projectCount }, (_, i) => ({
      lookupId: i + 1,
      title: `P${i + 1}`,
    })),
    assignedEngineers: Array.from({ length: engineerCount }, (_, i) => ({
      displayName: `Eng ${i + 1}`,
    })),
  } as unknown as Eir;
}

/** A fuller EIR for the filter / sort / count helpers. */
function makeEir(over: Partial<Eir> = {}): Eir {
  return {
    id: 1,
    eirNo: "EIR_2026-0001",
    title: "Replace obsolete relay",
    status: "Under Review",
    resolution: "Pending",
    parentProjects: [],
    assignedEngineers: [],
    watchers: [],
    reporter: null,
    comments: [],
    createdAt: new Date("2026-01-01"),
    ltbDate: null,
    riskPart: null,
    ...over,
  } as unknown as Eir;
}

describe("matchesEirView", () => {
  it("New = no project AND no engineer", () => {
    expect(matchesEirView(eir(0, 0), "new")).toBe(true);
    expect(matchesEirView(eir(1, 0), "new")).toBe(false); // has a project
    expect(matchesEirView(eir(0, 1), "new")).toBe(false); // has an engineer
    expect(matchesEirView(eir(2, 2), "new")).toBe(false);
  });

  it("Needs Assigned = has a project but no engineer", () => {
    expect(matchesEirView(eir(1, 0), "needs-assigned")).toBe(true);
    expect(matchesEirView(eir(3, 0), "needs-assigned")).toBe(true);
    expect(matchesEirView(eir(0, 0), "needs-assigned")).toBe(false); // no project
    expect(matchesEirView(eir(1, 1), "needs-assigned")).toBe(false); // already assigned
  });

  it("All matches everything", () => {
    expect(matchesEirView(eir(0, 0), "all")).toBe(true);
    expect(matchesEirView(eir(1, 0), "all")).toBe(true);
    expect(matchesEirView(eir(2, 3), "all")).toBe(true);
  });

  it("At Risk Parts = RiskPart is Active", () => {
    const withRisk = (riskPart: string | null) =>
      ({ parentProjects: [], assignedEngineers: [], riskPart }) as unknown as Eir;
    expect(matchesEirView(withRisk("Active"), "at-risk")).toBe(true);
    expect(matchesEirView(withRisk("InActive"), "at-risk")).toBe(false);
    expect(matchesEirView(withRisk(null), "at-risk")).toBe(false);
  });

  it("LTB = an LTB date is set", () => {
    const withLtb = (ltbDate: Date | null) =>
      ({ parentProjects: [], assignedEngineers: [], ltbDate }) as unknown as Eir;
    expect(matchesEirView(withLtb(new Date("2026-09-30")), "ltb")).toBe(true);
    expect(matchesEirView(withLtb(null), "ltb")).toBe(false);
  });
});

describe("isOpenEir", () => {
  it("everything except Closed is open", () => {
    expect(isOpenEir("Under Review")).toBe(true);
    expect(isOpenEir("Response Accepted")).toBe(true);
    expect(isOpenEir("Closed")).toBe(false);
  });
});

describe("applyEirFilters", () => {
  const a = makeEir({
    id: 1,
    title: "Coil bracket obsolete",
    parentProjects: [{ lookupId: 10, title: "P10" }],
    reporter: { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
    assignedEngineers: [{ displayName: "Sarah Shaffer", email: "sarah@altronic-llc.com" }],
  } as Partial<Eir>);
  const b = makeEir({
    id: 2,
    title: "Relay end of life",
    parentProjects: [{ lookupId: 20, title: "P20" }],
    reporter: { displayName: "Adele Riffle", email: "adele@altronic-llc.com" },
    assignedEngineers: [],
  } as Partial<Eir>);

  it("returns everything when no filters are set", () => {
    expect(applyEirFilters([a, b], EMPTY_EIR_FILTERS)).toEqual([a, b]);
  });

  it("matches a project when ANY of the EIR's projects is selected", () => {
    const out = applyEirFilters([a, b], { ...EMPTY_EIR_FILTERS, projectIds: [20] });
    expect(out.map((e) => e.id)).toEqual([2]);
  });

  it("filters by reporter email, case-insensitively", () => {
    const out = applyEirFilters([a, b], {
      ...EMPTY_EIR_FILTERS,
      reporterEmail: "RAY.WHITE@altronic-llc.com",
    });
    expect(out.map((e) => e.id)).toEqual([1]);
  });

  it("filters by assigned engineer", () => {
    const out = applyEirFilters([a, b], {
      ...EMPTY_EIR_FILTERS,
      engineerEmails: ["sarah@altronic-llc.com"],
    });
    expect(out.map((e) => e.id)).toEqual([1]);
  });

  it("searches across fields, AND-ing multiple words", () => {
    expect(applyEirFilters([a, b], { ...EMPTY_EIR_FILTERS, search: "coil" }).map((e) => e.id))
      .toEqual([1]);
    expect(
      applyEirFilters([a, b], { ...EMPTY_EIR_FILTERS, search: "coil relay" }),
    ).toEqual([]);
  });
});

describe("applyEirStatusFilter", () => {
  const open = makeEir({ id: 1, status: "Under Review" });
  const accepted = makeEir({ id: 2, status: "Response Accepted" });
  const closed = makeEir({ id: 3, status: "Closed" });

  it("null keeps everything", () => {
    expect(applyEirStatusFilter([open, accepted, closed], null)).toHaveLength(3);
  });

  it("ALL_OPEN drops Closed", () => {
    expect(
      applyEirStatusFilter([open, accepted, closed], "ALL_OPEN").map((e) => e.id),
    ).toEqual([1, 2]);
  });

  it("a specific status keeps only that status", () => {
    expect(
      applyEirStatusFilter([open, accepted, closed], "Closed").map((e) => e.id),
    ).toEqual([3]);
  });
});

describe("sortEirsForView", () => {
  const older = makeEir({ id: 1, createdAt: new Date("2026-01-01") });
  const newer = makeEir({ id: 2, createdAt: new Date("2026-06-01") });

  it("sorts newest first by default", () => {
    expect(sortEirsForView([older, newer], "all").map((e) => e.id)).toEqual([2, 1]);
  });

  it("sorts the LTB view soonest-first, with no date last", () => {
    const soon = makeEir({ id: 3, ltbDate: new Date("2026-02-01") });
    const later = makeEir({ id: 4, ltbDate: new Date("2026-12-01") });
    const none = makeEir({ id: 5, ltbDate: null });
    expect(sortEirsForView([later, none, soon], "ltb").map((e) => e.id)).toEqual([3, 4, 5]);
  });

  it("does not mutate the input array", () => {
    const input = [older, newer];
    sortEirsForView(input, "all");
    expect(input.map((e) => e.id)).toEqual([1, 2]);
  });
});

describe("countEirsByStatus", () => {
  it("counts each status and zeroes the rest", () => {
    const counts = countEirsByStatus([
      makeEir({ status: "Under Review" }),
      makeEir({ status: "Under Review" }),
      makeEir({ status: "Closed" }),
    ]);
    expect(counts["Under Review"]).toBe(2);
    expect(counts.Closed).toBe(1);
    expect(counts["Response Accepted"]).toBe(0);
  });
});

describe("collectEirPeople", () => {
  it("merges reporter, engineers and watchers, deduped by email and name-sorted", () => {
    const people = collectEirPeople([
      makeEir({
        reporter: { displayName: "Ray White", email: "ray@a.com" },
        assignedEngineers: [{ displayName: "Adele Riffle", email: "adele@a.com" }],
        watchers: [{ displayName: "Ray White", email: "RAY@a.com" }],
      } as Partial<Eir>),
    ]);
    expect(people.map((p) => p.displayName)).toEqual(["Adele Riffle", "Ray White"]);
  });
});

describe("views that ignore the status pill", () => {
  // At Risk Parts mirrors SharePoint's At Risk View: a register of every part
  // flagged Active, whatever its EIR's status. Narrowing it by status hid rows
  // the screen exists to show (Ray, 2026-08-25).
  it("exempts At Risk Parts", () => {
    expect(eirViewIgnoresStatus("at-risk")).toBe(true);
  });

  // Pinned one tab at a time, so the exemption can't quietly spread to the
  // work queues, where the pill is exactly right.
  it.each(["all", "new", "needs-assigned", "ltb"] as const)("does not exempt %s", (view) => {
    expect(eirViewIgnoresStatus(view)).toBe(false);
  });
});

describe("effectiveEirStatusFilter", () => {
  it("drops a status pill on the at-risk view", () => {
    expect(effectiveEirStatusFilter("at-risk", "Closed")).toBeNull();
    expect(effectiveEirStatusFilter("at-risk", "ALL_OPEN")).toBeNull();
    expect(effectiveEirStatusFilter("at-risk", "Under Review")).toBeNull();
  });

  it.each(["all", "new", "needs-assigned", "ltb"] as const)(
    "keeps it on %s",
    (view) => {
      expect(effectiveEirStatusFilter(view, "Closed")).toBe("Closed");
      expect(effectiveEirStatusFilter(view, "ALL_OPEN")).toBe("ALL_OPEN");
    },
  );

  // The regression that matters: a bookmark, or a pill left set on another tab,
  // carrying ?view=at-risk&status=ALL_OPEN would otherwise hide every CLOSED
  // at-risk part.
  it("shows a closed at-risk EIR that a status pill would have hidden", () => {
    const closedAtRisk = makeEir({ status: "Closed", riskPart: "Active" });
    const openAtRisk = makeEir({ status: "Under Review", riskPart: "Active" });
    const both = [closedAtRisk, openAtRisk].filter((e) => matchesEirView(e, "at-risk"));
    expect(both).toHaveLength(2);

    const shown = applyEirStatusFilter(both, effectiveEirStatusFilter("at-risk", "ALL_OPEN"));
    expect(shown).toHaveLength(2);

    // Same pill on any other view still narrows, so this isn't a blanket
    // disabling of the feature.
    const onAll = applyEirStatusFilter(both, effectiveEirStatusFilter("all", "ALL_OPEN"));
    expect(onAll).toHaveLength(1);
  });
});
