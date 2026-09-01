import { describe, expect, it } from "vitest";
import type { Equipment, MaintenanceReferenceValue } from "@/types/task";
import { makeAsset } from "@/test/maintenanceFixtures";
import {
  ASSET_GAPS,
  EMPTY_ASSET_FILTERS,
  NO_VALUE,
  activeOrCurrent,
  applyAssetFilters,
  assetChoiceOptions,
  assetEditInput,
  assetGapCounts,
  assetGaps,
  assetHaystack,
  assetReferenceOptions,
  blankAssetEditInput,
  buildAssetCreateFields,
  buildAssetUpdateFields,
  hasActiveAssetFilters,
  isRetiredAsset,
  machineHoursText,
  needsAttention,
  parseMachineHours,
  sortAssets,
} from "./assetRegister";

// =============================================================================
// The asset register's rules.
//
// The register is HALF EMPTY on the live list, and the screen exists to say so
// — so most of what is worth testing here is what counts as a gap, what
// deliberately does NOT, and that the write payload can never send the two
// values that would corrupt a row (the unmigrated lookup sentinel, and a
// no-op).
// =============================================================================

const MACH: MaintenanceReferenceValue = {
  lookupId: 4,
  title: "MACH SHOP",
  active: true,
  note: "",
};
const QC: MaintenanceReferenceValue = { lookupId: 9, title: "QC", active: true, note: "" };
const OLD_DEPT: MaintenanceReferenceValue = {
  lookupId: 12,
  title: "Q.C.",
  active: false,
  note: "",
};

/** A complete row — every case below breaks exactly one thing off it. */
function complete(over: Partial<Equipment> = {}): Equipment {
  return makeAsset({
    lookupId: 1,
    name: "20 HP COMPRESSOR",
    assetTag: "AC-020",
    currentMachineHours: 1800,
    department: { lookupId: 4, title: "MACH SHOP" },
    location: { lookupId: 31, title: "COMPRESSOR ROOM" },
    criticality: "Critical",
    assetStatus: "In Service",
    ...over,
  });
}

describe("what counts as a gap", () => {
  it("finds nothing wrong with a complete row", () => {
    expect(assetGaps(complete())).toEqual([]);
    expect(needsAttention(complete())).toBe(false);
  });

  it.each(ASSET_GAPS)("flags a missing %s", (gap) => {
    const broken: Record<string, Partial<Equipment>> = {
      machineHours: { currentMachineHours: null },
      department: { department: null },
      criticality: { criticality: null },
      assetTag: { assetTag: "" },
      location: { location: null },
    };
    expect(assetGaps(complete(broken[gap]))).toEqual([gap]);
  });

  // The distinction the whole meter-PM story rests on. A machine sitting at
  // zero hours HAS been read; one that has never been read has not, and only
  // the second is something for somebody to go and do.
  it("treats zero machine hours as a real reading, not a gap", () => {
    expect(assetGaps(complete({ currentMachineHours: 0 }))).toEqual([]);
    expect(assetGaps(complete({ currentMachineHours: null }))).toEqual(["machineHours"]);
  });

  it("counts a whitespace-only asset tag as missing", () => {
    expect(assetGaps(complete({ assetTag: "   " }))).toEqual(["assetTag"]);
  });

  // A machine that has left the plant does not need its meter read, its tag
  // chased or its department decided. Counting it would park permanent,
  // un-fixable rows in a queue that exists to be worked down to nothing.
  it("never flags a RETIRED asset, however empty it is", () => {
    const retired = makeAsset({ lookupId: 2, assetStatus: "Retired" });
    expect(assetGaps(retired)).toEqual([]);
    expect(needsAttention(retired)).toBe(false);
    expect(isRetiredAsset(retired)).toBe(true);
  });

  it("matches Retired case-insensitively — the column holds imported values", () => {
    expect(isRetiredAsset(makeAsset({ lookupId: 3, assetStatus: "retired" }))).toBe(true);
    expect(isRetiredAsset(makeAsset({ lookupId: 3, assetStatus: " RETIRED " }))).toBe(true);
    expect(isRetiredAsset(makeAsset({ lookupId: 3, assetStatus: "In Service" }))).toBe(false);
  });

  it("counts each gap across the whole register", () => {
    const counts = assetGapCounts([
      complete(),
      complete({ lookupId: 2, department: null }),
      complete({ lookupId: 3, department: null, currentMachineHours: null }),
      makeAsset({ lookupId: 4, assetStatus: "Retired" }),
    ]);
    expect(counts.department).toBe(2);
    expect(counts.machineHours).toBe(1);
    expect(counts.assetTag).toBe(0);
  });
});

