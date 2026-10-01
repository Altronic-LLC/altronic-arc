import { describe, it, expect } from "vitest";
import { annotateMultiChoiceFields, multiChoiceField } from "./graphFields";

// =============================================================================
// A genuine SharePoint MultiChoice column needs Graph's
// `Collection(Edm.String)` annotation. A bare array is refused with a bare
// `400 invalidRequest` that names no field.
//
// Reported 2026-09-24 (Femi Olugbon, build request 70): Assembly, Operations
// and Testing could not be ticked at all, while Part Status and Disposition
// saved fine. The difference is the column's `choice.displayAs` —
// "checkBoxes" (multi, annotate) vs "dropDownMenu" (single, don't).
//
// The annotation used to be here and was REMOVED in v0.17.5 while fixing a
// write to `ProjectReference`, which is not a multi-choice column at all. The
// doc comment then generalised that one case into "the annotation breaks the
// write", which is what this file exists to stop happening again.
// =============================================================================

describe("multiChoiceField", () => {
  it("emits the Collection(Edm.String) annotation alongside the values", () => {
    expect(multiChoiceField("Operations", ["Programming", "Machining"])).toEqual({
      "Operations@odata.type": "Collection(Edm.String)",
      Operations: ["Programming", "Machining"],
    });
  });

  it("annotates an empty array too — that is how a column is cleared", () => {
    expect(multiChoiceField("Testing", [])).toEqual({
      "Testing@odata.type": "Collection(Edm.String)",
      Testing: [],
    });
  });
});

describe("annotateMultiChoiceFields", () => {
  const MULTI = ["Assembly", "Operations", "Testing"] as const;

  it("annotates only the named columns", () => {
    const out = annotateMultiChoiceFields(
      { Assembly: ["Final Assy"], Part_x0020_Status: "On Hold", Qty: 4 },
      MULTI,
    );
    expect(out).toEqual({
      "Assembly@odata.type": "Collection(Edm.String)",
      Assembly: ["Final Assy"],
      // A single-value choice column must be left exactly as it was —
      // annotating it breaks it the same way omitting it breaks a multi one.
      Part_x0020_Status: "On Hold",
      Qty: 4,
    });
  });

  it("leaves a column absent from the payload absent", () => {
    const out = annotateMultiChoiceFields({ Qty: 1 }, MULTI);
    expect(out).toEqual({ Qty: 1 });
    expect(Object.keys(out).some((k) => k.includes("@odata"))).toBe(false);
  });

  it("does NOT annotate a non-array value", () => {
    // A caller clearing with null must stay null: annotating a null is its
    // own 400, so the guard is deliberate rather than defensive noise.
    const out = annotateMultiChoiceFields({ Assembly: null }, MULTI);
    expect(out).toEqual({ Assembly: null });
  });

  it("does not mutate the caller's object", () => {
    const input = { Assembly: ["Coil Assy"] };
    annotateMultiChoiceFields(input, MULTI);
    expect(input).toEqual({ Assembly: ["Coil Assy"] });
  });

  it("handles several multi-choice columns in one write", () => {
    const out = annotateMultiChoiceFields(
      { Assembly: ["Final Assy"], Testing: ["AOI", "Visual"] },
      MULTI,
    );
    expect(out["Assembly@odata.type"]).toBe("Collection(Edm.String)");
    expect(out["Testing@odata.type"]).toBe("Collection(Edm.String)");
  });
});
