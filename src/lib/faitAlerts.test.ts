import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import {
  buildFaitClosedEmails,
  buildFaitNotifyInitiatorEmails,
  buildFaitSignOffRequestEmails,
  buildFaitSqeFailedEmails,
  buildFaitWithSqeEmails,
  buildNewFaitEmails,
} from "./faitAlerts";

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

// =============================================================================
// The closed-FAIT alert — the SAME intake list is told when a FAIT closes,
// not just when it's raised (Ray, 2026-08-27: "set alerts for the original
// group when one is closed"). Separate from the generic status-change alert
// to watchers/assignees, since being on the intake list doesn't watch anyone.
// =============================================================================

function buildClosed(overrides: Partial<Parameters<typeof buildFaitClosedEmails>[0]> = {}) {
  return buildFaitClosedEmails({
    target: TARGET,
    recipients: [JERROD, ALEX, KATIE],
    actor: RAY,
    ...overrides,
  });
}

describe("the closed-FAIT email", () => {
  it("goes to everyone on the SAME intake list the new-FAIT alert uses", () => {
    expect(buildClosed().map((e) => e.email)).toEqual([JERROD.email, ALEX.email, KATIE.email]);
  });

  it("names the FAIT in the subject", () => {
    expect(buildClosed()[0].subject).toBe("FAIT closed: 691768-1");
  });

  it("says who closed it", () => {
    expect(buildClosed()[0].headlineHtml).toContain("Ray White");
    expect(buildClosed()[0].headlineHtml).toContain("closed");
  });

  it("is empty when nobody is configured", () => {
    expect(buildClosed({ recipients: [] })).toEqual([]);
  });

  it("doesn't email the person who closed it, unless that would leave nobody", () => {
    expect(buildClosed({ actor: JERROD }).map((e) => e.email)).toEqual([ALEX.email, KATIE.email]);
    expect(buildClosed({ recipients: [JERROD], actor: JERROD }).map((e) => e.email)).toEqual([
      JERROD.email,
    ]);
  });
});

// =============================================================================
// The closed alert's DE-DUPE. Everyone watching is already told a FAIT closed
// by the generic status-change note; this alert covers the intake queue, who
// aren't watchers. Somebody on both lists gets ONE email, not two.
// =============================================================================

describe("the closed-FAIT email's de-dupe", () => {
  it("drops anyone the generic status note already reaches", () => {
    const emails = buildClosed({ alreadyNotified: [ALEX] });
    expect(emails.map((e) => e.email)).toEqual([JERROD.email, KATIE.email]);
  });

  it("matches on the address regardless of case", () => {
    const emails = buildClosed({
      alreadyNotified: [{ displayName: "Alex", email: "ALEXANDRA.RUSSELL@ALTRONIC-LLC.COM" }],
    });
    expect(emails.map((e) => e.email)).toEqual([JERROD.email, KATIE.email]);
  });

  it("sends nothing when the whole intake list is already watching", () => {
    expect(buildClosed({ alreadyNotified: [JERROD, ALEX, KATIE] })).toEqual([]);
  });

  // The de-dupe runs BEFORE the actor fallback, so "unless that would leave
  // nobody" applies to whoever is actually left rather than resurrecting
  // somebody the generic note already covered.
  it("doesn't resurrect a de-duped person via the actor fallback", () => {
    expect(buildClosed({ recipients: [JERROD], actor: JERROD, alreadyNotified: [JERROD] })).toEqual(
      [],
    );
  });

  it("ignores a watcher with no address", () => {
    const emails = buildClosed({ alreadyNotified: [{ displayName: "No Mailbox" }] });
    expect(emails.map((e) => e.email)).toEqual([JERROD.email, ALEX.email, KATIE.email]);
  });
});

