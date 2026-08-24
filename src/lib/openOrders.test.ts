import { describe, it, expect } from "vitest";
import type { OpenOrderCustomerAccount, OpenOrderLine } from "@/types/task";
import {
  accountsWithNoLines,
  agingBucketFor,
  agingRows,
  byPromiseDate,
  customerReport,
  customerRollup,
  customerWorkbookName,
  daysBetween,
  isRepairLine,
  masterWorkbookName,
  metricsFor,
  runDateStamp,
  sameAccount,
  weekFolderName,
} from "./openOrders";

// =============================================================================
// Aging is measured on the PROMISE DATE against the RUN DATE (Ray, 2026-08-24).
// Both halves matter: the requested date is a different question, and "today"
// would make a report regenerated on Tuesday disagree with Monday's copy of
// itself.
// =============================================================================

const RUN = new Date("2026-08-24T12:00:00Z");

function line(over: Partial<OpenOrderLine> = {}): OpenOrderLine {
  return {
    soldTo: "1042",
    customerName: "PERMIAN MIDSTREAM PARTNERS LP",
    salesOrder: "4500118820",
    lineNo: "000010",
    material: "1025-9975-00",
    altronicPartNumber: "691768-1",
    description: "CPU-95 Ignition Module",
    orderType: "ZTA",
    repairOrder: "",
    orderQty: 10,
    shippedQty: 0,
    openQty: 10,
    unitPrice: 100,
    openValue: 1000,
    currency: "USD",
    customerPo: "",
    orderDate: new Date("2026-07-01T12:00:00Z"),
    requestedDate: new Date("2026-09-01T12:00:00Z"),
    promiseDate: new Date("2026-09-01T12:00:00Z"),
    shipTo: "1042",
    salesOffice: "0001",
    status: "A",
    deliveryBlock: "",
    rejectionReason: "",
    comments: "",
    commentDate: null,
    mrpController: "DC",
    createdBy: "U4AL_RB",
    ...over,
  };
}