describe("filters", () => {
  const rows = [
    complete({ lookupId: 1, name: "20 HP COMPRESSOR" }),
    complete({
      lookupId: 2,
      name: "REFLOW OVEN",
      department: { lookupId: 9, title: "QC" },
      criticality: "Standard",
      currentMachineHours: null,
    }),
    complete({ lookupId: 3, name: "FADAL 6030", department: null, assetStatus: "Down" }),
  ];

  it("is empty by default and matches everything", () => {
    expect(hasActiveAssetFilters(EMPTY_ASSET_FILTERS)).toBe(false);
    expect(applyAssetFilters(rows, EMPTY_ASSET_FILTERS)).toHaveLength(3);
  });

  it("filters by department, and by the ABSENCE of one", () => {
    expect(
      applyAssetFilters(rows, { ...EMPTY_ASSET_FILTERS, department: "9" }).map((r) => r.lookupId),
    ).toEqual([2]);
    // The "No department" option is how somebody gets from the coverage
    // number to the actual rows behind it.
    expect(
      applyAssetFilters(rows, { ...EMPTY_ASSET_FILTERS, department: NO_VALUE }).map(
        (r) => r.lookupId,
      ),
    ).toEqual([3]);
  });

  it("filters by one named gap", () => {
    expect(
      applyAssetFilters(rows, { ...EMPTY_ASSET_FILTERS, gap: "machineHours" }).map(
        (r) => r.lookupId,
      ),
    ).toEqual([2]);
  });

  it("filters by 'needs attention' across every gap at once", () => {
    expect(
      applyAssetFilters(rows, { ...EMPTY_ASSET_FILTERS, needsAttention: true }).map(
        (r) => r.lookupId,
      ),
    ).toEqual([2, 3]);
  });

  it("filters by status and criticality", () => {
    expect(
      applyAssetFilters(rows, { ...EMPTY_ASSET_FILTERS, status: "Down" }).map((r) => r.lookupId),
    ).toEqual([3]);
    expect(
      applyAssetFilters(rows, { ...EMPTY_ASSET_FILTERS, criticality: "Standard" }).map(
        (r) => r.lookupId,
      ),
    ).toEqual([2]);
  });

  // People arrive with a serial off a nameplate or a tag off the machine, not
  // with the SharePoint Title.
  it("searches every field somebody might arrive with", () => {
    const asset = complete({ serialNo: "J3855U91F", modelNumber: "R20i", assetTag: "AC-020" });
    for (const q of ["J3855U91F", "R20i", "AC-020", "MACH SHOP", "compressor"]) {
      expect(applyAssetFilters([asset], { ...EMPTY_ASSET_FILTERS, q }), q).toHaveLength(1);
    }
    expect(applyAssetFilters([asset], { ...EMPTY_ASSET_FILTERS, q: "nothing" })).toHaveLength(0);
  });

  it("matches every word of a multi-word search, in any order", () => {
    const asset = complete({ name: "REFLOW OVEN #2" });
    expect(applyAssetFilters([asset], { ...EMPTY_ASSET_FILTERS, q: "oven reflow" })).toHaveLength(1);
    expect(applyAssetFilters([asset], { ...EMPTY_ASSET_FILTERS, q: "oven kitamura" })).toHaveLength(
      0,
    );
  });

  it("includes the department name in the haystack", () => {
    expect(assetHaystack(complete())).toContain("MACH SHOP");
  });
});

