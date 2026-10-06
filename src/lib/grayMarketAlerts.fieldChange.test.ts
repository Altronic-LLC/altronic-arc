import { describe, it, expect } from "vitest";
import type { GrayMarketRequest, Person } from "@/types/task";
import {
  buildGrayMarketFieldChangeEmails,
  grayMarketAlertChanges,
} from "./grayMarketAlerts";

// =============================================================================
// BusinessIT#20 — a change to Testing Required, or to anything on the
// Engineering or Production cards, emails Alex and the request's watchers.
// =============================================================================

function req(over: Partial<GrayMarketRequest> = {}): GrayMarketRequest {
  return {
    id: 7,
    title: "1000-1234-00",
    logNo: "GMR_2026-007",
    status: "Open",
    requestDate: null,
    testingRequired: "",
    requestor: null,
    partsLocation: null,
    watchers: [],
    comments: [],
    hasAttachments: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    values: {},
    ...over,
  } as GrayMarketRequest;
}

const alex: Person = { displayName: "Alexandra Russell", email: "Alexandra.Russell@altronic-llc.com" };
const katie: Person = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com" };
const glenn: Person = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };
const target = { kind: "grayMarketRequest" as const, id: 7, title: "GMR_2026-007" };

describe("grayMarketAlertChanges", () => {
  it("catches Testing Required", () => {
    expect(grayMarketAlertChanges(req(), req({ testingRequired: "Yes" }))).toEqual([
      { label: "Testing Required", from: "", to: "Yes" },
    ]);
  });

  it("catches an Engineering field", () => {
    const out = grayMarketAlertChanges(req(), req({ values: { testComments: "Passed bench" } }));
    expect(out).toEqual([{ label: "Test Comments", from: "", to: "Passed bench" }]);
  });

  it("catches a Production field", () => {
    const out = grayMarketAlertChanges(
      req({ values: { inCircuitResults: "Pass" } }),
      req({ values: { inCircuitResults: "Fail" } }),
    );
    expect(out).toEqual([{ label: "In Circuit Results", from: "Pass", to: "Fail" }]);
  });

  it("ignores Purchasing, Inspection and Request fields", () => {
    const out = grayMarketAlertChanges(
      req(),
      req({ values: { vendor: "Acme", qtyReceived: "10", partDescription: "Cap" } }),
    );
    expect(out).toEqual([]);
  });

  it("ignores a re-save of the same value, whitespace included", () => {
    expect(
      grayMarketAlertChanges(
        req({ testingRequired: "Yes", values: { serialNo: "S1" } }),
        req({ testingRequired: "Yes", values: { serialNo: " S1 " } }),
      ),
    ).toEqual([]);
  });

  it("reports a cleared field", () => {
    expect(
      grayMarketAlertChanges(req({ values: { serialNo: "S1" } }), req({ values: {} })),
    ).toEqual([{ label: "Serial No", from: "S1", to: "" }]);
  });
});

describe("buildGrayMarketFieldChangeEmails", () => {
  const changes = [{ label: "Testing Required", from: "", to: "Yes" }];

  it("emails the alert list and the watchers", () => {
    const out = buildGrayMarketFieldChangeEmails({
      target, changes, alertList: [alex], watchers: [katie], actor: glenn,
    });
    expect(out.map((e) => e.email)).toEqual([alex.email, katie.email]);
  });

  it("sends nothing when nothing changed", () => {
    expect(
      buildGrayMarketFieldChangeEmails({
        target, changes: [], alertList: [alex], watchers: [katie], actor: glenn,
      }),
    ).toEqual([]);
  });

  it("emails someone on both lists once", () => {
    const out = buildGrayMarketFieldChangeEmails({
      target, changes, alertList: [alex],
      watchers: [{ ...alex, email: alex.email!.toLowerCase() }], actor: glenn,
    });
    expect(out).toHaveLength(1);
  });

  it("drops the actor from the watchers strictly", () => {
    const out = buildGrayMarketFieldChangeEmails({
      target, changes, alertList: [alex], watchers: [glenn], actor: glenn,
    });
    expect(out.map((e) => e.email)).toEqual([alex.email]);
  });

  it("keeps the actor on the alert list when they are the only one on it", () => {
    const out = buildGrayMarketFieldChangeEmails({
      target, changes, alertList: [alex], watchers: [], actor: alex,
    });
    expect(out.map((e) => e.email)).toEqual([alex.email]);
  });

  it("lists each change as old → new and escapes values", () => {
    const [e] = buildGrayMarketFieldChangeEmails({
      target,
      changes: [
        { label: "Testing Required", from: "", to: "Yes" },
        { label: "Test Comments", from: "a", to: "<b>x</b>" },
      ],
      alertList: [alex], watchers: [], actor: glenn,
    });
    expect(e.subject).toBe("Gray market request updated: GMR_2026-007");
    expect(e.headlineHtml).toContain("Glenn Terry");
    expect(e.headlineHtml).toContain("2 fields");
    expect(e.detailHtml).toContain("Testing Required: <em>blank</em> &rarr; <strong>Yes</strong>");
    expect(e.detailHtml).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(e.detailHtml).not.toContain("<b>x</b>");
  });

  it("clips long free text", () => {
    const [e] = buildGrayMarketFieldChangeEmails({
      target,
      changes: [{ label: "Production Comments", from: "", to: "x".repeat(500) }],
      alertList: [alex], watchers: [], actor: glenn,
    });
    expect(e.detailHtml).toContain("x".repeat(300) + "…");
    expect(e.detailHtml).not.toContain("x".repeat(301));
  });
});
