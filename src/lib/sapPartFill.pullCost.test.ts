import { describe, expect, it } from "vitest";
import { pullSapCost } from "./sapPartFill";
import type { SapPart, SubAssemblyLine } from "@/types/pricing";

// Invented values — the repo is public.
const line = (patch: Partial<SubAssemblyLine> = {}): SubAssemblyLine => ({
  partNumber: "700001",
  sapPartNumber: "9000-0001-00",
  description: "TYPED DESCRIPTION",
  quantity: 2,
  uploadedCost: 1.5,
  adjustedCost: null,
  source: "csv",
  ...patch,
});
const part = (patch: Partial<SapPart> = {}): SapPart => ({
  altronicPartNumber: "700001",
  sapPartNumber: "9000-0001-00",
  description: "SAP DESCRIPTION",
  mpg: "XX",
  listPrice: null,
  cost: 2.25,
  ...patch,
});

describe("pullSapCost", () => {
  it("puts SAP's cost in the base and marks it SAP, whatever the line came from", () => {
    const r = pullSapCost(line(), part());
    expect(r.patch).toEqual({ uploadedCost: 2.25, source: "sap" });
    expect(r.message).toMatch(/now SAP's \$2\.25 \(was \$1\.50\)/);
  });

  it("never touches the description, the quantity or the adjusted cost — and says the adjustment still wins", () => {
    const r = pullSapCost(line({ adjustedCost: 3 }), part());
    expect(r.patch).not.toHaveProperty("description");
    expect(r.patch).not.toHaveProperty("quantity");
    expect(r.patch).not.toHaveProperty("adjustedCost");
    expect(r.message).toMatch(/adjusted cost still overrides it/);
  });

  it("fills a BLANK number from SAP, never a typed one", () => {
    expect(pullSapCost(line({ sapPartNumber: "" }), part()).patch).toMatchObject({ sapPartNumber: "9000-0001-00" });
    expect(pullSapCost(line({ partNumber: "" }), part()).patch).toMatchObject({ partNumber: "700001" });
    expect(pullSapCost(line({ partNumber: "MINE" }), part()).patch).not.toHaveProperty("partNumber");
  });

  it("changes nothing when SAP hasn't the part, or holds no cost for it", () => {
    expect(pullSapCost(line(), null)).toEqual({ patch: null, message: expect.stringMatching(/isn't in SAP/) });
    expect(pullSapCost(line(), part({ cost: null }))).toEqual({ patch: null, message: expect.stringMatching(/holds no cost/) });
  });

  it("says so when SAP's cost hasn't moved", () => {
    expect(pullSapCost(line({ uploadedCost: 2.25, source: "sap" }), part()).message).toMatch(/still \$2\.25/);
  });
});
