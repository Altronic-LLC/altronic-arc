import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import { buildNewGrayMarketRequestEmails } from "./grayMarketAlerts";

// =============================================================================
// The intake alert. Nothing watches the Gray Market list, so every create
// tells the configured list a request needs picking up (Ray, 2026-08-23).
// =============================================================================

const KATIE: Person = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com" };
const ALEX: Person = { displayName: "Alexandra Russell", email: "Alexandra.Russell@altronic-llc.com" };
const GLENN: Person = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };
const RAY: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };

const TARGET = { kind: "grayMarketRequest" as const, id: 12, title: "GMR_2026-004" };

function build(overrides: Partial<Parameters<typeof buildNewGrayMarketRequestEmails>[0]> = {}) {
  return buildNewGrayMarketRequestEmails({
    target: TARGET,
    recipients: [KATIE, ALEX, GLENN],
    actor: RAY,
    ...overrides,
  });
}

describe("the new-request email", () => {
  it("goes to everyone on the intake list", () => {
    expect(build().map((e) => e.email)).toEqual([KATIE.email, ALEX.email, GLENN.email]);
  });

  it("names the request in the subject, so it reads in a full inbox", () => {
    expect(build()[0].subject).toBe("New gray market request: GMR_2026-004");
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
    const emails = build({ recipients: [{ displayName: "No Mailbox" }, KATIE] });
    expect(emails.map((e) => e.email)).toEqual([KATIE.email]);
  });
});

describe("who is left off", () => {
  it("doesn't email the person who raised it", () => {
    const emails = build({ actor: KATIE });
    expect(emails.map((e) => e.email)).toEqual([ALEX.email, GLENN.email]);
  });

  // A queue that goes silent because its only member raised the request is
  // worse than one redundant email.
  it("emails the actor rather than nobody", () => {
    const emails = build({ recipients: [KATIE], actor: KATIE });
    expect(emails.map((e) => e.email)).toEqual([KATIE.email]);
  });
});

describe("what the email carries", () => {
  it("lists the details that are known", () => {
    const html = build({
      details: [
        { label: "Vendor", value: "AERI" },
        { label: "PO no.", value: "PO-4417" },
      ],
    })[0].detailHtml!;
    expect(html).toContain("Vendor: <strong>AERI</strong>");
    expect(html).toContain("PO no.: <strong>PO-4417</strong>");
  });

  // A new request is mostly empty by design — purchasing, engineering and
  // inspection fill their own stages in later — so an unanswered field is
  // left out rather than shown as a dash.
  it("drops the blanks rather than printing a grid of dashes", () => {
    const html = build({
      details: [
        { label: "Vendor", value: "AERI" },
        { label: "Testing required", value: "  " },
      ],
    })[0].detailHtml!;
    expect(html).toContain("Vendor");
    expect(html).not.toContain("Testing required:");
  });

  it("trims a padded value", () => {
    const html = build({ details: [{ label: "Vendor", value: "  AERI  " }] })[0].detailHtml!;
    expect(html).toContain("<strong>AERI</strong>");
  });

  it("explains that Testing Required may still be blank", () => {
    expect(build()[0].detailHtml).toContain("Testing Required is decided later");
  });

  // Being on the intake list is not the same as watching the request.
  it("points at Watch for the rest of the thread", () => {
    expect(build()[0].detailHtml).toContain("Watch");
  });

  it("escapes a name and a value rather than trusting them as HTML", () => {
    const emails = build({
      actor: { displayName: "<script>x</script>", email: "x@y.com" },
      details: [{ label: "Vendor", value: "A & <b>B</b>" }],
    });
    expect(emails[0].headlineHtml).not.toContain("<script>");
    expect(emails[0].detailHtml).toContain("A &amp; &lt;b&gt;B&lt;/b&gt;");
  });
});
