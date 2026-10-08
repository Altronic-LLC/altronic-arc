import type { HarnessLogEntry, HarnessPartNumber } from "@/types/task";

// =============================================================================
// Sample Harness Production Log data, shaped like the cleaned Access import:
// real-looking part numbers, clock numbers in Built By / Visual Check, one
// retired part, one row carrying import notes, and rows in last year as well
// as this one so the year picker has something to show.
//
// Dated relative to the current year, so the default "this year" view is never
// empty in a demo.
// =============================================================================

export const MOCK_HARNESS_PART_NUMBERS: HarnessPartNumber[] = [
  { lookupId: 1, title: "593027-15", description: "Harness assembly", active: true, note: "" },
  { lookupId: 2, title: "593075-1", description: "", active: true, note: "" },
  { lookupId: 3, title: "593075-2", description: "", active: true, note: "" },
  { lookupId: 4, title: "783001", description: "", active: true, note: "" },
  { lookupId: 5, title: "793142-1", description: "", active: true, note: "" },
  { lookupId: 6, title: "EC93005-5", description: "Waukesha 295495F", active: true, note: "" },
  { lookupId: 7, title: "1013-4714-00", description: "", active: true, note: "" },
  {
    lookupId: 8,
    title: "593030-18",
    description: "",
    active: false,
    note: "Not built since 2019-03-04 — retired on import.",
  },
];

const year = new Date().getFullYear();
const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));
const ref = (id: number) => {
  const p = MOCK_HARNESS_PART_NUMBERS.find((x) => x.lookupId === id);
  return p ? { lookupId: p.lookupId, title: p.title } : null;
};

function entry(
  id: number,
  date: Date | null,
  partId: number | null,
  workOrder: string,
  quantity: number | null,
  more: Partial<HarnessLogEntry> = {},
): HarnessLogEntry {
  const part = partId === null ? null : ref(partId);
  return {
    id,
    title: part && workOrder ? `${part.title} / WO ${workOrder}` : part?.title ?? `WO ${workOrder}`,
    productionDate: date,
    workOrder,
    part,
    quantity,
    reworkQuantity: 0,
    comments: "",
    builtBy: "278",
    visualCheck: "",
    dataQualityNotes: "",
    createdAt: date ?? at(year, 1, 2),
    modifiedAt: date ?? at(year, 1, 2),
    ...more,
  };
}

export const MOCK_HARNESS_LOG: HarnessLogEntry[] = [
  entry(1, at(year, 1, 6), 2, "1002089401", 50),
  entry(2, at(year, 1, 6), 2, "1002089402", 50),
  entry(3, at(year, 1, 7), 7, "1002087964", 10, { comments: "HARN1", builtBy: "490", visualCheck: "490" }),
  entry(4, at(year, 1, 8), 5, "1001395632", 300, { builtBy: "278", visualCheck: "278" }),
  entry(5, at(year, 1, 9), 4, "1001416050", 36, { comments: "HARN1", builtBy: "342", visualCheck: "208" }),
  entry(6, at(year, 1, 9), 1, "1000209528", 25, { reworkQuantity: 2, comments: "Strands cut", builtBy: "342/208" }),
  entry(7, at(year, 1, 12), 6, "1000896123", 4, {
    builtBy: "PJ",
    dataQualityNotes:
      'Part Number typed as "295495F" — recorded as EC93005-5 (Waukesha number).\nDate typed as "1/12" — read from the rows around it.',
  }),
  entry(8, at(year, 1, 13), 3, "PARTS ORDER", 12, { builtBy: "171" }),
  entry(9, at(year - 1, 11, 18), 1, "1001932269", 40, { builtBy: "373" }),
  entry(10, at(year - 1, 11, 19), 8, "1000068378", 25, { builtBy: "323" }),
];
