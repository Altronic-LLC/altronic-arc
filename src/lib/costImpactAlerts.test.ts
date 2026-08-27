import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import { buildNewCostImpactNoticeEmails } from "./costImpactAlerts";

// =============================================================================
// The intake alert. Nothing watches the Cost Impact Portal list, so every
// create tells the configured list a part's cost has changed (Ray, 2026-08-27).
// =============================================================================

const KEITH: Person = { displayName: "Keith Brooks", email: "Keith.Brooks@altronic-llc.com" };
const RAY: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };
const DAVID: Person = { displayName: "David Bell", email: "David.Bell@altronic-llc.com" };
const SHEILA: Person = { displayName: "Sheila Horn", email: "sheila.horn@altronic-llc.com" };

const TARGET = { kind: "costImpactNotice" as const, id: 4, title: "DATA LOGGING MODULE" };

// The actor (Sheila) isn't on the intake list, so the "everyone" case doesn't
// also have to prove the actor-exclusion rule — that's its own describe block.
function build(overrides: Partial<Parameters<typeof buildNewCostImpactNoticeEmails>[0]> = {}) {
  return buildNewCostImpactNoticeEmails({
    target: TARGET,
    recipients: [KEITH, RAY, DAVID],
    actor: SHEILA,
    ...overrides,
  });
}

describe("the new-notice email", () => {
  it("goes to everyone on the intake list", () => {
    expect(build().map((e) => e.email)).toEqual([KEITH.email, RAY.email, DAVID.email]);
  });

  it("names the notice in the subject, so it reads in a full inbox", () => {
    expect(build()[0].subject).toBe("Cost impact notice: DATA LOGGING MODULE");
  });

  it("says who raised it", () => {
    const html = build({ actor: DAVID })[0].headlineHtml;
    expect(html).toContain("David Bell");
    expect(html).toContain("cost has changed");
  });

  it("is empty when nobody is configured", () => {
    expect(build({ recipients: [] })).toEqual([]);
  });

  it("skips anyone without an address", () => {
    const emails = build({ recipients: [{ displayName: "No Mailbox" }, KEITH] });
    expect(emails.map((e) => e.email)).toEqual([KEITH.email]);
  });
});

describe("who is left off", () => {
  it("doesn't email the person who raised it", () => {
    const emails = build({ actor: KEITH });
    expect(emails.map((e) => e.email)).toEqual([RAY.email, DAVID.email]);
  });

  // A queue that goes silent because its only member raised the notice is
  // worse than one redundant email.
  it("emails the actor rather than nobody", () => {
    const emails = build({ recipients: [KEITH], actor: KEITH });
    expect(emails.map((e) => e.email)).toEqual([KEITH.email]);
  });
});

describe("what the email carries", () => {
  it("lists the cost figures that are known", () => {
    const html = build({
      details: [
        { label: "Original Cost", value: "604.50" },
        { label: "New Cost", value: "1026.35" },
      ],
    })[0].detailHtml!;
    expect(html).toContain("Original Cost: <strong>604.50</strong>");
    expect(html).toContain("New Cost: <strong>1026.35</strong>");
  });

  it("drops the blanks rather than printing a grid of dashes", () => {
    const html = build({
      details: [
        { label: "Supplier", value: "" },
        { label: "SAP Number", value: "1000-5110-00" },
      ],
    })[0].detailHtml!;
    expect(html).not.toContain("Supplier:");
    expect(html).toContain("SAP Number: <strong>1000-5110-00</strong>");
  });
});
