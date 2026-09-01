import { describe, it, expect } from "vitest";
import type { Equipment, GraphListItem, Person } from "@/types/task";
import {
  EQUIPMENT_SELECT,
  attachEquipmentPeople,
  attachEquipmentReferences,
  attachParentAssetTitles,
  compareEquipment,
  equipmentLabel,
  equipmentReference,
  toEquipment,
} from "./equipmentMapper";

function item(fields: Record<string, unknown>, id = "2"): GraphListItem {
  return {
    id,
    createdDateTime: "2025-01-22T14:19:08Z",
    lastModifiedDateTime: "2025-01-22T14:19:08Z",
    fields: fields as GraphListItem["fields"],
  };
}

describe("EQUIPMENT_SELECT", () => {
  it("asks for BOTH halves of ResponsibleTech and ParentAsset", () => {
    const parts = EQUIPMENT_SELECT.split(",");
    for (const column of ["ResponsibleTech", "ParentAsset"]) {
      expect(parts).toContain(column);
      expect(parts).toContain(`${column}LookupId`);
    }
  });
});

describe("toEquipment", () => {
  it("maps a live-shaped row", () => {
    // Field values taken from the schema snapshot's own sample rows.
    const e = toEquipment(
      item({
        Title: "20 HP COMPRESSOR",
        Description: "INGERSOLL RAND 20HP ROTARY SCREW",
        SerialNo: "J3855U91F",
        EquipmentType: "AIRCOMP",
        Department: "MACH SHOP",
        Location: "PANELS",
        Criticality: "Critical",
        AssetStatus: "In Service",
        Manufacturer: "Ingersoll Rand",
        ModelNumber: "R20i",
        Attachments: false,
      }),
    );
    expect(e.lookupId).toBe(2);
    expect(e.name).toBe("20 HP COMPRESSOR");
    expect(e.equipmentType).toBe("AIRCOMP");
    expect(e.assetStatus).toBe("In Service");
    expect(e.hasAttachments).toBe(false);
  });

  it("keeps a choice value it doesn't recognise rather than dropping it", () => {
    // 378 rows of imported legacy data on fill-in-enabled choice columns. A
    // value ARC has never heard of must still render, or the asset looks blank.
    const e = toEquipment(item({ EquipmentType: "STEAM HAMMER" }));
    expect(e.equipmentType).toBe("STEAM HAMMER");
  });

  // -------------------------------------------------------------------------
  // Department / Location — single LOOKUPS since 2026-08-28, with the legacy
  // choice columns kept on THIS list only, as a fallback and a rollback path.
  // -------------------------------------------------------------------------

  it("selects both halves of each lookup AND the legacy choice columns", () => {
    const parts = EQUIPMENT_SELECT.split(",");
    for (const column of ["DepartmentRef", "LocationRef"]) {
      expect(parts).toContain(column);
      expect(parts).toContain(`${column}LookupId`);
    }
    // The Equipment List still HAS these; the two work-order lists never did.
    expect(parts).toContain("Department");
    expect(parts).toContain("Location");
  });

  it("prefers the lookup over the legacy choice column", () => {
    const e = toEquipment(
      item({ DepartmentRefLookupId: 6, Department: "SOMETHING STALE" }),
    );
    expect(e.department).toEqual({ lookupId: 6, title: "" });
  });

  it("falls back to the legacy choice column when the lookup is empty", () => {
    // 13 of 378 rows had neither value at migration, and a row edited through
    // the old column in SharePoint would otherwise read as unset.
    const e = toEquipment(item({ Location: "OFF SITE" }));
    expect(e.location).toEqual({ lookupId: 0, title: "OFF SITE" });
  });

  it("UPGRADES a legacy value whose text matches a reference row", () => {
    // So it buckets and filters with every migrated row rather than beside
    // them — see `attachReference` in lib/maintenanceReferences.ts.
    const equipment = [toEquipment(item({ Department: "PROD" }))];
    attachEquipmentReferences(
      equipment,
      [{ lookupId: 6, title: "PROD", active: true, note: "" }],
      [],
    );
    expect(equipment[0].department).toEqual({ lookupId: 6, title: "PROD" });
  });

  it("leaves a legacy value matching nothing exactly as it is, still visible", () => {
    const equipment = [toEquipment(item({ Department: "OFF THE BOOKS" }))];
    attachEquipmentReferences(equipment, [], []);
    expect(equipment[0].department).toEqual({ lookupId: 0, title: "OFF THE BOOKS" });
  });

  it("reads neither column set as null", () => {
    const e = toEquipment(item({}));
    expect(e.department).toBeNull();
    expect(e.location).toBeNull();
  });

  it("reads an empty choice as unset", () => {
    const e = toEquipment(item({ Criticality: "   " }));
    expect(e.criticality).toBeNull();
  });

  it("reads a bare ResponsibleTech lookupId and a bare ParentAsset lookup", () => {
    const e = toEquipment(item({ ResponsibleTechLookupId: 24, ParentAssetLookupId: 3 }));
    expect(e.responsibleTech).toEqual({ displayName: "", lookupId: 24 });
    expect(e.parentAsset).toEqual({ lookupId: 3, title: "" });
  });

  it("reads the date columns through the midday pivot", () => {
    const e = toEquipment(item({ InstallDate: "2020-05-04T06:00:00Z" }));
    expect(e.installDate?.toISOString()).toBe("2020-05-04T12:00:00.000Z");
    expect(toEquipment(item({})).warrantyExpiry).toBeNull();
  });
});

