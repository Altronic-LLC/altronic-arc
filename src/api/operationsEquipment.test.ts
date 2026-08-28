import { describe, it, expect, beforeEach } from "vitest";
import * as equipmentApi from "./operationsEquipment";
import {
  getEquipment,
  listEquipment,
  listOperationsEquipment,
  resetEquipmentMockStore,
  setEquipmentAssetStatus,
  setEquipmentResponsibleTech,
  setEquipmentWarrantyExpiry,
  updateEquipmentFields,
} from "./operationsEquipment";

// USE_MOCK is true under Vitest — these exercise the in-memory store.

beforeEach(() => {
  resetEquipmentMockStore();
});

describe("the two shapes of one list", () => {
  it("listOperationsEquipment still returns the bare `{ lookupId, title }` contract", async () => {
    // The Operations task form's Equipment picker has always spoken this
    // shape. Widening it for the CMMS must not change it.
    const refs = await listOperationsEquipment();
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(Object.keys(ref).sort()).toEqual(["lookupId", "title"]);
    }
  });

  it("both readers see the SAME rows, so a work order and a task agree", async () => {
    const [refs, full] = await Promise.all([listOperationsEquipment(), listEquipment()]);
    expect(refs.map((r) => r.lookupId).sort()).toEqual(full.map((e) => e.lookupId).sort());
    expect(refs.map((r) => r.title).sort()).toEqual(full.map((e) => e.name).sort());
  });

  it("sorts alphabetically by name", async () => {
    const names = (await listEquipment()).map((e) => e.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });
});

describe("the register", () => {
  it("carries the assets named in the live schema snapshot", async () => {
    const names = (await listEquipment()).map((e) => e.name);
    for (const asset of ["TM1", "20 HP COMPRESSOR", "40 HP COMPRESSOR", "5000 DIGITAL"]) {
      expect(names).toContain(asset);
    }
  });

  it("resolves a sub-assembly's parent asset name", async () => {
    const dryer = (await listEquipment()).find((e) => e.parentAsset);
    expect(dryer?.parentAsset?.title).toBeTruthy();
  });

  it("reads one back by id, and null for one that isn't there", async () => {
    const [first] = await listEquipment();
    expect((await getEquipment(first.lookupId))?.name).toBe(first.name);
    expect(await getEquipment(987654)).toBeNull();
  });
});

describe("the two edits a technician makes from a work order", () => {
  it("marks an asset down and back in service", async () => {
    const [asset] = await listEquipment();
    expect((await setEquipmentAssetStatus(asset.lookupId, "Down")).assetStatus).toBe("Down");
    expect((await setEquipmentAssetStatus(asset.lookupId, "In Service")).assetStatus).toBe(
      "In Service",
    );
  });

  it("moves the responsible tech, and clears it", async () => {
    const [asset] = await listEquipment();
    const tech = { displayName: "Alyssa Garrett", email: "a.g@altronic-llc.com", lookupId: 63 };
    expect((await setEquipmentResponsibleTech(asset.lookupId, tech)).responsibleTech).toEqual(tech);
    expect((await setEquipmentResponsibleTech(asset.lookupId, null)).responsibleTech).toBeNull();
  });

  it("writes a warranty expiry at midday UTC so no browser shifts the day", async () => {
    const [asset] = await listEquipment();
    const updated = await setEquipmentWarrantyExpiry(
      asset.lookupId,
      new Date("2027-01-31T00:00:00Z"),
    );
    expect(updated.warrantyExpiry?.toISOString()).toBe("2027-01-31T12:00:00.000Z");
    expect((await setEquipmentWarrantyExpiry(asset.lookupId, null)).warrantyExpiry).toBeNull();
  });

  it("throws for an asset that isn't there", async () => {
    await expect(updateEquipmentFields(987654, { AssetStatus: "Down" })).rejects.toThrow(
      /not found/,
    );
  });
});

describe("what this module deliberately does NOT offer", () => {
  it("has no create and no delete — the register is maintained in SharePoint", () => {
    const offenders = Object.keys(equipmentApi).filter((name) =>
      /^(create|delete|remove)/i.test(name),
    );
    expect(offenders).toEqual([]);
  });
});