describe("sorting", () => {
  it("puts the rows somebody can go and fix at the top", () => {
    const rows = [
      complete({ lookupId: 1, name: "AAA" }),
      complete({ lookupId: 2, name: "BBB", department: null, assetTag: "" }),
      complete({ lookupId: 3, name: "CCC", currentMachineHours: null }),
    ];
    expect(sortAssets(rows, "gaps").map((r) => r.lookupId)).toEqual([2, 3, 1]);
  });

  it("sorts alphabetically by default", () => {
    const rows = [complete({ lookupId: 1, name: "ZED" }), complete({ lookupId: 2, name: "ACE" })];
    expect(sortAssets(rows, "name").map((r) => r.name)).toEqual(["ACE", "ZED"]);
  });

  // A row nobody has ever edited is the stalest case there is, so it leads.
  it("sorts the least-recently-edited first, never-edited ahead of everything", () => {
    const rows = [
      complete({ lookupId: 1, name: "A", modifiedAt: new Date("2026-08-20T00:00:00Z") }),
      complete({ lookupId: 2, name: "B", modifiedAt: new Date("2024-01-01T00:00:00Z") }),
      complete({ lookupId: 3, name: "C", modifiedAt: null }),
    ];
    expect(sortAssets(rows, "hours").map((r) => r.lookupId)).toEqual([3, 2, 1]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [complete({ lookupId: 2, name: "ZED" }), complete({ lookupId: 1, name: "ACE" })];
    sortAssets(rows, "name");
    expect(rows.map((r) => r.lookupId)).toEqual([2, 1]);
  });
});

describe("filter options", () => {
  const rows = [
    complete({ lookupId: 1, department: { lookupId: 4, title: "MACH SHOP" } }),
    complete({ lookupId: 2, department: { lookupId: 9, title: "QC" } }),
    complete({ lookupId: 3, department: null }),
  ];

  it("builds department options from the ROWS, with a 'none' entry", () => {
    expect(assetReferenceOptions(rows, (a) => a.department, "No department")).toEqual([
      { value: NO_VALUE, label: "No department" },
      { value: "4", label: "MACH SHOP" },
      { value: "9", label: "QC" },
    ]);
  });

  it("omits the 'none' entry when every row has a value", () => {
    const options = assetReferenceOptions(rows.slice(0, 2), (a) => a.department, "No department");
    expect(options.some((o) => o.value === NO_VALUE)).toBe(false);
  });

  it("orders a known choice set by its own order, not alphabetically", () => {
    const assets = [
      complete({ lookupId: 1, criticality: "Standard" }),
      complete({ lookupId: 2, criticality: "Critical" }),
      complete({ lookupId: 3, criticality: "Important" }),
    ];
    expect(
      assetChoiceOptions(assets, (a) => a.criticality, "Not set", [
        "Critical",
        "Important",
        "Standard",
      ]).map((o) => o.value),
    ).toEqual(["Critical", "Important", "Standard"]);
  });

  it("keeps an imported value the choice order doesn't know about", () => {
    const assets = [
      complete({ lookupId: 1, criticality: "Critical" }),
      complete({ lookupId: 2, criticality: "LEGACY-A" }),
    ];
    expect(
      assetChoiceOptions(assets, (a) => a.criticality, "Not set", ["Critical"]).map((o) => o.value),
    ).toEqual(["Critical", "LEGACY-A"]);
  });
});

describe("the picker's options for an EDIT", () => {
  it("offers only Active values", () => {
    expect(activeOrCurrent([MACH, QC, OLD_DEPT], null)).toEqual([MACH, QC]);
  });

  // A row pointing at a retired value keeps it in its own picker: dropping it
  // would quietly clear the field on the next save.
  it("keeps a RETIRED value the row already points at", () => {
    expect(activeOrCurrent([MACH, QC, OLD_DEPT], { lookupId: 12, title: "Q.C." })).toEqual([
      OLD_DEPT,
      MACH,
      QC,
    ]);
  });

  it("doesn't duplicate a current value that is already active", () => {
    expect(activeOrCurrent([MACH, QC], { lookupId: 4, title: "MACH SHOP" })).toEqual([MACH, QC]);
  });
});

describe("the write payload", () => {
  it("sends nothing at all when nothing changed", () => {
    const asset = complete();
    expect(buildAssetUpdateFields(assetEditInput(asset), asset)).toEqual({});
  });

  it("sends only the columns that moved", () => {
    const asset = complete();
    const input = { ...assetEditInput(asset), assetTag: "AC-021", criticality: "Important" };
    expect(buildAssetUpdateFields(input, asset)).toEqual({
      AssetTag: "AC-021",
      Criticality: "Important",
    });
  });

  it("writes a single lookup as a BARE integer", () => {
    const asset = complete();
    const input = { ...assetEditInput(asset), departmentLookupId: 9 };
    expect(buildAssetUpdateFields(input, asset)).toEqual({ DepartmentRefLookupId: 9 });
  });

  it("clears a lookup with null", () => {
    const asset = complete();
    const input = { ...assetEditInput(asset), locationLookupId: null };
    expect(buildAssetUpdateFields(input, asset)).toEqual({ LocationRefLookupId: null });
  });

  // lookupId 0 is the UNMIGRATED sentinel — a value read out of the legacy
  // choice column that matches no reference row. SharePoint item ids start at
  // 1, so writing it back would be a write of a row that cannot exist.
  it("carries an unmigrated value through an unrelated edit untouched", () => {
    const asset = complete({ department: { lookupId: 0, title: "OLD DEPT" } });
    const input = assetEditInput(asset);
    expect(input.departmentLookupId).toBe(0);
    expect(buildAssetUpdateFields({ ...input, assetTag: "NEW" }, asset)).toEqual({
      AssetTag: "NEW",
    });
  });

  // Belt and braces. The picker can't produce this — `referenceOptions` only
  // offers a "0" option when the row already holds one — but a stale draft or
  // a caller built by hand could, and the sentinel must never reach SharePoint
  // as a row id whatever the previous value was.
  it("NEVER writes 0 as a lookupId, even against a row that had none", () => {
    const asset = complete({ department: null });
    expect(
      buildAssetUpdateFields({ ...assetEditInput(asset), departmentLookupId: 0 }, asset),
    ).toEqual({});
  });

  it("still lets an unmigrated value be CLEARED or replaced", () => {
    const asset = complete({ department: { lookupId: 0, title: "OLD DEPT" } });
    expect(
      buildAssetUpdateFields({ ...assetEditInput(asset), departmentLookupId: null }, asset),
    ).toEqual({ DepartmentRefLookupId: null });
    expect(
      buildAssetUpdateFields({ ...assetEditInput(asset), departmentLookupId: 4 }, asset),
    ).toEqual({ DepartmentRefLookupId: 4 });
  });

  it("writes machine hours, including a deliberate clear and a genuine zero", () => {
    const asset = complete({ currentMachineHours: 1800 });
    expect(
      buildAssetUpdateFields({ ...assetEditInput(asset), currentMachineHours: null }, asset),
    ).toEqual({ CurrentMachineHours: null });
    expect(
      buildAssetUpdateFields({ ...assetEditInput(asset), currentMachineHours: 0 }, asset),
    ).toEqual({ CurrentMachineHours: 0 });
  });

  it("writes date-only columns at midday UTC", () => {
    const asset = complete({ installDate: null });
    expect(
      buildAssetUpdateFields(
        { ...assetEditInput(asset), installDate: new Date("2026-03-04T00:00:00Z") },
        asset,
      ),
    ).toEqual({ InstallDate: "2026-03-04T12:00:00Z" });
  });

  it("doesn't rewrite a date whose DAY is unchanged", () => {
    const asset = complete({ installDate: new Date("2026-03-04T12:00:00Z") });
    expect(
      buildAssetUpdateFields(
        { ...assetEditInput(asset), installDate: new Date("2026-03-04T06:00:00Z") },
        asset,
      ),
    ).toEqual({});
  });

  it("trims text, and treats a whitespace-only edit as no change", () => {
    const asset = complete({ assetTag: "AC-020" });
    expect(buildAssetUpdateFields({ ...assetEditInput(asset), assetTag: " AC-020 " }, asset)).toEqual(
      {},
    );
    expect(buildAssetUpdateFields({ ...assetEditInput(asset), assetTag: " AC-021 " }, asset)).toEqual(
      { AssetTag: "AC-021" },
    );
  });

  it("clears a choice column with null rather than an empty string", () => {
    const asset = complete({ criticality: "Critical" });
    expect(buildAssetUpdateFields({ ...assetEditInput(asset), criticality: "" }, asset)).toEqual({
      Criticality: null,
    });
  });
});

describe("the blank form for a new asset", () => {
  it("defaults Asset Status to In Service, not blank", () => {
    expect(blankAssetEditInput().assetStatus).toBe("In Service");
  });

  it("leaves every other field empty or unset", () => {
    const input = blankAssetEditInput();
    expect(input.name).toBe("");
    expect(input.assetTag).toBe("");
    expect(input.departmentLookupId).toBeNull();
    expect(input.locationLookupId).toBeNull();
    expect(input.currentMachineHours).toBeNull();
    expect(input.installDate).toBeNull();
    expect(input.warrantyExpiry).toBeNull();
  });
});

describe("the create payload", () => {
  it("sends every field, not just the ones that changed — there's nothing to diff against", () => {
    const input = { ...blankAssetEditInput(), name: "New Compressor", assetTag: "AC-999" };
    const fields = buildAssetCreateFields(input);
    expect(fields.Title).toBe("New Compressor");
    expect(fields.AssetTag).toBe("AC-999");
    expect(fields.AssetStatus).toBe("In Service");
  });

  it("trims text fields", () => {
    const fields = buildAssetCreateFields({ ...blankAssetEditInput(), name: "  Padded Name  " });
    expect(fields.Title).toBe("Padded Name");
  });

  it("sends null, not an empty string, for a blank choice column", () => {
    const fields = buildAssetCreateFields(blankAssetEditInput());
    expect(fields.EquipmentType).toBeNull();
    expect(fields.Criticality).toBeNull();
  });

  it("includes a department/location lookup when one was picked", () => {
    const fields = buildAssetCreateFields({
      ...blankAssetEditInput(),
      departmentLookupId: 4,
      locationLookupId: 12,
    });
    expect(fields.DepartmentRefLookupId).toBe(4);
    expect(fields.LocationRefLookupId).toBe(12);
  });

  it("never writes lookupId 0 — the unmigrated sentinel, not a real row id", () => {
    const fields = buildAssetCreateFields({
      ...blankAssetEditInput(),
      departmentLookupId: 0,
      locationLookupId: 0,
    });
    expect(fields.DepartmentRefLookupId).toBeUndefined();
    expect(fields.LocationRefLookupId).toBeUndefined();
  });

  it("omits the lookup keys entirely when nothing was picked, rather than sending null", () => {
    // Unlike an edit, a create has no existing value to clear — so a blank
    // pick on a brand-new row just means "don't set this column at all".
    const fields = buildAssetCreateFields(blankAssetEditInput());
    expect("DepartmentRefLookupId" in fields).toBe(false);
    expect("LocationRefLookupId" in fields).toBe(false);
  });

  it("carries machine hours and dates through untouched", () => {
    const install = new Date("2026-01-15T12:00:00Z");
    const fields = buildAssetCreateFields({
      ...blankAssetEditInput(),
      currentMachineHours: 500,
      installDate: install,
    });
    expect(fields.CurrentMachineHours).toBe(500);
    expect(fields.InstallDate).toBe("2026-01-15T12:00:00Z");
  });
});

describe("parsing what somebody typed into the hours box", () => {
  it("reads a number", () => {
    expect(parseMachineHours("1800")).toEqual({ ok: true, value: 1800 });
    expect(parseMachineHours(" 12.5 ")).toEqual({ ok: true, value: 12.5 });
  });

  // Blank is a deliberate clear, and it is NOT zero — the same distinction the
  // column itself carries.
  it("reads blank as a clear, never as zero", () => {
    expect(parseMachineHours("")).toEqual({ ok: true, value: null });
    expect(parseMachineHours("   ")).toEqual({ ok: true, value: null });
    expect(parseMachineHours("0")).toEqual({ ok: true, value: 0 });
  });

  it("refuses anything that isn't a non-negative number", () => {
    expect(parseMachineHours("abc").ok).toBe(false);
    expect(parseMachineHours("-5").ok).toBe(false);
    expect(parseMachineHours("12 hours").ok).toBe(false);
  });

  it("renders a stored reading, and blank for a missing one", () => {
    expect(machineHoursText(complete({ currentMachineHours: 1800 }))).toBe("1800");
    expect(machineHoursText(complete({ currentMachineHours: 0 }))).toBe("0");
    expect(machineHoursText(complete({ currentMachineHours: null }))).toBe("");
  });
});
