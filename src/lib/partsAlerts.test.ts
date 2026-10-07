import { describe, expect, it } from "vitest";
import {
  SAP_ACTIONS,
  buildCorrectionRequestEmails,
  buildNewComponentEmails,
  buildNewPartForSapEmails,
  buildPartEditedEmails,
  buildSapResponseEmails,
  componentEmailDetails,
  formatCreatedAt,
} from "./partsAlerts";
import type { ChangeTarget } from "./changeAlerts";
import type { AltronicComponent } from "@/types/task";

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
      details: [{ label: "Mfg Name", value: "PANASONIC" }, { label: "Tolerance", value: " " }],
    });
    expect(emails.map((e) => e.email)).toEqual([glenn.email, brandon.email]);
    expect(emails[0].subject).toBe("New component waiting for engineering review: 701990 — RESISTOR");
    expect(emails[0].headlineHtml).toContain("Sheila Horn");
    expect(emails[0].detailHtml).toContain("Mfg Name: <strong>PANASONIC</strong>");
    // Every field is listed under its label, a blank one included — the
    // reviewer checks what's missing too.
    expect(emails[0].detailHtml).toContain("Tolerance: <strong></strong>");
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

const resistor: AltronicComponent = {
  id: 17,
  partNumber: "701990",
  category: "Surface Mount",
  description: "RESISTOR - FILM",
  mfgName: "PANASONIC",
  mfgNumber: "ERJ-3EKF4701V",
  ratingA: "4K7",
  ratingB: "1/10W",
  ratingC: "75V",
  tempMin: "-55C",
  tempMax: "155C",
  tolerance: "1%",
  footprint: "0603",
  notes: "",
  hasDataSheet: false,
  signOffStatus: "Pending SAP",
  legacySource: "",
  comments: [],
  createdBy: chandana,
  hasAttachments: false,
  createdAt: new Date("2026-09-29T13:28:00Z"),
  modifiedAt: new Date("2026-09-29T13:28:00Z"),
};

describe("componentEmailDetails — every field under its label", () => {
  it("names each rating for the component type, with its column", () => {
    const labels = componentEmailDetails(resistor).map((d) => d.label);
    expect(labels).toContain("Resistance (Rating A)");
    expect(labels).toContain("Power (Rating B)");
    expect(labels).toContain("Working voltage (Rating C)");
    for (const l of ["Altronic Part Number", "Description", "Mfg Name", "Mfg Number", "Tolerance", "Temp Min", "Temp Max", "Footprint", "Note", "Date Created"]) {
      expect(labels).toContain(l);
    }
  });

  it("keeps a rating's value beside its own label", () => {
    const details = componentEmailDetails(resistor);
    expect(details.find((d) => d.label === "Resistance (Rating A)")?.value).toBe("4K7");
    expect(details.find((d) => d.label === "Power (Rating B)")?.value).toBe("1/10W");
    expect(details.find((d) => d.label === "Working voltage (Rating C)")?.value).toBe("75V");
  });

  it("says a rating is unused for the type, and keeps the generic name for an unknown type", () => {
    const electrolytic = componentEmailDetails({ ...resistor, description: "CAPACITOR - ELECTROLYTIC" }).map((d) => d.label);
    expect(electrolytic).toContain("Rating C (not used)");
    const unknown = componentEmailDetails({ ...resistor, description: "WIDGET" }).map((d) => d.label);
    expect(unknown).toEqual(expect.arrayContaining(["Rating A", "Rating B", "Rating C"]));
  });
});

describe("buildNewPartForSapEmails — after an HCO engineering review", () => {
  const build = (comment: string) =>
    buildNewPartForSapEmails({
      target,
      partNumber: resistor.partNumber,
      description: resistor.description,
      recipients: [sheila],
      actor: glenn,
      requester: resistor.createdBy,
      review: { comment },
      details: componentEmailDetails(resistor),
    });

  it("is the new-part email — same subject, every field, the three answers", () => {
    const [email] = build("Checked");
    expect(email.email).toBe(sheila.email);
    expect(email.subject).toBe("New Part to Add to SAP | 701990 | RESISTOR - FILM");
    expect(email.detailHtml).toContain("Details:");
    expect(email.detailHtml).toContain("Resistance (Rating A): <strong>4K7</strong>");
    expect(email.actions).toEqual(SAP_ACTIONS);
  });

  it("is requested by whoever ADDED the component, and says who reviewed it", () => {
    const [email] = build("Checked");
    expect(email.headlineHtml).toContain("Requested by <strong>Chandana Ramisetty</strong>");
    expect(email.headlineHtml).toContain("Engineering review approved by <strong>Glenn Terry</strong>");
    expect(email.headlineHtml).toContain("tells Chandana Ramisetty which it was");
  });

  it("adds the reviewer's comments above the details, escaped", () => {
    const html = build("Footprint <0603> checked\nOK")[0].detailHtml!;
    expect(html).toContain("Engineering review comments:");
    expect(html).toContain("Footprint &lt;0603&gt; checked<br/>OK");
    expect(html.indexOf("Engineering review comments:")).toBeLessThan(html.indexOf("Details:"));
  });

  it("says there were no comments rather than leaving a gap", () => {
    expect(build("  ")[0].detailHtml).toContain("<em>None</em>");
  });

  it("copes with a component nobody is recorded as adding", () => {
    const [email] = buildNewPartForSapEmails({
      target,
      partNumber: "701990",
      description: "RESISTOR",
      recipients: [sheila],
      actor: glenn,
      requester: null,
      review: { comment: "" },
      details: [],
    });
    expect(email.headlineHtml).not.toContain("Requested by");
    expect(email.headlineHtml).toContain("tells whoever added it which it was");
  });
});

describe("buildCorrectionRequestEmails", () => {
  const build = (recipients = [glenn, sheila, { ...sheila, email: "SHEILA.HORN@altronic-llc.com" }]) =>
    buildCorrectionRequestEmails({
      target: partTarget,
      partNumber: "681183",
      description: "PCB FINAL",
      message: "Manufacturer is <Acme>\nnot Acme Corp",
      recipients,
      actor: chandana,
    });

  it("goes to the reviewers and the SAP admins, once each", () => {
    expect(build().map((e) => e.email)).toEqual([glenn.email, sheila.email]);
  });

  it("names who asked, and carries their message escaped", () => {
    const [email] = build();
    expect(email.subject).toBe("Correction suggested: 681183 — PCB FINAL");
    expect(email.headlineHtml).toContain("Chandana Ramisetty");
    expect(email.detailHtml).toContain("Manufacturer is &lt;Acme&gt;<br/>not Acme Corp");
    expect(email.detailHtml).toContain("681183");
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
