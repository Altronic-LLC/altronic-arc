import { beforeEach, describe, expect, it } from "vitest";
import * as partsApi from "./altronicParts";
import * as componentsApi from "./altronicComponents";
import { listAltronicParts } from "./altronicParts";
import { listAltronicComponents } from "./altronicComponents";
import { MOCK_ALTRONIC_COMPONENTS, MOCK_ALTRONIC_PARTS } from "@/data/altronicPartsMockData";
import { COMPONENT_PREFIX_CATEGORY, partPrefix } from "@/lib/altronicPartMapper";
import { deletionReason, partEvent } from "@/lib/partLifecycle";
import * as datasheetsApi from "./datasheets";

describe("Parts List API (mock mode)", () => {
  it("returns every mock part, sorted by part number", async () => {
    const parts = await listAltronicParts();
    expect(parts).toHaveLength(MOCK_ALTRONIC_PARTS.length);
    const numbers = parts.map((p) => p.partNumber);
    expect(numbers).toEqual([...numbers].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  });

  it("returns copies, so a caller can't mutate the fixtures", async () => {
    const parts = await listAltronicParts();
    parts[0].description = "changed";
    expect((await listAltronicParts())[0].description).not.toBe("changed");
  });

  it("returns every mock component", async () => {
    expect(await listAltronicComponents()).toHaveLength(MOCK_ALTRONIC_COMPONENTS.length);
  });

  it("keeps the mock data on the right list for its prefix", () => {
    // The same split the load script makes — a fixture on the wrong list would
    // demo a part the real app looks for somewhere else.
    for (const p of MOCK_ALTRONIC_PARTS) {
      expect(COMPONENT_PREFIX_CATEGORY[partPrefix(p.partNumber) ?? ""]).toBeUndefined();
    }
    for (const c of MOCK_ALTRONIC_COMPONENTS) {
      expect(c.category).toBe(COMPONENT_PREFIX_CATEGORY[partPrefix(c.partNumber) ?? ""]);
    }
  });

  it("has exactly ONE delete per list — and it blanks the row, never removes it", () => {
    // Inverted deliberately (Tim, 2026-09-28): the SAP admin deletes a part
    // number so it can be REUSED, which needs the row kept. There is still no
    // way to remove a row from ARC.
    expect(Object.keys(partsApi).filter((k) => /delete|remove/i.test(k))).toEqual(["deleteAltronicPart"]);
    expect(Object.keys(componentsApi).filter((k) => /delete|remove/i.test(k))).toEqual(["deleteAltronicComponent"]);
  });
});

describe("Deleting a part number, and reusing it (mock mode)", () => {
  const sheila = { displayName: "Sheila Horn", email: "sheila.horn@altronic-llc.com" };
  const brandon = { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com" };

  beforeEach(() => {
    partsApi.__resetAltronicPartsMockStore();
    componentsApi.__resetAltronicComponentsMockStore();
    datasheetsApi.__resetDatasheetsMockStore();
  });

  it("keeps the row, blanks every field, and marks it Deleted with who, when and why", async () => {
    // Mock part 4: 204602, Keystone, legacy 204#17, with a datasheet.
    const before = await listAltronicParts();
    const deleted = await partsApi.deleteAltronicPart(4, "204602", "Raised by mistake", sheila);

    expect(await listAltronicParts()).toHaveLength(before.length);
    expect(deleted).toMatchObject({
      id: 4,
      partNumber: "204602",
      description: "DELETED",
      signOffStatus: "Deleted",
      manufacturer: "",
      mfgPartNumber: "",
      assignedBy: "",
      purchased: null,
      dateAssigned: null,
      // Kept, so the load script's top-up doesn't bring the legacy row back.
      legacySource: "204#17",
    });
    const record = partEvent(deleted.comments, "deleted")!;
    expect(record.authorName).toBe("Sheila Horn");
    expect(deletionReason(record)).toBe("Raised by mistake");
  });

  it("moves the datasheet out of the folder, so the next part doesn't inherit it", async () => {
    expect(await datasheetsApi.findDatasheet("204602")).not.toBeNull();
    await partsApi.deleteAltronicPart(4, "204602", "Obsolete", sheila);
    expect(await datasheetsApi.findDatasheet("204602")).toBeNull();
  });

  it("refuses without a reason, twice, or for a number that has changed", async () => {
    await expect(partsApi.deleteAltronicPart(4, "204602", "  ", sheila)).rejects.toThrow(/Say why/);
    await expect(partsApi.deleteAltronicPart(4, "999999", "x", sheila)).rejects.toThrow(/changed since/);
    await partsApi.deleteAltronicPart(4, "204602", "x", sheila);
    await expect(partsApi.deleteAltronicPart(4, "204602", "x", sheila)).rejects.toThrow(/already deleted/);
  });

  it("no longer counts a deleted number as taken", async () => {
    expect(await partsApi.partNumberTaken("204602")).toBe(true);
    await partsApi.deleteAltronicPart(4, "204602", "x", sheila);
    expect(await partsApi.partNumberTaken("204602")).toBe(false);
  });

  it("reuses the SAME row for a new part on that number — every field replaced, history fresh", async () => {
    await partsApi.deleteAltronicPart(4, "204602", "Raised by mistake", sheila);
    const before = await listAltronicParts();
    const reused = await partsApi.createAltronicPart(
      { partNumber: "204602", description: "Terminal - Ring - #10", assignedBy: "BM", purchased: "Purchased", prototypeOrProduction: "Production" },
      brandon,
    );

    // No second row: the number is on the list once.
    expect(await listAltronicParts()).toHaveLength(before.length);
    expect(reused.id).toBe(4);
    expect(reused).toMatchObject({
      description: "Terminal - Ring - #10",
      assignedBy: "BM",
      signOffStatus: "Pending SAP",
      legacySource: "",
      // Nothing from the old Keystone part survives.
      manufacturer: "",
      mfgPartNumber: "",
    });
    // The history starts again, with the reuse — and names the new submitter.
    expect(reused.comments).toHaveLength(1);
    expect(partEvent(reused.comments, "reused")).not.toBeNull();
    expect(reused.createdBy?.displayName).toBe("Brandon Mirto");
  });

  it("still refuses a number a LIVE part holds", async () => {
    await expect(partsApi.createAltronicPart({ partNumber: "204602" }, brandon)).rejects.toThrow(/already on the parts list/);
  });

  it("does the same on the Component List, keeping its Category and clearing Has Data Sheet", async () => {
    // Mock component 5: 601466, Through Hole, flagged with a datasheet.
    const deleted = await componentsApi.deleteAltronicComponent(5, "601466", "Duplicate of 601467", sheila);
    expect(deleted).toMatchObject({ description: "DELETED", signOffStatus: "Deleted", category: "Through Hole", hasDataSheet: false, mfgName: "" });
    expect(await componentsApi.componentNumberTaken("601466")).toBe(false);

    const reused = await componentsApi.createAltronicComponent({ partNumber: "601466", description: "RESISTOR", mfgName: "VISHAY" }, brandon);
    expect(reused).toMatchObject({ id: 5, category: "Through Hole", signOffStatus: "Pending Engineering Review", mfgName: "VISHAY", ratingA: "" });
  });
});

describe("Parts List writes (mock mode)", () => {
  const actor = { displayName: "Demo User", email: "demo.user@altronic-llc.com" };

  beforeEach(() => {
    partsApi.__resetAltronicPartsMockStore();
    componentsApi.__resetAltronicComponentsMockStore();
  });

  it("creates a part at Pending SAP, with the submitter", async () => {
    const created = await partsApi.createAltronicPart({ partNumber: "604700", description: "New connector" }, actor);
    expect(created).toMatchObject({ partNumber: "604700", signOffStatus: "Pending SAP", legacySource: "" });
    expect(created.createdBy?.email).toBe("demo.user@altronic-llc.com");
    expect((await listAltronicParts()).some((p) => p.partNumber === "604700")).toBe(true);
  });

  it("refuses a taken number", async () => {
    await expect(partsApi.createAltronicPart({ partNumber: "604596" }, actor)).rejects.toThrow(/already/);
  });

  it("creates a component at Pending Engineering Review, category from the prefix", async () => {
    const created = await componentsApi.createAltronicComponent({ partNumber: "611900", description: "RESISTOR" }, actor);
    expect(created).toMatchObject({ category: "Through Hole", signOffStatus: "Pending Engineering Review" });
  });

  it("walks a component through both approvals, recording each in its history", async () => {
    // Mock component 17: 701990, Pending Engineering Review.
    const reviewed = await componentsApi.approveAltronicComponent(17, "Pending Engineering Review", "Looks right", actor);
    expect(reviewed.signOffStatus).toBe("Pending SAP");
    const done = await componentsApi.approveAltronicComponent(17, "Pending SAP", "", actor);
    expect(done.signOffStatus).toBe("Approved");
    expect(done.comments).toHaveLength(2);
    // Newest first.
    expect(done.comments[0].bodyHtml).toContain("Added to SAP");
    expect(done.comments[1].bodyHtml).toContain("Looks right");
  });

  it("won't approve a step twice", async () => {
    await componentsApi.approveAltronicComponent(17, "Pending Engineering Review", "", actor);
    await expect(
      componentsApi.approveAltronicComponent(17, "Pending Engineering Review", "", actor),
    ).rejects.toThrow(/already moved on/);
  });

  it("won't drag a legacy part into the approval chain", async () => {
    // Mock part 9 is a loaded row with no sign-off.
    await expect(partsApi.approveAltronicPart(9, "Pending SAP", "", actor)).rejects.toThrow();
  });

  it("updates only what it's given", async () => {
    const updated = await partsApi.updateAltronicPart(9, { sapNumber: "1000-0009-00" });
    expect(updated).toMatchObject({ sapNumber: "1000-0009-00", manufacturer: "Panduit" });
  });
});
