import { describe, expect, it } from "vitest";
import {
  SAP_ACTIONS,
  buildEngineeringApprovedEmails,
  buildNewComponentEmails,
  buildNewPartForSapEmails,
  buildPartEditedEmails,
  buildSapResponseEmails,
  formatCreatedAt,
} from "./partsAlerts";
import type { ChangeTarget } from "./changeAlerts";

const target: ChangeTarget = { kind: "altronicComponent", id: 17, title: "701990 — RESISTOR" };
const partTarget: ChangeTarget = { kind: "altronicPart", id: 30, title: "681183 — PCB FINAL" };
const glenn = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };
const brandon = { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com" };
const sheila = { displayName: "Sheila Horn", email: "sheila.horn@altronic-llc.com" };
const chandana = { displayName: "Chandana Ramisetty", email: "chandana.ramisetty@altronic-llc.com" };

describe("buildNewComponentEmails", () => {
  it("asks the reviewing engineers to review a new component", () => {
    const emails = buildNewComponentEmails({
      target,
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
    // Engineering review has no answer buttons — those are the SAP step's.
    expect(emails[0].actions).toBeUndefined();
  });

  it("drops the actor from the queue — unless they're the only one in it", () => {
    expect(
      buildNewComponentEmails({ target, recipients: [glenn, brandon], actor: glenn, details: [] }).map((e) => e.email),
    ).toEqual([brandon.email]);
    expect(buildNewComponentEmails({ target, recipients: [glenn], actor: glenn, details: [] }).map((e) => e.email)).toEqual([
      glenn.email,
    ]);
  });

  it("sends each person one email, and nobody without an address", () => {
    const emails = buildNewComponentEmails({
      target,
      recipients: [glenn, { ...glenn, email: "GLENN.TERRY@altronic-llc.com" }, { displayName: "No Mail" }],
      actor: sheila,
      details: [],
    });
    expect(emails).toHaveLength(1);
  });

  it("escapes names", () => {
    const [email] = buildNewComponentEmails({
      target,
      recipients: [glenn],
      actor: { displayName: "<b>x</b>", email: "x@altronic-llc.com" },
      details: [],
    });
    expect(email.headlineHtml).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("buildNewPartForSapEmails — the old Power Automate layout", () => {
  const details = [
    { label: "Altronic Part Number", value: "681183" },
    { label: "Description", value: "PCB FINAL, WALLEYE, ANALOG, CONNECTOR" },
    { label: "MFG Part Number", value: "" },
    { label: "Assigned By", value: "Matthew Traina" },
  ];
  const build = (actor = chandana) =>
    buildNewPartForSapEmails({
      target: partTarget,
      partNumber: "681183",
      description: "PCB FINAL, WALLEYE, ANALOG, CONNECTOR",
      recipients: [sheila],
      actor,
      details,
    });

  it("uses the old subject line: New Part to Add to SAP | number | description", () => {
    expect(build()[0].subject).toBe("New Part to Add to SAP | 681183 | PCB FINAL, WALLEYE, ANALOG, CONNECTOR");
  });

  it("names who asked, with their address", () => {
    const [email] = build();
    expect(email.headlineHtml).toContain("Requested by <strong>Chandana Ramisetty</strong>");
    expect(email.headlineHtml).toContain("&lt;chandana.ramisetty@altronic-llc.com&gt;");
  });

  it("lists every field, blanks included, in order", () => {
    const html = build()[0].detailHtml!;
    expect(html).toContain("Details:");
    expect(html).toContain("MFG Part Number: <strong></strong>");
    expect(html.indexOf("Altronic Part Number")).toBeLessThan(html.indexOf("Assigned By"));
  });

  it("carries the three SAP answers as buttons", () => {
    expect(build()[0].actions).toEqual(SAP_ACTIONS);
    expect(SAP_ACTIONS.map((a) => a.query)).toEqual(["sap=added", "sap=not-needed", "sap=more-info"]);
    expect(SAP_ACTIONS.map((a) => a.label)).toEqual([
      "Added to SAP >",
      "Does not need to be added to SAP >",
      "Will be added to SAP but requires more information >",
    ]);
  });

  it("still reaches Sheila when she added the part herself", () => {
    expect(build(sheila).map((e) => e.email)).toEqual([sheila.email]);
  });
});

describe("formatCreatedAt", () => {
  it("reads as a full date and time on US Eastern", () => {
    // 13:28 UTC is 9:28 AM EDT — the Power Automate email's own example.
    expect(formatCreatedAt(new Date("2026-09-29T13:28:00Z"))).toBe("Tuesday, September 29, 2026 at 9:28 AM EDT");
  });
});

describe("buildEngineeringApprovedEmails", () => {
  it("hands the component to the SAP admins, with the reviewer's comment and the SAP answers", () => {
    const [email] = buildEngineeringApprovedEmails({ target, recipients: [sheila], actor: glenn, comment: "Checked" });
    expect(email.email).toBe(sheila.email);
    expect(email.subject).toBe("Ready for SAP: 701990 — RESISTOR");
    expect(email.detailHtml).toContain("Checked");
    expect(email.actions).toEqual(SAP_ACTIONS);
  });
});

describe("buildSapResponseEmails — the answer goes back to whoever added the part", () => {
  const reply = (response: "added" | "not-needed" | "more-info", comment = "") =>
    buildSapResponseEmails({ target: partTarget, response, submitter: chandana, actor: sheila, comment });

  it("says it was added to SAP", () => {
    const [email] = reply("added");
    expect(email.email).toBe(chandana.email);
    expect(email.subject).toBe("Added to SAP: 681183 — PCB FINAL");
    expect(email.headlineHtml).toContain("added this part to SAP and approved it");
  });

  it("says it doesn't need to be added", () => {
    const [email] = reply("not-needed");
    expect(email.subject).toBe("Approved — not added to SAP: 681183 — PCB FINAL");
    expect(email.headlineHtml).toContain("does not need to be added to SAP");
  });

  it("says more information is needed, and carries what", () => {
    const [email] = reply("more-info", "Need the vendor part number");
    expect(email.subject).toBe("More information needed for SAP: 681183 — PCB FINAL");
    expect(email.detailHtml).toContain("Need the vendor part number");
  });

  it("tells nobody when the SAP admin added the part herself", () => {
    expect(
      buildSapResponseEmails({ target: partTarget, response: "added", submitter: sheila, actor: sheila, comment: "" }),
    ).toEqual([]);
  });

  it("tells nobody when nobody is known to have added it (a loaded part)", () => {
    expect(
      buildSapResponseEmails({ target: partTarget, response: "added", submitter: null, actor: sheila, comment: "" }),
    ).toEqual([]);
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
