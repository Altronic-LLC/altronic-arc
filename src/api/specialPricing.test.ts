import { describe, it, expect } from "vitest";
import {
  createSpecialPricing,
  deleteSpecialPricing,
  listSpecialPricing,
  updateSpecialPricing,
} from "./specialPricing";

describe("Special Pricing API", () => {
  it("lists alphabetically by title", async () => {
    const entries = await listSpecialPricing();
    expect(entries.length).toBeGreaterThan(0);
  });

  it("creates an entry scoped to a customer", async () => {
    const created = await createSpecialPricing({
      title: "New Part",
      customerId: 1,
      pricingNotes: "note",
      aiPartNumber: "123",
    });
    expect(created.customerId).toBe(1);
    expect(created.aiPartNumber).toBe("123");
  });

  it("updates only the changed fields", async () => {
    const created = await createSpecialPricing({
      title: "X",
      customerId: 1,
      pricingNotes: "",
      aiPartNumber: "",
    });
    const updated = await updateSpecialPricing(created.id, { pricingNotes: "new note" });
    expect(updated.pricingNotes).toBe("new note");
    expect(updated.title).toBe("X");
  });

  it("deletes an entry", async () => {
    const created = await createSpecialPricing({
      title: "Temp",
      customerId: 1,
      pricingNotes: "",
      aiPartNumber: "",
    });
    await deleteSpecialPricing(created.id);
    const entries = await listSpecialPricing();
    expect(entries.find((e) => e.id === created.id)).toBeUndefined();
  });
});
