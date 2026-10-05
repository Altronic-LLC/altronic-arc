import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import {
  ASSIGNMENT_DESCRIPTION_MAX_CHARS,
  assignmentDescriptionExcerpt,
  buildAssigneeChangeEmails,
  buildChecklistToggleEmails,
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

describe("buildChecklistToggleEmails", () => {
  it("returns [] when nothing toggled", () => {
    const out = buildChecklistToggleEmails({
      target: TASK,
      toggles: [],
      actor: ACTOR,
      watchers: [BOB],
      assignees: [],
    });
    expect(out).toEqual([]);
  });

  it("notifies watchers + assignees minus the actor, wording a single check", () => {
    const out = buildChecklistToggleEmails({
      target: TASK,
      toggles: [{ text: "Buy the part", checked: true }],
      actor: ACTOR,
      watchers: [BOB, ACTOR],
      assignees: [JOHN],
    });
    expect(out.map((e) => e.email).sort()).toEqual(["bob@x.com", "john@x.com"]);
    expect(out[0].subject).toBe("Checklist updated on T115-Coil");
    expect(out[0].headlineHtml).toContain("checked off a checklist item");
    expect(out[0].detailHtml).toContain("✓ Checked");
    expect(out[0].detailHtml).toContain("Buy the part");
  });

  it("words a single uncheck as unchecked", () => {
    const out = buildChecklistToggleEmails({
      target: TASK,
      toggles: [{ text: "Buy the part", checked: false }],
      actor: ACTOR,
      watchers: [BOB],
      assignees: [],
    });
    expect(out[0].headlineHtml).toContain("unchecked a checklist item");
    expect(out[0].detailHtml).toContain("✗ Unchecked");
  });

  it("summarises multiple toggles and lists each one", () => {
    const out = buildChecklistToggleEmails({
      target: EIR,
      toggles: [
        { text: "Step one", checked: true },
        { text: "Step two", checked: false },
      ],
      actor: ACTOR,
      watchers: [],
      assignees: [SARAH],
    });
    expect(out.map((e) => e.email)).toEqual(["sarah@x.com"]);
    expect(out[0].headlineHtml).toContain("updated the checklist on this EIR");
    expect(out[0].detailHtml).toContain("Step one");
    expect(out[0].detailHtml).toContain("Step two");
  });

  it("returns [] when only the actor would be notified", () => {
    const out = buildChecklistToggleEmails({
      target: TASK,
      toggles: [{ text: "x", checked: true }],
      actor: ACTOR,
      watchers: [ACTOR, NO_EMAIL],
      assignees: [],
    });
    expect(out).toEqual([]);
  });
});

describe("buildAssigneeChangeEmails", () => {
  // How the create paths call it (Ray, 2026-08-17): assigning someone as the
  // item is created used to notify nobody. prev: [] and watchers: [] give the
  // new assignee their personal note and nothing else.
  describe("assignment at creation (prev: [], watchers: [])", () => {
    it("tells the new assignee they've been assigned", () => {
      const out = buildAssigneeChangeEmails({
        target: TASK,
        prev: [],
        next: [BOB],
        actor: ACTOR,
        watchers: [],
      });
      expect(out).toHaveLength(1);
      expect(out[0].email).toBe("bob@x.com");
      expect(out[0].subject).toBe("You've been assigned to T115-Coil");
    });

    it("sends no broadcast copy — nobody is following a brand-new item yet", () => {
      const out = buildAssigneeChangeEmails({
        target: TASK,
        prev: [],
        next: [BOB],
        actor: ACTOR,
        watchers: [],
      });
      expect(out.filter((e) => e.subject.startsWith("Assignees changed"))).toEqual([]);
    });

    it("notifies each of several assignees", () => {
      const out = buildAssigneeChangeEmails({
        target: TASK,
        prev: [],
        next: [BOB, JOHN],
        actor: ACTOR,
        watchers: [],
      });
      expect(out.map((e) => e.email).sort()).toEqual(["bob@x.com", "john@x.com"]);
    });

    // Creating a task and assigning it to yourself shouldn't email you.
    it("doesn't email the creator when they assign themselves", () => {
      const out = buildAssigneeChangeEmails({
        target: TASK,
        prev: [],
        next: [ACTOR],
        actor: ACTOR,
        watchers: [],
      });
      expect(out).toEqual([]);
    });

    it("skips an assignee with no email rather than throwing", () => {
      const out = buildAssigneeChangeEmails({
        target: TASK,
        prev: [],
        next: [NO_EMAIL],
        actor: ACTOR,
        watchers: [],
      });
      expect(out).toEqual([]);
    });

    // Every create path that can set an assignee routes through here, so the
    // wording has to hold for each item kind.
    it.each([
      ["operationsTask", 7, "OPS-0007"],
      ["task", 115, "T115-Coil"],
      ["eir", 42, "EIR_2026-0042 — Coil"],
      ["panelTask", 9, "Panel wiring"],
      ["panelOrder", 3, "PO-0003"],
      ["buildRequest", 5, "BR-0005"],
    ] as const)("addresses a new %s assignee correctly", (kind, id, title) => {
      const out = buildAssigneeChangeEmails({
        target: { kind, id, title },
        prev: [],
        next: [BOB],
        actor: ACTOR,
        watchers: [],
      });
      expect(out).toHaveLength(1);
      expect(out[0].email).toBe("bob@x.com");
      expect(out[0].subject).toBe(`You've been assigned to ${title}`);
    });
  });

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

// BusinessIT #5 / #6 (David Markovitch): the assignee should see how urgent
// the work is and what it is without opening the link.
describe("buildAssigneeChangeEmails — assignment details", () => {
  const DUE = new Date(2026, 9, 12); // local midnight, as a picked date is held

  function assign(details?: { dueDate: Date | null; description: string }) {
    return buildAssigneeChangeEmails({
      target: TASK,
      prev: [JOHN],
      next: [BOB],
      actor: ACTOR,
      watchers: [SARAH],
      details,
    });
  }
  const byEmail = (out: ReturnType<typeof assign>) =>
    Object.fromEntries(out.map((e) => [e.email, e]));

  it("puts the due date and description in the assignee's email", () => {
    const bob = byEmail(assign({ dueDate: DUE, description: "Fit the new sensor." }))["bob@x.com"];
    expect(bob.detailHtml).toContain("<strong>Due:</strong> Mon, Oct 12, 2026");
    expect(bob.detailHtml).toContain("Description");
    expect(bob.detailHtml).toContain("Fit the new sensor.");
  });

  it("says there is no due date rather than leaving it out", () => {
    const bob = byEmail(assign({ dueDate: null, description: "" }))["bob@x.com"];
    expect(bob.detailHtml).toContain("No due date");
  });

  it("treats an unreadable date as no due date", () => {
    const bob = byEmail(assign({ dueDate: new Date("nope"), description: "" }))["bob@x.com"];
    expect(bob.detailHtml).toContain("No due date");
  });

  it("drops the Description heading when there is no description", () => {
    const bob = byEmail(assign({ dueDate: DUE, description: "   " }))["bob@x.com"];
    expect(bob.detailHtml).not.toContain("Description");
  });

  it("keeps the details out of the unassigned note and the watcher broadcast", () => {
    const out = byEmail(assign({ dueDate: DUE, description: "Fit the new sensor." }));
    expect(out["john@x.com"].detailHtml).toBeUndefined();
    expect(out["sarah@x.com"].detailHtml).not.toContain("Due:");
    expect(out["sarah@x.com"].detailHtml).not.toContain("Fit the new sensor.");
  });

  it("leaves the assignee's email unchanged when no details are passed", () => {
    expect(byEmail(assign())["bob@x.com"].detailHtml).toBeUndefined();
  });

  it("escapes the description", () => {
    const bob = byEmail(assign({ dueDate: DUE, description: "Vout < 5V & Iout > 2A" }))["bob@x.com"];
    expect(bob.detailHtml).toContain("Vout &lt; 5V &amp; Iout &gt; 2A");
  });

  it("keeps the description's line breaks", () => {
    const bob = byEmail(assign({ dueDate: DUE, description: "Line one\nLine two" }))["bob@x.com"];
    expect(bob.detailHtml).toContain("Line one<br/>Line two");
  });
});

describe("assignmentDescriptionExcerpt", () => {
  it("strips HTML to text", () => {
    expect(assignmentDescriptionExcerpt("<p>Hello <strong>there</strong></p><p>Second</p>")).toBe(
      "Hello there\n\nSecond",
    );
  });

  // A tag strip on plain text would eat everything between a "<" and a ">".
  it("leaves plain text with angle brackets alone", () => {
    expect(assignmentDescriptionExcerpt("Vout < 5V and Iout > 2A")).toBe("Vout < 5V and Iout > 2A");
  });

  it("shows checklist lines as boxes, without their who/when stamps", () => {
    const text = [
      "Steps:",
      "- [x] Order the part ✓[Ray White · 7/17/2026, 10:15 AM]",
      "\t- [ ] Confirm the bracket",
      "- [ ] Bench test",
    ].join("\n");
    expect(assignmentDescriptionExcerpt(text)).toBe(
      ["Steps:", "☑ Order the part", "    ☐ Confirm the bracket", "☐ Bench test"].join("\n"),
    );
  });

  it("returns empty for a blank description", () => {
    expect(assignmentDescriptionExcerpt("")).toBe("");
    expect(assignmentDescriptionExcerpt("<p> </p>")).toBe("");
  });

  it("caps a long description on a word boundary with an ellipsis", () => {
    const long = "word ".repeat(400).trim();
    const out = assignmentDescriptionExcerpt(long);
    expect(out.length).toBeLessThanOrEqual(ASSIGNMENT_DESCRIPTION_MAX_CHARS + 1);
    expect(out.endsWith("word…")).toBe(true);
  });

  it("cuts one enormous word rather than dropping the excerpt", () => {
    const out = assignmentDescriptionExcerpt("x".repeat(1000));
    expect(out).toBe(`${"x".repeat(ASSIGNMENT_DESCRIPTION_MAX_CHARS)}…`);
  });

  it("leaves a description at exactly the cap untouched", () => {
    const exact = "y".repeat(ASSIGNMENT_DESCRIPTION_MAX_CHARS);
    expect(assignmentDescriptionExcerpt(exact)).toBe(exact);
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
