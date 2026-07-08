import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import {
  buildAssigneeChangeEmails,
  buildFieldChangeEmails,
  buildPromotionEmails,
} from "./changeAlerts";

const ACTOR: Person = { displayName: "Ray White", email: "ray@x.com", lookupId: 1 };
const BOB: Person = { displayName: "Bob", email: "bob@x.com", lookupId: 2 };
const JOHN: Person = { displayName: "John", email: "john@x.com", lookupId: 3 };
const SARAH: Person = { displayName: "Sarah", email: "sarah@x.com", lookupId: 4 };
const NO_EMAIL: Person = { displayName: "Ghost", lookupId: 5 };

const TASK = { kind: "task" as const, id: 115, title: "T115-Coil" };
const EIR = { kind: "eir" as const, id: 42, title: "EIR_2026-0042 — Coil" };

describe("buildFieldChangeEmails", () => {
  it("returns [] when the value didn't change", () => {
    const out = buildFieldChangeEmails({
      target: TASK,
      fieldLabel: "status",
      from: "In Progress",
      to: "In Progress",
      actor: ACTOR,
      watchers: [BOB],
      assignees: [],
    });
    expect(out).toEqual([]);
  });

  it("notifies watchers + assignees, excludes the actor, dedupes by email", () => {
    const out = buildFieldChangeEmails({
      target: TASK,
      fieldLabel: "status",
      from: "In Progress",
      to: "Complete",
      actor: ACTOR,
      watchers: [BOB, ACTOR], // actor is also a watcher — must be dropped
      assignees: [BOB, JOHN], // BOB duplicated across watchers + assignees
    });
    const emails = out.map((e) => e.email).sort();
    expect(emails).toEqual(["bob@x.com", "john@x.com"]);
    expect(out[0].subject).toBe("Status changed on T115-Coil");
    expect(out[0].headlineHtml).toContain("Ray White");
    expect(out[0].detailHtml).toContain("Complete");
  });

  it("includes the EIR reporter and skips people without an email", () => {
    const out = buildFieldChangeEmails({
      target: EIR,
      fieldLabel: "resolution",
      from: "Pending",
      to: "Resolved",
      actor: ACTOR,
      watchers: [NO_EMAIL],
      assignees: [],
      reporter: SARAH,
    });
    expect(out.map((e) => e.email)).toEqual(["sarah@x.com"]);
    expect(out[0].subject).toBe("Resolution changed on EIR_2026-0042 — Coil");
  });
});

describe("buildAssigneeChangeEmails", () => {
  it("returns [] when the assignee set is unchanged", () => {
    const out = buildAssigneeChangeEmails({
      target: TASK,
      prev: [BOB],
      next: [BOB],
      actor: ACTOR,
      watchers: [SARAH],
    });
    expect(out).toEqual([]);
  });

  it("sends personal added/removed notes and a broadcast to others", () => {
    // John -> Bob, with Sarah watching.
    const out = buildAssigneeChangeEmails({
      target: TASK,
      prev: [JOHN],
      next: [BOB],
      actor: ACTOR,
      watchers: [SARAH],
    });
    const byEmail = Object.fromEntries(out.map((e) => [e.email, e]));

    expect(byEmail["bob@x.com"].subject).toBe("You've been assigned to T115-Coil");
    expect(byEmail["john@x.com"].subject).toBe("You've been unassigned from T115-Coil");
    // Sarah gets the broadcast, not a personal note.
    expect(byEmail["sarah@x.com"].subject).toBe("Assignees changed on T115-Coil");
    expect(byEmail["sarah@x.com"].detailHtml).toContain("added");
    expect(byEmail["sarah@x.com"].detailHtml).toContain("Bob");
    expect(byEmail["sarah@x.com"].detailHtml).toContain("removed");
    // Bob/John are not double-sent the broadcast.
    expect(out.filter((e) => e.email === "bob@x.com")).toHaveLength(1);
  });

  it("excludes the actor even when they added themselves", () => {
    const out = buildAssigneeChangeEmails({
      target: TASK,
      prev: [],
      next: [ACTOR],
      actor: ACTOR,
      watchers: [],
    });
    expect(out).toEqual([]);
  });

  it("does not send the broadcast when only the actor would receive it", () => {
    // Actor assigns Bob; the only other 'recipient' is the actor (watcher).
    const out = buildAssigneeChangeEmails({
      target: TASK,
      prev: [],
      next: [BOB],
      actor: ACTOR,
      watchers: [ACTOR],
    });
    expect(out.map((e) => e.email)).toEqual(["bob@x.com"]);
    expect(out[0].subject).toBe("You've been assigned to T115-Coil");
  });

  it("includes the EIR reporter in the broadcast", () => {
    const out = buildAssigneeChangeEmails({
      target: EIR,
      prev: [],
      next: [BOB],
      actor: ACTOR,
      watchers: [],
      reporter: SARAH,
    });
    const byEmail = Object.fromEntries(out.map((e) => [e.email, e]));
    expect(byEmail["bob@x.com"].subject).toBe("You've been assigned to EIR_2026-0042 — Coil");
    expect(byEmail["sarah@x.com"].subject).toBe("Assignees changed on EIR_2026-0042 — Coil");
  });
});

describe("buildPromotionEmails", () => {
  it("notifies watchers + reporter, excludes the actor, dedupes", () => {
    const out = buildPromotionEmails({
      eirLabel: "EIR_2026-0042",
      watchers: [BOB, SARAH, ACTOR], // actor watching → dropped
      reporter: SARAH, // also a watcher → deduped
      actor: ACTOR,
    });
    const emails = out.map((e) => e.email).sort();
    expect(emails).toEqual(["bob@x.com", "sarah@x.com"]);
    expect(out[0].subject).toBe("EIR_2026-0042 was promoted to a task");
    expect(out[0].headlineHtml).toContain("promoted EIR");
    expect(out[0].headlineHtml).toContain("EIR_2026-0042");
  });

  it("returns [] when only the actor would be notified", () => {
    const out = buildPromotionEmails({
      eirLabel: "EIR_2026-0042",
      watchers: [ACTOR],
      reporter: ACTOR,
      actor: ACTOR,
    });
    expect(out).toEqual([]);
  });
});
