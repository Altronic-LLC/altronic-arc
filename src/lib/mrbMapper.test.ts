import { describe, it, expect } from "vitest";
import {
  compareMrbEntries,
  expectedPricePerIssue,
  formatMoney,
  isArchivedMrbEntry,
  mrbLabel,
  mrbState,
  mrbYearOptions,
  needsDisposition,
  pricePerIssueDisagrees,
  toMrbEntry,
  toNumber,
} from "./mrbMapper";
import type { GraphListItem, MrbEntry } from "@/types/task";

function entry(over: Partial<MrbEntry> = {}): MrbEntry {
  return {
    id: 1,
    sapNumber: "1000-0001-00",
    mrbDate: new Date("2026-09-08T12:00:00Z"),
    oldPartNumber: "",
    quantity: null,
    description: "",
    reason: "",
    whereCaused: "",
    disposition: "",
    vendorName: "",
    pricePerUnit: null,
    pricePerIssue: null,
    notes: "",
    comments: [],
    watchers: [],
    dataFormat: "Current",
    sourceYear: 2026,
    provenance: {},
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
    ...over,
  };
}

describe("toMrbEntry", () => {
  it("reads Title as the SAP Number", () => {
    const item = {
      id: "4",
      fields: { Title: "1000-0317-00", field_12: "Legacy" },
    } as unknown as GraphListItem;
    expect(toMrbEntry(item).sapNumber).toBe("1000-0317-00");
  });

  it("reads the number columns as numbers, not the floats Graph sends", () => {
    const item = {
      id: "1",
      fields: { field_3: 29.0, field_9: 3.1, field_10: 89.9, field_13: 2026.0 },
    } as unknown as GraphListItem;
    const e = toMrbEntry(item);
    expect(e.quantity).toBe(29);
    expect(e.pricePerUnit).toBe(3.1);
    expect(e.pricePerIssue).toBe(89.9);
    expect(e.sourceYear).toBe(2026);
  });

  it("collects the (Legacy) columns into provenance", () => {
    const item = {
      id: "1",
      fields: { field_15: "MS", field_16: "SCRAP", field_23: "2" },
    } as unknown as GraphListItem;
    const e = toMrbEntry(item);
    expect(e.provenance.whereDetectedLegacy).toBe("MS");
    expect(e.provenance.sapActionLegacy).toBe("SCRAP");
    expect(e.provenance.sourceWorkbookRow).toBe("2");
  });

  // The live rows sit at 04:00Z (midnight EDT) and 05:00Z (midnight EST);
  // three outliers sit at 22:00Z / 23:00Z. The midday pivot has to read all
  // four as the day the SharePoint list view shows.
  it.each([
    ["2018-02-14T05:00:00Z", "2018-02-14"], // midnight EST
    ["2026-07-14T04:00:00Z", "2026-07-14"], // midnight EDT
    ["2026-05-20T23:00:00Z", "2026-05-21"], // outlier, site ahead of UTC
    ["2026-05-20T22:00:00Z", "2026-05-21"],
  ])("parses %s as %s", (stored, expected) => {
    const item = { id: "1", fields: { field_1: stored } } as unknown as GraphListItem;
    expect(toMrbEntry(item).mrbDate?.toISOString().slice(0, 10)).toBe(expected);
  });
});