describe("attachEquipmentPeople", () => {
  it("fills the tech in, and placeholders an id nobody answers for", () => {
    const rows = [
      toEquipment(item({ ResponsibleTechLookupId: 24 }, "2")),
      toEquipment(item({ ResponsibleTechLookupId: 99 }, "3")),
    ];
    attachEquipmentPeople(
      rows,
      new Map<number, Person>([[24, { displayName: "David Bulkley", lookupId: 24 }]]),
    );
    expect(rows[0].responsibleTech?.displayName).toBe("David Bulkley");
    expect(rows[1].responsibleTech?.displayName).toBe("User #99");
  });
});

describe("attachParentAssetTitles", () => {
  it("resolves a parent that appears LATER in the list than its child", () => {
    // A parent can sit anywhere in the register, which is why this runs over
    // the whole list rather than row by row as it is mapped.
    const rows = [
      toEquipment(item({ Title: "AIR DRYER", ParentAssetLookupId: 3 }, "6"),),
      toEquipment(item({ Title: "40 HP COMPRESSOR" }, "3")),
    ];
    attachParentAssetTitles(rows);
    expect(rows[0].parentAsset).toEqual({ lookupId: 3, title: "40 HP COMPRESSOR" });
  });

  it("leaves a dangling parent reference visible rather than dropping it", () => {
    const rows = [toEquipment(item({ ParentAssetLookupId: 404 }, "6"))];
    attachParentAssetTitles(rows);
    expect(rows[0].parentAsset).toEqual({ lookupId: 404, title: "" });
  });
});

describe("equipmentReference / label / ordering", () => {
  it("produces the `{ lookupId, title }` shape every picker in ARC speaks", () => {
    const e = toEquipment(item({ Title: "TM1" }, "1"));
    expect(equipmentReference(e)).toEqual({ lookupId: 1, title: "TM1" });
  });

  it("never renders an asset as an empty cell", () => {
    const e = toEquipment(item({ Title: "", SerialNo: "5A535020" }, "1"));
    expect(equipmentLabel(e)).toBe("5A535020");
    expect(equipmentLabel({ ...e, serialNo: "" })).toBe("Asset #1");
  });

  it("sorts alphabetically by name", () => {
    const rows: Equipment[] = [
      toEquipment(item({ Title: "TM1" }, "1")),
      toEquipment(item({ Title: "20 HP COMPRESSOR" }, "2")),
    ];
    expect(rows.sort(compareEquipment).map((e) => e.name)).toEqual([
      "20 HP COMPRESSOR",
      "TM1",
    ]);
  });
});