function atOffset(days: number): Date {
  const d = new Date(RUN);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

describe("isRepairLine", () => {
  it("treats the live extract's literal 'repair' order type as a repair", () => {
    expect(isRepairLine(line({ orderType: "repair" }))).toBe(true);
  });

  it("treats ZS1 as a repair too — it's what people call these orders", () => {
    expect(isRepairLine(line({ orderType: "ZS1" }))).toBe(true);
  });

  it("ignores the case and padding SAP puts on an order type", () => {
    expect(isRepairLine(line({ orderType: " Repair " }))).toBe(true);
  });

  // The two signals agree on all 442 repair rows in the live extract, so a
  // repair-order number alone is enough even under an unfamiliar type.
  it("takes a repair order number as proof on its own", () => {
    expect(isRepairLine(line({ orderType: "ZRE", repairOrder: "4306713" }))).toBe(true);
  });

  it("leaves a standard order alone", () => {
    expect(isRepairLine(line())).toBe(false);
  });

  // THE REGRESSION THAT MATTERS. An earlier version matched "repair" in the
  // description as a safety net; the live extract has six priced ZTA lines
  // reading "REPAIR KIT, ALTRONIC V", and the match pulled $16,037 of one
  // customer's genuine parts backlog out of their standard table.
  it.each([
    "REPAIR KIT,              ALTRONIC V",
    "REPAIR KIT,              ALT V",
    "ALTRONIC REPAIR KIT,     ALTRK3U-F",
    "ALTRONIC REPAIR KIT,     ALTRK3BC",
  ])("keeps a priced repair-KIT part in the standard table: %s", (description) => {
    expect(isRepairLine(line({ orderType: "ZTA", description, repairOrder: "" }))).toBe(false);
  });

  it("doesn't read the description at all, however much it says repair", () => {
    expect(
      isRepairLine(line({ orderType: "ZTA", description: "repair repair repair", repairOrder: "" })),
    ).toBe(false);
  });
});

describe("daysBetween", () => {
  it("counts whole days forward", () => {
    expect(daysBetween(RUN, atOffset(5))).toBe(5);
  });

  it("goes negative backwards", () => {
    expect(daysBetween(RUN, atOffset(-3))).toBe(-3);
  });

  // A date-only value held at midnight against one held at midday is still the
  // same day; rounding on UTC day boundaries is what makes that true.
  it("ignores the time of day", () => {
    expect(daysBetween(new Date("2026-08-24T23:30:00Z"), new Date("2026-08-25T00:30:00Z"))).toBe(1);
  });
});

describe("agingBucketFor", () => {
  it("calls yesterday past due", () => {
    expect(agingBucketFor(line({ promiseDate: atOffset(-1) }), RUN)).toBe("Past due");
  });

  // Promised for today is not late yet — the boundary people argue about.
  it("does NOT call today past due", () => {
    expect(agingBucketFor(line({ promiseDate: atOffset(0) }), RUN)).toBe("0–30 days");
  });

  it.each([
    [30, "0–30 days"],
    [31, "31–60 days"],
    [60, "31–60 days"],
    [61, "61–90 days"],
    [90, "61–90 days"],
    [91, "90+ days"],
    [400, "90+ days"],
  ])("puts day %i in %s", (offset, bucket) => {
    expect(agingBucketFor(line({ promiseDate: atOffset(offset) }), RUN)).toBe(bucket);
  });

  // "SAP doesn't know" is a real state. Folding it into past due would inflate
  // the number the whole report leads with.
  it("gives a line with no promise date its own bucket", () => {
    expect(agingBucketFor(line({ promiseDate: null }), RUN)).toBe("No promise date");
  });
});

describe("agingRows", () => {
  it("emits every bucket even when empty, so the table doesn't change shape", () => {
    const rows = agingRows([line({ promiseDate: atOffset(-2) })], RUN);
    expect(rows.map((r) => r.bucket)).toEqual([
      "Past due",
      "0–30 days",
      "31–60 days",
      "61–90 days",
      "90+ days",
      "No promise date",
    ]);
    expect(rows.find((r) => r.bucket === "0–30 days")).toMatchObject({ lines: 0, openValue: 0 });
  });

  it("sums qty and value into the right bucket", () => {
    const rows = agingRows(
      [
        line({ promiseDate: atOffset(-2), openQty: 3, openValue: 300 }),
        line({ promiseDate: atOffset(-9), openQty: 4, openValue: 400 }),
        line({ promiseDate: atOffset(45), openQty: 5, openValue: 500 }),
      ],
      RUN,
    );
    expect(rows.find((r) => r.bucket === "Past due")).toMatchObject({
      lines: 2,
      openQty: 7,
      openValue: 700,
    });
    expect(rows.find((r) => r.bucket === "31–60 days")).toMatchObject({ lines: 1, openValue: 500 });
  });
});

describe("metricsFor", () => {
  const lines = [
    line({ salesOrder: "A", promiseDate: atOffset(-5), openQty: 2, openValue: 250.5 }),
    line({ salesOrder: "A", promiseDate: atOffset(10), openQty: 3, openValue: 300 }),
    line({ salesOrder: "B", promiseDate: atOffset(70), openQty: 1, openValue: 99.5, orderType: "ZS1" }),
    line({ salesOrder: "C", promiseDate: null, openQty: 4, openValue: 400 }),
  ];

  it("totals lines, qty and value", () => {
    const m = metricsFor(lines, RUN);
    expect(m.lines).toBe(4);
    expect(m.openQty).toBe(10);
    expect(m.openValue).toBe(1050);
  });

  it("counts distinct sales orders, not lines", () => {
    expect(metricsFor(lines, RUN).orders).toBe(3);
  });

  it("leads with past due", () => {
    const m = metricsFor(lines, RUN);
    expect(m.pastDueLines).toBe(1);
    expect(m.pastDueValue).toBe(250.5);
  });

  it("splits the repairs out", () => {
    const m = metricsFor(lines, RUN);
    expect(m.repairLines).toBe(1);
    expect(m.repairValue).toBe(99.5);
  });

  // Every repair line in the live extract is unpriced, so "repairs = $0" is
  // the data rather than a fault — but it has to be countable, or the split
  // reads as broken.
  it("counts the unpriced lines so a zero repair value can be explained", () => {
    const m = metricsFor(
      [line({ unitPrice: 0, openValue: 0, orderType: "repair" }), line({ openValue: 500 })],
      RUN,
    );
    expect(m.unpricedLines).toBe(1);
    expect(m.repairValue).toBe(0);
  });

  it("takes the soonest promise date, ignoring the undated line", () => {
    expect(metricsFor(lines, RUN).nextPromiseDate).toEqual(atOffset(-5));
  });

  it("is all zeros for nothing, rather than throwing", () => {
    const m = metricsFor([], RUN);
    expect(m).toMatchObject({ lines: 0, openValue: 0, pastDueValue: 0, orders: 0 });
    expect(m.nextPromiseDate).toBeNull();
    expect(m.aging).toHaveLength(6);
  });

  // Floats accumulate: a dashboard total that disagrees with the sum of its own
  // rows by a penny costs more trust than the rounding saves effort.
  it("rounds money to cents so the totals tie out", () => {
    const m = metricsFor([line({ openValue: 0.1 }), line({ openValue: 0.2 })], RUN);
    expect(m.openValue).toBe(0.3);
  });

  it("treats a non-finite value as zero rather than poisoning the total", () => {
    expect(metricsFor([line({ openValue: Number.NaN }), line({ openValue: 5 })], RUN).openValue).toBe(5);
  });
});

describe("byPromiseDate", () => {
  it("sorts soonest first", () => {
    const sorted = [line({ promiseDate: atOffset(9) }), line({ promiseDate: atOffset(1) })].sort(
      byPromiseDate,
    );
    expect(sorted[0].promiseDate).toEqual(atOffset(1));
  });

  // Undated lines last: they're the ones nobody can act on, and putting them
  // first buries the dates people came to read.
  it("puts undated lines at the end", () => {
    const sorted = [
      line({ promiseDate: null, salesOrder: "Z" }),
      line({ promiseDate: atOffset(3), salesOrder: "A" }),
    ].sort(byPromiseDate);
    expect(sorted.map((l) => l.salesOrder)).toEqual(["A", "Z"]);
  });

  it("falls back to the order number so the sort is stable", () => {
    const sorted = [
      line({ promiseDate: atOffset(3), salesOrder: "B" }),
      line({ promiseDate: atOffset(3), salesOrder: "A" }),
    ].sort(byPromiseDate);
    expect(sorted.map((l) => l.salesOrder)).toEqual(["A", "B"]);
  });

  it("orders two undated lines by order number too", () => {
    const sorted = [
      line({ promiseDate: null, salesOrder: "B" }),
      line({ promiseDate: null, salesOrder: "A" }),
    ].sort(byPromiseDate);
    expect(sorted.map((l) => l.salesOrder)).toEqual(["A", "B"]);
  });
});

describe("sameAccount", () => {
  // SAP pads sold-to numbers; the managed list is typed by a person. This is
  // the join that silently finds nothing if it's done naively.
  it("matches across SAP's leading zeros", () => {
    expect(sameAccount("0001042", "1042")).toBe(true);
  });

  it("ignores surrounding space and case", () => {
    expect(sameAccount(" ab12 ", "AB12")).toBe(true);
  });

  it("doesn't match two different accounts", () => {
    expect(sameAccount("1042", "1043")).toBe(false);
  });

  // Two blanks are not the same customer — that would put every unmatched line
  // on whichever account happens to have an empty number.
  it("never matches on empty", () => {
    expect(sameAccount("", "")).toBe(false);
    expect(sameAccount("0000", "")).toBe(false);
  });
});

describe("customerReport", () => {
  const account: OpenOrderCustomerAccount = {
    id: 1,
    accountNumber: "1042",
    customerName: "Permian Midstream Partners",
    regionalManager: "Paul McHenry",
    active: true,
    notes: "",
  };
  const lines = [
    line({ soldTo: "0001042", salesOrder: "A", promiseDate: atOffset(20) }),
    line({ soldTo: "0001042", salesOrder: "B", promiseDate: atOffset(2), orderType: "ZS1" }),
    line({ soldTo: "0001042", salesOrder: "C", promiseDate: atOffset(-4) }),
    line({ soldTo: "9999", salesOrder: "OTHER" }),
  ];

  it("takes only that customer's lines, across the zero padding", () => {
    const report = customerReport(account, lines, RUN);
    expect(report.metrics.lines).toBe(3);
    expect([...report.standardLines, ...report.repairLines].map((l) => l.salesOrder)).not.toContain(
      "OTHER",
    );
  });

  it("splits repairs into their own table", () => {
    const report = customerReport(account, lines, RUN);
    expect(report.standardLines.map((l) => l.salesOrder)).toEqual(["C", "A"]);
    expect(report.repairLines.map((l) => l.salesOrder)).toEqual(["B"]);
  });

  // The list holds the customer-facing spelling; SAP holds whatever was typed
  // when the account was opened. The file is named after the former.
  it("prefers the managed list's name over the extract's", () => {
    expect(customerReport(account, lines, RUN).customerName).toBe("Permian Midstream Partners");
  });

  it("falls back to the extract's name when the list hasn't got one", () => {
    const report = customerReport({ ...account, customerName: "  " }, lines, RUN);
    expect(report.customerName).toBe("PERMIAN MIDSTREAM PARTNERS LP");
  });

  it("falls back to the account number when neither has a name", () => {
    const report = customerReport({ ...account, customerName: "" }, [], RUN);
    expect(report.customerName).toBe("1042");
  });
});

describe("customerRollup", () => {
  it("groups by account and sorts by open value, biggest first", () => {
    const rollup = customerRollup(
      [
        line({ soldTo: "1", customerName: "Small", openValue: 100 }),
        line({ soldTo: "2", customerName: "Big", openValue: 900 }),
        line({ soldTo: "0000002", customerName: "Big", openValue: 100 }),
      ],
      RUN,
    );
    expect(rollup.map((r) => r.customerName)).toEqual(["Big", "Small"]);
    expect(rollup[0].metrics.openValue).toBe(1000);
  });

  it("is empty for an empty extract", () => {
    expect(customerRollup([], RUN)).toEqual([]);
  });
});

describe("accountsWithNoLines", () => {
  const accounts: OpenOrderCustomerAccount[] = [
    { id: 1, accountNumber: "1042", customerName: "Has lines", regionalManager: "", active: true, notes: "" },
    { id: 2, accountNumber: "6612", customerName: "Nothing open", regionalManager: "", active: true, notes: "" },
    { id: 3, accountNumber: "7788", customerName: "Retired", regionalManager: "", active: false, notes: "" },
  ];

  // A customer expecting a report weekly and getting nothing is
  // indistinguishable from a broken run, so this is reported, not skipped.
  it("names the active accounts the extract had nothing for", () => {
    const gaps = accountsWithNoLines(accounts, [line({ soldTo: "1042" })]);
    expect(gaps.map((a) => a.customerName)).toEqual(["Nothing open"]);
  });

  it("ignores inactive accounts — they're off the run deliberately", () => {
    const gaps = accountsWithNoLines(accounts, []);
    expect(gaps.map((a) => a.accountNumber)).toEqual(["1042", "6612"]);
  });
});

describe("filenames", () => {
  it("stamps the master file with the run date", () => {
    expect(masterWorkbookName(RUN)).toBe("Altronic_Open_Orders_Dashboard_2026-08-24.xlsx");
  });

  it("stamps the run date, not today", () => {
    expect(runDateStamp(new Date("2026-01-05T23:00:00Z"))).toBe("2026-01-05");
  });

  it("names a customer file to the pattern", () => {
    expect(customerWorkbookName("Cimarron Compression", RUN)).toBe(
      "Cimarron_Compression_Open_Orders_2026-08-24.xlsx",
    );
  });

  it.each(["\\", "/", ":", "*", "?", '"', "<", ">", "|", "#"])(
    "strips %s, which Windows and SharePoint reject",
    (ch) => {
      expect(customerWorkbookName(`Acme${ch}Gas`, RUN)).toBe("AcmeGas_Open_Orders_2026-08-24.xlsx");
    },
  );

  it("collapses spaces to single underscores", () => {
    expect(customerWorkbookName("Bayou   Gas  Co", RUN)).toBe(
      "Bayou_Gas_Co_Open_Orders_2026-08-24.xlsx",
    );
  });

  // Legal in a JS string, rejected by Windows at save time.
  it("drops a trailing dot or space", () => {
    expect(customerWorkbookName("Acme Inc. ", RUN)).toBe("Acme_Inc_Open_Orders_2026-08-24.xlsx");
  });

  it("keeps & and , which are legal", () => {
    expect(customerWorkbookName("Bayou Gas & Compression, Inc", RUN)).toBe(
      "Bayou_Gas_&_Compression,_Inc_Open_Orders_2026-08-24.xlsx",
    );
  });

  // The NAME is truncated, never the date: two files differing only past
  // character 100 still have to be told apart by the day they were run.
  it("holds the whole name under 100 characters, keeping the date", () => {
    const name = customerWorkbookName("A".repeat(200), RUN);
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith("_Open_Orders_2026-08-24.xlsx")).toBe(true);
  });

  it("still produces a usable name when the customer name is all illegal characters", () => {
    expect(customerWorkbookName("///", RUN)).toBe("Customer_Open_Orders_2026-08-24.xlsx");
  });
});

describe("weekFolderName", () => {
  // Monday, so a re-run on Wednesday lands in the same folder as Monday's
  // rather than scattering one week over three folders.
  it.each([
    ["2026-08-24", "Monday"],
    ["2026-08-26", "Wednesday"],
    ["2026-08-28", "Friday"],
    ["2026-08-30", "Sunday"],
  ])("puts %s (%s) in the week starting Monday 2026-08-24", (date) => {
    expect(weekFolderName(new Date(`${date}T12:00:00Z`))).toBe("Week of 2026-08-24");
  });

  it("rolls to the previous Monday across a month boundary", () => {
    expect(weekFolderName(new Date("2026-09-01T12:00:00Z"))).toBe("Week of 2026-08-31");
  });
});