describe("toNumber", () => {
  it("keeps a real zero, and maps blank to null", () => {
    // 0 is a reading somebody took; "" is one nobody did. Not the same.
    expect(toNumber(0)).toBe(0);
    expect(toNumber("")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });

  it("tolerates a currency string", () => {
    expect(toNumber("$1,234.56")).toBe(1234.56);
  });

  it("is null for something that isn't a number at all", () => {
    expect(toNumber("see notes")).toBeNull();
  });
});

describe("mrbState / needsDisposition", () => {
  it("calls a Legacy row archived whatever its disposition says", () => {
    expect(mrbState(entry({ dataFormat: "Legacy", disposition: "" }))).toBe("archived");
    expect(mrbState(entry({ dataFormat: "Legacy", disposition: "Scrap" }))).toBe("archived");
  });

  it("is case- and space-tolerant about the Legacy flag", () => {
    expect(isArchivedMrbEntry(entry({ dataFormat: " legacy " }))).toBe(true);
  });

  it("separates 'nobody has looked' from 'looked, not decided'", () => {
    expect(mrbState(entry({ disposition: "" }))).toBe("undecided");
    expect(mrbState(entry({ disposition: "To be Determined" }))).toBe("pending");
  });

  it("counts both as needing a disposition", () => {
    expect(needsDisposition(entry({ disposition: "" }))).toBe(true);
    expect(needsDisposition(entry({ disposition: "To be Determined" }))).toBe(true);
  });

  it("does NOT chase a decided entry, or an archive row", () => {
    expect(needsDisposition(entry({ disposition: "Scrap" }))).toBe(false);
    // An archive row is history — it is never work, however blank it is.
    expect(needsDisposition(entry({ dataFormat: "Legacy", disposition: "" }))).toBe(false);
  });
});

describe("expectedPricePerIssue", () => {
  it("is unit x quantity, rounded to the cent", () => {
    expect(expectedPricePerIssue(3.1, 29)).toBe(89.9);
    expect(expectedPricePerIssue(30.75, 8)).toBe(246);
    expect(expectedPricePerIssue(4.06, 4)).toBe(16.24);
  });

  it("is null when either side is unknown", () => {
    expect(expectedPricePerIssue(null, 4)).toBeNull();
    expect(expectedPricePerIssue(4, null)).toBeNull();
  });

  it("flags an archive row whose stored total disagrees", () => {
    // A real row: 3 x 102.00 stored as 102.00.
    expect(pricePerIssueDisagrees(entry({ quantity: 3, pricePerUnit: 102, pricePerIssue: 102 }))).toBe(true);
  });

  it("does not flag a row that agrees, or one missing a figure", () => {
    expect(pricePerIssueDisagrees(entry({ quantity: 8, pricePerUnit: 30.75, pricePerIssue: 246 }))).toBe(false);
    expect(pricePerIssueDisagrees(entry({ quantity: null, pricePerIssue: 246 }))).toBe(false);
  });
});

describe("formatMoney", () => {
  it("renders a null as a dash — an unknown price is not free", () => {
    expect(formatMoney(null)).toBe("—");
  });

  it("renders a genuine zero as money, not as a dash", () => {
    expect(formatMoney(0)).toMatch(/0/);
    expect(formatMoney(0)).not.toBe("—");
  });
});

describe("compareMrbEntries", () => {
  it("puts the newest MRB date first and sinks undated rows", () => {
    const older = entry({ id: 1, mrbDate: new Date("2020-01-01T12:00:00Z") });
    const newer = entry({ id: 2, mrbDate: new Date("2026-01-01T12:00:00Z") });
    const undated = entry({ id: 3, mrbDate: null });
    expect([older, undated, newer].sort(compareMrbEntries).map((e) => e.id)).toEqual([2, 1, 3]);
  });
});

describe("mrbLabel", () => {
  it("falls back through SAP number, description, then the id", () => {
    expect(mrbLabel(entry({ sapNumber: "1000-1" }))).toBe("1000-1");
    expect(mrbLabel(entry({ sapNumber: "", description: "End Cap" }))).toBe("End Cap");
    expect(mrbLabel(entry({ id: 7, sapNumber: "", description: "" }))).toBe("MRB #7");
  });
});

describe("mrbYearOptions", () => {
  it("lists distinct years, newest first", () => {
    const entries = [
      entry({ id: 1, mrbDate: new Date("2018-02-14T12:00:00Z") }),
      entry({ id: 2, mrbDate: new Date("2026-07-14T12:00:00Z") }),
      entry({ id: 3, mrbDate: new Date("2018-06-01T12:00:00Z") }),
      entry({ id: 4, mrbDate: null }),
    ];
    expect(mrbYearOptions(entries)).toEqual(["2026", "2018"]);
  });
});
