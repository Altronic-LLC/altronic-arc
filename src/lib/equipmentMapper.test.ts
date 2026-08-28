import { describe, it, expect } from "vitest";
import type { Equipment, GraphListItem, Person } from "@/types/task";
import {
  EQUIPMENT_SELECT,
  attachEquipmentPeople,
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
    const e = toEquipment(item({ EquipmentType: "STEAM HAMMER", Location: "OFF SITE" }));
    expect(e.equipmentType).toBe("STEAM HAMMER");
    expect(e.location).toBe("OFF SITE");
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
