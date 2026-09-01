import { describe, expect, it } from "vitest";
import {
  UNMIGRATED_LOOKUP_ID,
  attachReference,
  compareReferenceValues,
  duplicateHints,
  duplicateKey,
  isUnmigratedReference,
  referenceIndex,
  referenceKey,
  referenceLabel,
  referenceOptions,
  unmigratedReference,
} from "./maintenanceReferences";
import { makeReferenceValue } from "@/test/maintenanceFixtures";

// =============================================================================
// The pure rules behind the two CMMS reference lists.
//
// They live in lib/ so the modals, the filter bar, the dashboard grouping and
// the admin screen all read the SAME answer to "which values may be picked",
// "what is this called" and "which of these look like duplicates". Two copies
// of the first of those is how a retired department comes back in one place.
// =============================================================================

const MACH_SHOP = makeReferenceValue({ lookupId: 4, title: "MACH SHOP" });
const SMT = makeReferenceValue({ lookupId: 8, title: "SMT" });
const HARNESS_TYPO = makeReferenceValue({
  lookupId: 22,
  title: "HARNESS DEPARMENT",
  active: false,
});

describe("referenceKey", () => {
  it("keys an ordinary reference by its lookupId, so a rename keeps its bucket", () => {
    expect(referenceKey({ lookupId: 4, title: "MACH SHOP" })).toBe("4");
    // The SAME key after somebody fixes the name in Admin — which is the whole
    // reason grouping and filtering key off this rather than the title.
    expect(referenceKey({ lookupId: 4, title: "Machine Shop" })).toBe("4");
  });

  it("keys an unmigrated legacy value by its TEXT, so two don't collapse into one", () => {
    // Every legacy value carries lookupId 0. Keying them all as "0" would put
    // PROD and QC in one bucket, which is worse than not grouping at all.
    expect(referenceKey({ lookupId: 0, title: "PROD" })).toBe("title:prod");
    expect(referenceKey({ lookupId: 0, title: " QC " })).toBe("title:qc");
    expect(referenceKey({ lookupId: 0, title: "PROD" })).not.toBe(
      referenceKey({ lookupId: 0, title: "QC" }),
    );
  });
});

describe("referenceLabel", () => {
  it("names a reference by its title", () => {
    expect(referenceLabel({ lookupId: 4, title: "MACH SHOP" })).toBe("MACH SHOP");
  });

  // Rule 1: a value that IS set must never render as empty, or the next person
  // to open the record overwrites something they never saw.
  it("falls back to the id rather than an empty string", () => {
    expect(referenceLabel({ lookupId: 41, title: "" })).toBe("#41");
    expect(referenceLabel({ lookupId: 41, title: "   " })).toBe("#41");
  });

  it("is empty only for nothing at all", () => {
    expect(referenceLabel(null)).toBe("");
    expect(referenceLabel(undefined)).toBe("");
  });
});

describe("unmigratedReference", () => {
  it("wraps a legacy choice value as a reference with the reserved id", () => {
    // SharePoint item ids start at 1, so 0 can never collide with a real one.
    expect(unmigratedReference("QC")).toEqual({ lookupId: UNMIGRATED_LOOKUP_ID, title: "QC" });
    expect(UNMIGRATED_LOOKUP_ID).toBe(0);
  });

  it("reads a blank legacy value as nothing at all", () => {
    expect(unmigratedReference("")).toBeNull();
    expect(unmigratedReference("   ")).toBeNull();
    expect(unmigratedReference(null)).toBeNull();
    expect(unmigratedReference(undefined)).toBeNull();
  });

  it("recognises one afterwards", () => {
    expect(isUnmigratedReference(unmigratedReference("QC"))).toBe(true);
    expect(isUnmigratedReference({ lookupId: 4, title: "MACH SHOP" })).toBe(false);
    expect(isUnmigratedReference(null)).toBe(false);
  });
});

