import { describe, it, expect, beforeEach } from "vitest";
import * as equipmentApi from "./operationsEquipment";
import {
  createEquipment,
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

describe("createEquipment", () => {
  it("adds a new row that then shows up in listEquipment", async () => {
    const before = await listEquipment();
    const created = await createEquipment({
      Title: "New Test Press",
      AssetTag: "TP-001",
      Description: "",
      Manufacturer: "",
      ModelNumber: "",
      SerialNo: "",
      EquipmentType: null,
      Criticality: null,
      AssetStatus: "In Service",
      CurrentMachineHours: null,
      InstallDate: null,
      WarrantyExpiry: null,
    });
    expect(created.name).toBe("New Test Press");
    expect(created.assetTag).toBe("TP-001");
    expect(created.assetStatus).toBe("In Service");

    const after = await listEquipment();
    expect(after.length).toBe(before.length + 1);
    expect(after.find((e) => e.lookupId === created.lookupId)?.name).toBe("New Test Press");
  });

  it("assigns a lookupId one higher than the current max, never reusing one", async () => {
    const before = await listEquipment();
    const maxId = Math.max(...before.map((e) => e.lookupId));
    const created = await createEquipment({ Title: "Another Asset" });
    expect(created.lookupId).toBe(maxId + 1);
  });

  it("resolves a DepartmentRefLookupId to a real department, same as an edit does", async () => {
    const departments = (await listEquipment())
      .map((e) => e.department)
      .filter((d): d is NonNullable<typeof d> => d !== null);
    // Pick a department some existing row already carries, so we know it's a
    // real, active reference-list value rather than guessing an id.
    const dept = departments[0];
    const created = await createEquipment({
      Title: "Departmental Asset",
      DepartmentRefLookupId: dept.lookupId,
    });
    expect(created.department?.lookupId).toBe(dept.lookupId);
    expect(created.department?.title).toBe(dept.title);
  });

  it("stamps modifiedAt, same as every other write", async () => {
    const created = await createEquipment({ Title: "Freshly Added" });
    expect(created.modifiedAt).not.toBeNull();
  });
});

describe("what this module deliberately does NOT offer", () => {
  it("still has no delete — a row is retired (AssetStatus), never removed", () => {
    const offenders = Object.keys(equipmentApi).filter((name) => /^(delete|remove)/i.test(name));
    expect(offenders).toEqual([]);
  });

  // Create DOES exist (added 2026-09-01) — this is the deliberate-absence
  // test's counterpart, pinning that the one function this module offers is
  // named the way every other create function in this codebase is.
  it("offers exactly one create function, named createEquipment", () => {
    const offenders = Object.keys(equipmentApi).filter((name) => /^create/i.test(name));
    expect(offenders).toEqual(["createEquipment"]);
  });
});
