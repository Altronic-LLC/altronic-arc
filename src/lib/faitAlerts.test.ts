import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import { buildNewFaitEmails } from "./faitAlerts";

// =============================================================================
// The intake alert. Nothing watches the FAIT list, so every create tells the
// configured list a new First Article Inspection Test needs picking up
// (Ray, 2026-08-26) — same shape as Gray Market's.
// =============================================================================

const JERROD: Person = { displayName: "Jerrod Waldron", email: "Jerrod.Waldron@altronic-llc.com" };
const ALEX: Person = { displayName: "Alexandra Russell", email: "Alexandra.Russell@altronic-llc.com" };
const KATIE: Person = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com" };
const RAY: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };

const TARGET = { kind: "fait" as const, id: 12, title: "691768-1" };

function build(overrides: Partial<Parameters<typeof buildNewFaitEmails>[0]> = {}) {
  return buildNewFaitEmails({
    target: TARGET,
    recipients: [JERROD, ALEX, KATIE],
    actor: RAY,
    ...overrides,
  });
}

describe("the new-FAIT email", () => {
  it("goes to everyone on the intake list", () => {
    expect(build().map((e) => e.email)).toEqual([JERROD.email, ALEX.email, KATIE.email]);
  });

  it("names the FAIT in the subject, so it reads in a full inbox", () => {
    expect(build()[0].subject).toBe("New FAIT: 691768-1");
  });

  it("says who raised it and asks for it to be picked up", () => {
    const html = build()[0].headlineHtml;
    expect(html).toContain("Ray White");
    expect(html).toContain("Please pick it up");
  });

  it("is empty when nobody is configured", () => {
    expect(build({ recipients: [] })).toEqual([]);
  });

  it("skips anyone without an address", () => {
    const emails = build({ recipients: [{ displayName: "No Mailbox" }, JERROD] });
    expect(emails.map((e) => e.email)).toEqual([JERROD.email]);
  });
});

describe("who is left off", () => {
  it("doesn't email the person who raised it", () => {
    const emails = build({ actor: JERROD });
    expect(emails.map((e) => e.email)).toEqual([ALEX.email, KATIE.email]);
  });

  // A queue that goes silent because its only member raised the FAIT is
  // worse than one redundant email.
  it("emails the actor rather than nobody", () => {
    const emails = build({ recipients: [JERROD], actor: JERROD });
    expect(emails.map((e) => e.email)).toEqual([JERROD.email]);
  });
});

describe("what the email carries", () => {
  it("lists the details that are known", () => {
    const html = build({
      details: [
        { label: "SAP Part Number", value: "691768-1" },
        { label: "Supplier", value: "Wells Manufacturing" },
      ],
    })[0].detailHtml!;
    expect(html).toContain("SAP Part Number: <strong>691768-1</strong>");
    expect(html).toContain("Supplier: <strong>Wells Manufacturing</strong>");
  });

  // A new FAIT only has Part and Request filled in — inspection, results and
  // sign-off come later, by other people — so a blank is left out rather
  // than shown as a dash.
  it("drops the blanks rather than printing a grid of dashes", () => {
    const html = build({
      details: [
        { label: "SAP Part Number", value: "691768-1" },
        { label: "Drawing Number", value: "  " },
      ],
    })[0].detailHtml!;
    expect(html).toContain("SAP Part Number");
    expect(html).not.toContain("Drawing Number:");
  });

  it("trims a padded value", () => {
    const html = build({ details: [{ label: "Supplier", value: "  Wells Manufacturing  " }] })[0]
      .detailHtml!;
    expect(html).toContain("<strong>Wells Manufacturing</strong>");
  });

  it("explains that inspection, results and sign-off come later", () => {
    expect(build()[0].detailHtml).toContain("filled in later");
  });

  // Being on the intake list is not the same as watching the FAIT.
  it("points at Watch for the rest of the thread", () => {
    expect(build()[0].detailHtml).toContain("Watch");
  });

  it("escapes a name and a value rather than trusting them as HTML", () => {
    const emails = build({
      actor: { displayName: "<script>x</script>", email: "x@y.com" },
      details: [{ label: "Supplier", value: "A & <b>B</b>" }],
    });
    expect(emails[0].headlineHtml).not.toContain("<script>");
    expect(emails[0].detailHtml).toContain("A &amp; &lt;b&gt;B&lt;/b&gt;");
  });
});
