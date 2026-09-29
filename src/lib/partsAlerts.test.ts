import { describe, expect, it } from "vitest";
import { buildEngineeringApprovedEmails, buildNewPartEmails, buildPartEditedEmails } from "./partsAlerts";
import type { ChangeTarget } from "./changeAlerts";

const target: ChangeTarget = { kind: "altronicComponent", id: 17, title: "701990 — RESISTOR" };
const glenn = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };
const brandon = { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com" };
const sheila = { displayName: "Sheila Horn", email: "sheila.horn@altronic-llc.com" };

describe("buildNewPartEmails", () => {
  it("asks the reviewing engineers to review a new component", () => {
    const emails = buildNewPartEmails({
      target,
      component: true,
      recipients: [glenn, brandon],
      actor: sheila,
      details: [{ label: "Mfg Name", value: "PANASONIC" }, { label: "Blank", value: " " }],
    });
    expect(emails.map((e) => e.email)).toEqual([glenn.email, brandon.email]);
    expect(emails[0].subject).toBe("New component waiting for engineering review: 701990 — RESISTOR");
    expect(emails[0].headlineHtml).toContain("Sheila Horn");
    expect(emails[0].detailHtml).toContain("PANASONIC");
    // A blank detail is dropped, not shown as an empty line.
    expect(emails[0].detailHtml).not.toContain("Blank");
  });

  it("asks the SAP admins to add a new part to SAP", () => {
    const emails = buildNewPartEmails({ target, component: false, recipients: [sheila], actor: glenn, details: [] });
    expect(emails[0].subject).toMatch(/^New part to add to SAP/);
    expect(emails[0].detailHtml).toBeUndefined();
  });

  it("drops the actor from the queue — unless they're the only one in it", () => {
    expect(
      buildNewPartEmails({ target, component: true, recipients: [glenn, brandon], actor: glenn, details: [] }).map(
        (e) => e.email,
      ),
    ).toEqual([brandon.email]);
    // Sheila adding a part herself still gets her "add to SAP" reminder.
    expect(
      buildNewPartEmails({ target, component: false, recipients: [sheila], actor: sheila, details: [] }).map(
        (e) => e.email,
      ),
    ).toEqual([sheila.email]);
  });

  it("sends each person one email, and nobody without an address", () => {
    const emails = buildNewPartEmails({
      target,
      component: true,
      recipients: [glenn, { ...glenn, email: "GLENN.TERRY@altronic-llc.com" }, { displayName: "No Mail" }],
      actor: sheila,
      details: [],
    });
    expect(emails).toHaveLength(1);
  });

  it("escapes names", () => {
    const [email] = buildNewPartEmails({
      target,
      component: true,
      recipients: [glenn],
      actor: { displayName: "<b>x</b>", email: "x@altronic-llc.com" },
      details: [],
    });
    expect(email.headlineHtml).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("buildEngineeringApprovedEmails", () => {
  it("hands the component to the SAP admins, with the reviewer's comment", () => {
    const [email] = buildEngineeringApprovedEmails({ target, recipients: [sheila], actor: glenn, comment: "Checked" });
    expect(email.email).toBe(sheila.email);
    expect(email.subject).toBe("Ready for SAP: 701990 — RESISTOR");
    expect(email.detailHtml).toContain("Checked");
  });
});

describe("buildPartEditedEmails", () => {
  const changes = [{ label: "Mfg Number", from: "ERJ-3EKF4701V", to: "ERJ-3EKF4702V" }];

  it("tells the SAP admins exactly what changed", () => {
    const [email] = buildPartEditedEmails({ target, recipients: [sheila], actor: glenn, changes });
    expect(email.subject).toBe("Part changed: 701990 — RESISTOR");
    expect(email.detailHtml).toContain("ERJ-3EKF4701V");
    expect(email.detailHtml).toContain("ERJ-3EKF4702V");
  });

  it("marks a blank value rather than showing nothing", () => {
    const [email] = buildPartEditedEmails({
      target,
      recipients: [sheila],
      actor: glenn,
      changes: [{ label: "Notes", from: "", to: "New note" }],
    });
    expect(email.detailHtml).toContain("(blank)");
  });

  it("never tells the actor about their own edit — even if they're the only SAP admin", () => {
    expect(buildPartEditedEmails({ target, recipients: [sheila], actor: sheila, changes })).toEqual([]);
  });

  it("sends nothing for an edit that changed nothing", () => {
    expect(buildPartEditedEmails({ target, recipients: [sheila], actor: glenn, changes: [] })).toEqual([]);
  });
});
