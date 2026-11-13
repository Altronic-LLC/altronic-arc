import { describe, expect, it } from "vitest";
import { pottingLimitAlertContent, pottingLimitAlertSubject } from "./pottingSampleAlerts";

const ENTRY = { id: "7", date: "2026-11-05T14:20:00Z", volume: 125, weight: 412 };
const LIMITS = { lowerLimit: 380, upperLimit: 405 };

describe("pottingLimitAlertSubject", () => {
  it("keeps its own subject, naming the breach and the weight", () => {
    expect(pottingLimitAlertSubject(ENTRY, "above-upper")).toBe(
      "[ARC] Coil potting sample above upper limit — weight 412",
    );
    expect(pottingLimitAlertSubject(ENTRY, "below-lower")).toBe(
      "[ARC] Coil potting sample below lower limit — weight 412",
    );
  });
});

describe("pottingLimitAlertContent", () => {
  it("says which limit, and lists the sample's figures with both limits", () => {
    const c = pottingLimitAlertContent(ENTRY, LIMITS, "above-upper");
    expect(c.introHtml).toContain("above the upper spec limit");
    expect(c.calloutTitle).toMatch(/^Weight 412 — /);
    expect(c.messageHtml).toContain("Volume: <strong>125</strong>");
    expect(c.messageHtml).toContain("Lower spec limit: <strong>380</strong>");
    expect(c.messageHtml).toContain("Upper spec limit: <strong>405</strong>");
    expect(c.messageHtml).toContain('Weight: <strong style="color:#CB2C30;">412</strong>');
  });

  it("names the lower limit for a light sample", () => {
    expect(pottingLimitAlertContent({ ...ENTRY, weight: 300 }, LIMITS, "below-lower").introHtml).toContain(
      "below the lower spec limit",
    );
  });
});
