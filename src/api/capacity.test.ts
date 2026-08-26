import { describe, it, expect } from "vitest";
import { createCapacity, deleteCapacity, listCapacity, updateCapacity } from "./capacity";

describe("Capacity API", () => {
  it("lists alphabetically by part number", async () => {
    const entries = await listCapacity();
    expect(entries.length).toBeGreaterThan(0);
  });

  it("creates an entry scoped to a customer", async () => {
    const created = await createCapacity({
      partNumber: "1000-0000-00",
      customerId: 1,
      description: "Test part",
      weeklyMax: 100,
      notes: "",
      customerPartNumber: "",
    });
    expect(created.customerId).toBe(1);
    expect(created.weeklyMax).toBe(100);
  });

  it("updates only the changed fields", async () => {
    const created = await createCapacity({
      partNumber: "X",
      customerId: 1,
      description: "",
      weeklyMax: null,
      notes: "",
      customerPartNumber: "",
    });
    const updated = await updateCapacity(created.id, { weeklyMax: 50 });
    expect(updated.weeklyMax).toBe(50);
    expect(updated.partNumber).toBe("X");
  });

  it("deletes an entry", async () => {
    const created = await createCapacity({
      partNumber: "Temp",
      customerId: 1,
      description: "",
      weeklyMax: null,
      notes: "",
      customerPartNumber: "",
    });
    await deleteCapacity(created.id);
    const entries = await listCapacity();
    expect(entries.find((e) => e.id === created.id)).toBeUndefined();
  });
});
