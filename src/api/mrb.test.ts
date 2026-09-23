import { describe, it, expect, beforeEach, vi } from "vitest";

// The MOCK branch. `USE_MOCK` is forced on rather than left to the ambient
// environment: a developer with `VITE_USE_MOCK=false` in their `.env.local`
// (which is the normal setup for testing against the real list) would
// otherwise run these against Graph and get a wall of "Not signed in".
// The REAL branch's request shapes are pinned in mrb.diffedWrite.test.ts.
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: true, SP_MRB_LIST_ID: "mrb-list" };
});

import * as mrbApi from "./mrb";
import { __resetMrbMockStore, createMrbEntry, getMrbEntry, listMrbEntries, updateMrbEntry } from "./mrb";
import { isArchivedMrbEntry, mrbEntryInput, needsDisposition } from "@/lib/mrbMapper";

beforeEach(() => {
  __resetMrbMockStore();
});

describe("the module's surface", () => {
  // An MRB entry is the record of material that was rejected and what was
  // decided about it, and 2,863 of the rows are retained Excel history.
  // Correcting one is an edit. The absence of a delete is the point, so a
  // future screen can't quietly acquire one.
  it("exports no delete of any kind", () => {
    const exported = Object.keys(mrbApi).filter((k) => /delete|remove/i.test(k));
    expect(exported).toEqual([]);
  });
});

describe("listMrbEntries", () => {
  it("returns both live and archive rows — the view splits them, not the API", async () => {
    const entries = await listMrbEntries();
    expect(entries.some((e) => isArchivedMrbEntry(e))).toBe(true);
    expect(entries.some((e) => !isArchivedMrbEntry(e))).toBe(true);
  });

  it("is sorted newest MRB date first", async () => {
    const entries = await listMrbEntries();
    const times = entries.map((e) => e.mrbDate?.getTime() ?? -Infinity);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("includes live entries with no disposition — the work queue", async () => {
    const entries = await listMrbEntries();
    expect(entries.filter(needsDisposition).length).toBeGreaterThan(0);
  });
});

describe("createMrbEntry", () => {
  it("stamps a new entry as live, never Legacy", async () => {
    const created = await createMrbEntry({
      sapNumber: "1000-9999-00",
      mrbDate: new Date("2026-09-20T12:00:00Z"),
      oldPartNumber: "",
      quantity: 2,
      description: "Test part",
      reason: "Cracked housing",
      whereCaused: "Vendor",
      disposition: "",
      vendorName: "Acme",
      pricePerUnit: 10,
      pricePerIssue: 20,
      notes: "",
    });

    expect(created.dataFormat).toBe("Current");
    expect(isArchivedMrbEntry(created)).toBe(false);
    // Blank disposition means it lands in the queue, which is the default.
    expect(needsDisposition(created)).toBe(true);
    expect(created.sourceYear).toBe(2026);
  });

  it("puts the new entry in the list", async () => {
    const before = (await listMrbEntries()).length;
    await createMrbEntry({
      sapNumber: "1000-9998-00",
      mrbDate: new Date("2026-09-20T12:00:00Z"),
      oldPartNumber: "",
      quantity: null,
      description: "",
      reason: "Bent pin",
      whereCaused: "",
      disposition: "",
      vendorName: "",
      pricePerUnit: null,
      pricePerIssue: null,
      notes: "",
    });
    expect((await listMrbEntries()).length).toBe(before + 1);
  });
});

describe("updateMrbEntry", () => {
  it("records a disposition, taking the entry out of the queue", async () => {
    const entries = await listMrbEntries();
    const target = entries.find(needsDisposition)!;

    const updated = await updateMrbEntry(
      target.id,
      { ...mrbEntryInput(target), disposition: "Scrap" },
      target,
    );

    expect(updated.disposition).toBe("Scrap");
    expect(needsDisposition(updated)).toBe(false);
    expect((await getMrbEntry(target.id))?.disposition).toBe("Scrap");
  });

  it("leaves Data Format alone, so editing an archive row keeps it archived", async () => {
    const entries = await listMrbEntries();
    const archived = entries.find(isArchivedMrbEntry)!;

    const updated = await updateMrbEntry(
      archived.id,
      { ...mrbEntryInput(archived), notes: "checked against the 2018 workbook" },
      archived,
    );

    expect(updated.dataFormat).toBe("Legacy");
    expect(isArchivedMrbEntry(updated)).toBe(true);
  });

  it("throws for an entry that isn't there", async () => {
    const entries = await listMrbEntries();
    await expect(
      updateMrbEntry(999999, mrbEntryInput(entries[0]), entries[0]),
    ).rejects.toThrow(/not found/i);
  });
});