// =============================================================================
// The sign-off chain now also reaches the FAIT's watchers (Ray, 2026-09-01:
// "all sign offs notify watchers"), merged into whichever pool a builder
// already emailed. A watcher who's ALSO the targeted recipient must get one
// email, not two — every describe block below checks the dedupe as well as
// the addition.
// =============================================================================

const SARAH: Person = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" };

describe("the with-SQE alert now also notifies watchers", () => {
  function buildWithSqe(overrides: Partial<Parameters<typeof buildFaitWithSqeEmails>[0]> = {}) {
    return buildFaitWithSqeEmails({
      target: TARGET,
      recipients: [JERROD],
      actor: RAY,
      ...overrides,
    });
  }

  it("still emails the configured SQE reviewers with the existing wording", () => {
    const emails = buildWithSqe();
    expect(emails.map((e) => e.email)).toEqual([JERROD.email]);
    expect(emails[0].headlineHtml).toContain("This is with SQE");
    expect(emails[0].headlineHtml).toContain("Please review it");
  });

  it("adds the watchers alongside the reviewers", () => {
    const emails = buildWithSqe({ watchers: [SARAH, KATIE] });
    expect(emails.map((e) => e.email)).toEqual([JERROD.email, SARAH.email, KATIE.email]);
  });

  it("dedupes a watcher who is also a configured reviewer", () => {
    const emails = buildWithSqe({ watchers: [JERROD, SARAH] });
    expect(emails.map((e) => e.email)).toEqual([JERROD.email, SARAH.email]);
  });

  it("still leaves the actor off unless that would leave nobody", () => {
    expect(buildWithSqe({ watchers: [SARAH], actor: JERROD }).map((e) => e.email)).toEqual([
      SARAH.email,
    ]);
    expect(buildWithSqe({ recipients: [], watchers: [], actor: RAY })).toEqual([]);
  });

  it("with no watchers behaves exactly as before", () => {
    expect(buildWithSqe({ watchers: [] }).map((e) => e.email)).toEqual([JERROD.email]);
  });
});

describe("the sign-off request alert now also notifies watchers", () => {
  function buildRequest(
    overrides: Partial<Parameters<typeof buildFaitSignOffRequestEmails>[0]> = {},
  ) {
    return buildFaitSignOffRequestEmails({
      target: TARGET,
      role: "engineer",
      signer: JERROD,
      fallback: [ALEX],
      actor: RAY,
      ...overrides,
    });
  }

  describe("when the signer is reachable", () => {
    it("still emails the signer with the existing wording", () => {
      const emails = buildRequest();
      expect(emails.map((e) => e.email)).toEqual([JERROD.email]);
      expect(emails[0].headlineHtml).toContain("your engineering sign-off");
    });

    it("adds the watchers alongside the signer", () => {
      const emails = buildRequest({ watchers: [SARAH, KATIE] });
      expect(emails.map((e) => e.email)).toEqual([JERROD.email, SARAH.email, KATIE.email]);
    });

    it("dedupes a watcher who is also the signer", () => {
      const emails = buildRequest({ watchers: [JERROD] });
      expect(emails.map((e) => e.email)).toEqual([JERROD.email]);
    });
  });

  describe("when it falls back to the SQE queue", () => {
    function buildFallback(
      overrides: Partial<Parameters<typeof buildFaitSignOffRequestEmails>[0]> = {},
    ) {
      return buildRequest({ signer: null, ...overrides });
    }

    it("still emails the fallback queue with the existing wording", () => {
      const emails = buildFallback();
      expect(emails.map((e) => e.email)).toEqual([ALEX.email]);
      expect(emails[0].headlineHtml).toContain("No engineer is assigned");
    });

    it("adds the watchers alongside the fallback queue", () => {
      const emails = buildFallback({ watchers: [SARAH, KATIE] });
      expect(emails.map((e) => e.email)).toEqual([ALEX.email, SARAH.email, KATIE.email]);
    });

    it("dedupes a watcher who is also on the fallback queue", () => {
      const emails = buildFallback({ watchers: [ALEX] });
      expect(emails.map((e) => e.email)).toEqual([ALEX.email]);
    });
  });
});