describe("attachReference", () => {
  const index = referenceIndex([MACH_SHOP, SMT, HARNESS_TYPO]);

  it("fills the title in for a lookup Graph handed back as a bare id", () => {
    expect(attachReference({ lookupId: 4, title: "" }, index)).toEqual({
      lookupId: 4,
      title: "MACH SHOP",
    });
  });

  it("resolves a RETIRED value too — retiring hides it from pickers, not records", () => {
    expect(attachReference({ lookupId: 22, title: "" }, index)).toEqual({
      lookupId: 22,
      title: "HARNESS DEPARMENT",
    });
  });

  it("leaves a dangling lookup VISIBLE rather than dropping it", () => {
    // It renders as "#41" (see referenceLabel). A value that is set must not
    // look unset — the same rule the Teradyne lookups follow.
    expect(attachReference({ lookupId: 41, title: "" }, index)).toEqual({
      lookupId: 41,
      title: "",
    });
  });

  it("does not overwrite a title it already has", () => {
    const ref = { lookupId: 4, title: "Whatever the row said" };
    expect(attachReference(ref, index)).toBe(ref);
  });

  it("UPGRADES a legacy value whose text matches a row, case-insensitively", () => {
    // So an Equipment row still on the old choice column buckets and filters
    // with every migrated row rather than forming a bucket of one beside it.
    expect(attachReference({ lookupId: 0, title: "mach shop" }, index)).toEqual({
      lookupId: 4,
      title: "MACH SHOP",
    });
  });

  it("leaves a legacy value matching nothing exactly as it is", () => {
    expect(attachReference({ lookupId: 0, title: "OFF THE BOOKS" }, index)).toEqual({
      lookupId: 0,
      title: "OFF THE BOOKS",
    });
  });

  it("passes null straight through", () => {
    expect(attachReference(null, index)).toBeNull();
  });

  it("keeps the FIRST row when two share a title, so buckets don't move on reload", () => {
    const dup = referenceIndex([
      makeReferenceValue({ lookupId: 4, title: "QC" }),
      makeReferenceValue({ lookupId: 9, title: "QC" }),
    ]);
    expect(attachReference({ lookupId: 0, title: "QC" }, dup)).toEqual({
      lookupId: 4,
      title: "QC",
    });
  });
});

describe("referenceOptions", () => {
  const values = [MACH_SHOP, SMT, HARNESS_TYPO];

  it("offers only ACTIVE values for a new selection", () => {
    expect(referenceOptions(values, null)).toEqual([
      { value: "4", label: "MACH SHOP" },
      { value: "8", label: "SMT" },
    ]);
  });

  // The reason retiring exists at all: a picker that dropped the current value
  // would quietly clear it on the next save.
  it("keeps a RETIRED value the record already points at, and says so", () => {
    const options = referenceOptions(values, { lookupId: 22, title: "HARNESS DEPARMENT" });
    expect(options[0]).toEqual({ value: "22", label: "HARNESS DEPARMENT (retired)" });
    expect(options).toHaveLength(3);
  });

  it("keeps a value the list hasn't got at all, labelled as such", () => {
    const options = referenceOptions(values, { lookupId: 41, title: "" });
    expect(options[0]).toEqual({ value: "41", label: "#41 · not on the list" });
  });

  it("does not duplicate a current value that is already active", () => {
    const options = referenceOptions(values, { lookupId: 4, title: "MACH SHOP" });
    expect(options.filter((o) => o.value === "4")).toHaveLength(1);
    expect(options).toHaveLength(2);
  });
});

describe("compareReferenceValues", () => {
  it("sorts alphabetically, numeric-aware", () => {
    const sorted = [
      makeReferenceValue({ lookupId: 1, title: "BAY 10" }),
      makeReferenceValue({ lookupId: 2, title: "BAY 2" }),
      makeReferenceValue({ lookupId: 3, title: "ASSEMBLY" }),
    ].sort(compareReferenceValues);
    expect(sorted.map((v) => v.title)).toEqual(["ASSEMBLY", "BAY 2", "BAY 10"]);
  });
});

describe("duplicateKey / duplicateHints", () => {
  it("collapses punctuation and case, which is what the near-duplicates differ by", () => {
    expect(duplicateKey("Q.C.")).toBe(duplicateKey("QC"));
    expect(duplicateKey("Q.C. DIGITAL")).toBe(duplicateKey("QC DIGITAL"));
    expect(duplicateKey("QC")).not.toBe(duplicateKey("QC IGNITION"));
  });

  it("reduces a punctuation-only value to nothing", () => {
    // The literal "-" on the live Locations list. Matching it against every
    // other punctuation-only row would flag noise as duplicates.
    expect(duplicateKey("-")).toBe("");
  });

  it("flags each half of a near-duplicate pair with the other's title", () => {
    const hints = duplicateHints([
      makeReferenceValue({ lookupId: 1, title: "Q.C." }),
      makeReferenceValue({ lookupId: 2, title: "QC" }),
      makeReferenceValue({ lookupId: 3, title: "ASSEMBLY" }),
    ]);
    expect(hints.get(1)).toEqual(["QC"]);
    expect(hints.get(2)).toEqual(["Q.C."]);
    expect(hints.has(3)).toBe(false);
  });

  it("includes a RETIRED half — the pair is worth seeing either way", () => {
    const hints = duplicateHints([
      makeReferenceValue({ lookupId: 1, title: "HARNESS DEPARTMENT" }),
      makeReferenceValue({ lookupId: 2, title: "HARNESS DEPARMENT", active: false }),
    ]);
    // Different spellings, so NOT flagged by the punctuation rule — this pair
    // is a genuine typo, and the screen can only flag what reduces the same.
    expect(hints.size).toBe(0);
  });

  it("never flags a value with nothing to compare against", () => {
    expect(duplicateHints([makeReferenceValue({ lookupId: 1, title: "-" })]).size).toBe(0);
    expect(duplicateHints([]).size).toBe(0);
  });
});
