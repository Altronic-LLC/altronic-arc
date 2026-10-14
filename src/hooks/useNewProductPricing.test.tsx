import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetPricingMockStores, pricingMockClone, pricingMockDb } from "@/data/pricingMockData";

// =============================================================================
// New Product Pricing hooks, in mock mode.
//   - worksheetSnapshot's figures, worked by hand;
//   - Save as new revision writes FRESH rows for rev + 1 and leaves the old
//     revision's rows exactly as they were;
//   - it needs a note, refuses a requester, and refuses a worksheet whose
//     revision moved on since it was opened.
// =============================================================================

const who = vi.hoisted(() => ({ person: { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com", lookupId: 2 } }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => who.person,
  useCurrentUserEmails: () => (who.person.email ? [who.person.email] : []),
}));

import { draftFrom } from "@/api/newProductSubAssemblies";
import { useSaveNewProductWorksheet, worksheetSnapshot, type WorksheetPricingInput } from "./useNewProductPricing";
import type { SubAssembly } from "@/types/pricing";

const MANAGER = { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com", lookupId: 2 };
const REQUESTER = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com", lookupId: 3 };

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const PRICING: WorksheetPricingInput = {
  overheadPct: 22,
  mpg: "IGN",
  distributorDiscountPct: 36,
  discountSource: "SAP",
  input: { kind: "gm", value: 45 },
  priceBreaks: [{ minQty: 10, discountPct: 5 }],
};

beforeEach(() => {
  __resetPricingMockStores();
  who.person = MANAGER;
});

describe("worksheetSnapshot", () => {
  // One sub-assembly, two per product: 2 × $10 (uploaded) + 1 × $30 adjusted to $20.
  const rows: SubAssembly[] = [
    {
      id: 1,
      worksheetId: 9,
      rev: 3,
      name: "Board",
      sortOrder: 1,
      quantityPerProduct: 2,
      lines: [
        { partNumber: "A", description: "", quantity: 2, uploadedCost: 10, adjustedCost: null },
        { partNumber: "B", description: "", quantity: 1, uploadedCost: 30, adjustedCost: 20 },
      ],
      linesCorrupt: false,
      fileName: "",
      uploadedAt: null,
      uploadedBy: null,
    },
  ];

  it("works cost, list price, base GM and breaks out from the rows as saved", () => {
    const { patch, snapshot } = worksheetSnapshot({
      rev: 3,
      rows,
      pricing: {
        overheadPct: 25,
        mpg: "IGN",
        distributorDiscountPct: 20,
        discountSource: "Manual",
        input: { kind: "gm", value: 50 },
        priceBreaks: [{ minQty: 10, discountPct: 10 }],
      },
      note: "why",
      savedBy: { displayName: "B", email: "b@x.com" },
      savedAt: "2026-10-13T00:00:00Z",
    });
    // used: (2×10 + 1×20) × 2 = 80, × 1.25 = 100. uploaded: (20 + 30) × 2 × 1.25 = 125.
    expect(patch.unitCost).toBeCloseTo(100, 6);
    expect(snapshot.uploadedUnitCost).toBeCloseTo(125, 6);
    // 100 ÷ 0.5 ÷ 0.8 = 250; the distributor pays 200, so the base GM is 50%.
    expect(patch.listPrice).toBe(250);
    expect(patch.baseGM).toBeCloseTo(50, 6);
    expect(patch.targetGM).toBe(50);
    expect(snapshot.rev).toBe(3);
    expect(snapshot.note).toBe("why");
    expect(snapshot.subAssemblies).toEqual([
      { name: "Board", quantityPerProduct: 2, lineCount: 2, uploadedCost: 50, cost: 40 },
    ]);
    // 10% off 250 = 225; the distributor pays 180 → (180 − 100) ÷ 180.
    expect(snapshot.priceBreaks).toHaveLength(1);
    expect(snapshot.priceBreaks[0].price).toBe(225);
    expect(snapshot.priceBreaks[0].baseGM).toBeCloseTo((80 / 180) * 100, 6);
  });

  it("a list-price input records no target GM", () => {
    const { patch } = worksheetSnapshot({
      rev: 1,
      rows,
      pricing: { ...PRICING, input: { kind: "list", value: 400 } },
      note: "",
      savedBy: { displayName: "B", email: "b@x.com" },
      savedAt: "2026-10-13T00:00:00Z",
    });
    expect(patch.targetGM).toBeNull();
    expect(patch.listPrice).toBe(400);
  });
});

describe("useSaveNewProductWorksheet", () => {
  function vars(overrides: { asNewRevision?: boolean; note?: string } = {}) {
    const worksheet = pricingMockClone(pricingMockDb.worksheets.find((w) => w.id === 1)!);
    const drafts = pricingMockDb.subAssemblies.filter((s) => s.worksheetId === 1 && s.rev === worksheet.rev).map(draftFrom);
    return { worksheet, drafts, pricing: PRICING, asNewRevision: true, note: "Cheaper enclosure", ...overrides };
  }

  it("Save as new revision creates NEW rows for rev + 1 and leaves the old revision's rows untouched", async () => {
    const before = pricingMockClone(pricingMockDb.subAssemblies);
    const { wrapper } = setup();
    const { result } = renderHook(() => useSaveNewProductWorksheet(), { wrapper });
    const saved = await act(() => result.current.mutateAsync(vars()));

    expect(saved.rev).toBe(3);
    // Every earlier row is still there, exactly as it was.
    for (const old of before) {
      expect(pricingMockDb.subAssemblies.find((s) => s.id === old.id)).toEqual(old);
    }
    const r3 = pricingMockDb.subAssemblies.filter((s) => s.worksheetId === 1 && s.rev === 3);
    expect(r3.map((s) => s.name)).toEqual(["Main board", "Output coil set", "Enclosure"]);
    const oldIds = new Set(before.map((s) => s.id));
    for (const row of r3) expect(oldIds.has(row.id)).toBe(false);
    expect(saved.history.at(-1)?.rev).toBe(3);
    expect(saved.history.at(-1)?.note).toBe("Cheaper enclosure");
  });

  it("a new revision REQUIRES a note — nothing is written", async () => {
    const before = pricingMockClone(pricingMockDb.subAssemblies);
    const { wrapper } = setup();
    const { result } = renderHook(() => useSaveNewProductWorksheet(), { wrapper });
    await act(() => expect(result.current.mutateAsync(vars({ note: "   " }))).rejects.toThrow(/what changed/));
    expect(pricingMockDb.subAssemblies).toEqual(before);
  });

  it("refuses a requester", async () => {
    who.person = REQUESTER;
    const before = pricingMockClone(pricingMockDb.subAssemblies);
    const { wrapper } = setup();
    const { result } = renderHook(() => useSaveNewProductWorksheet(), { wrapper });
    await act(() => expect(result.current.mutateAsync(vars())).rejects.toThrow(/managers and admins/));
    expect(pricingMockDb.subAssemblies).toEqual(before);
    expect(pricingMockDb.worksheets.find((w) => w.id === 1)?.rev).toBe(2);
  });

  it("refuses when the worksheet's revision moved on since it was opened", async () => {
    const stale = vars();
    pricingMockDb.worksheets = pricingMockDb.worksheets.map((w) => (w.id === 1 ? { ...w, rev: 3 } : w));
    const before = pricingMockClone(pricingMockDb.subAssemblies);
    const { wrapper } = setup();
    const { result } = renderHook(() => useSaveNewProductWorksheet(), { wrapper });
    await act(() => expect(result.current.mutateAsync(stale)).rejects.toThrow(/Someone saved R3/));
    expect(pricingMockDb.subAssemblies).toEqual(before);
  });
});