describe("the SQE-failed alert now also notifies watchers", () => {
  function buildFailed(overrides: Partial<Parameters<typeof buildFaitSqeFailedEmails>[0]> = {}) {
    return buildFaitSqeFailedEmails({
      target: TARGET,
      initiator: JERROD,
      actor: RAY,
      ...overrides,
    });
  }

  it("still emails the initiator with the existing wording", () => {
    const emails = buildFailed();
    expect(emails.map((e) => e.email)).toEqual([JERROD.email]);
    expect(emails[0].headlineHtml).toContain("Failed");
  });

  it("adds the watchers alongside the initiator", () => {
    const emails = buildFailed({ watchers: [SARAH, KATIE] });
    expect(emails.map((e) => e.email)).toEqual([JERROD.email, SARAH.email, KATIE.email]);
  });

  it("dedupes a watcher who is also the initiator", () => {
    const emails = buildFailed({ watchers: [JERROD] });
    expect(emails.map((e) => e.email)).toEqual([JERROD.email]);
  });

  it("still sends nothing when there's no reachable initiator and no watchers", () => {
    expect(buildFailed({ initiator: null, watchers: [] })).toEqual([]);
  });

  // No fallback queue on this one — a watcher-only send is new behaviour, not
  // a queue substituting for a missing initiator.
  it("sends to watchers alone when there's no reachable initiator", () => {
    const emails = buildFailed({ initiator: null, watchers: [SARAH] });
    expect(emails.map((e) => e.email)).toEqual([SARAH.email]);
  });
});

// =============================================================================
// "Notify Initiator" — a Sign-off card checkbox with no wiring at all until
// now (Ray, 2026-09-01). A distinct alert, not a repurposing of any existing
// builder: initiator + watchers, actor excluded unless that would leave
// nobody.
// =============================================================================

describe("the Notify Initiator email", () => {
  function buildNotify(
    overrides: Partial<Parameters<typeof buildFaitNotifyInitiatorEmails>[0]> = {},
  ) {
    return buildFaitNotifyInitiatorEmails({
      target: TARGET,
      initiator: JERROD,
      actor: RAY,
      ...overrides,
    });
  }

  it("emails the initiator", () => {
    const emails = buildNotify();
    expect(emails.map((e) => e.email)).toEqual([JERROD.email]);
  });

  it("names the FAIT and says an update is available", () => {
    const emails = buildNotify();
    expect(emails[0].subject).toContain("691768-1");
    expect(emails[0].headlineHtml).toContain("update is available");
  });

  it("adds the watchers alongside the initiator", () => {
    const emails = buildNotify({ watchers: [SARAH, KATIE] });
    expect(emails.map((e) => e.email)).toEqual([JERROD.email, SARAH.email, KATIE.email]);
  });

  it("dedupes a watcher who is also the initiator", () => {
    const emails = buildNotify({ watchers: [JERROD] });
    expect(emails.map((e) => e.email)).toEqual([JERROD.email]);
  });

  it("doesn't email the person who checked the box, unless that would leave nobody", () => {
    expect(buildNotify({ watchers: [SARAH], actor: JERROD }).map((e) => e.email)).toEqual([
      SARAH.email,
    ]);
    // JERROD is both the initiator and the actor here — the only person to
    // tell, so the fallback keeps them rather than sending nothing.
    expect(
      buildNotify({ initiator: JERROD, watchers: [], actor: JERROD }).map((e) => e.email),
    ).toEqual([JERROD.email]);
  });

  it("sends nothing when there's no initiator and no watchers", () => {
    expect(buildNotify({ initiator: null, watchers: [] })).toEqual([]);
  });

  it("skips an initiator with no mailbox", () => {
    expect(buildNotify({ initiator: { displayName: "No Mailbox" } })).toEqual([]);
  });
});
