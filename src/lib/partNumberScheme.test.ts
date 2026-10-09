import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_LEVELS,
  DEVICE_TYPES,
  PRODUCT_CODES,
  listMeaning,
  partsBookFullLabel,
  partsBookLabel,
  partsBookTooltip,
} from "./partNumberScheme";
import { COMPONENT_PREFIX_CATEGORY } from "./altronicPartMapper";
import { PARTS_BOOKS } from "@/types/task";

describe("the EWI-005 tables", () => {
  it("names every Parts Book, and only books 1–9", () => {
    for (const book of PARTS_BOOKS) expect(partsBookLabel(book)).toBeTruthy();
    expect(partsBookLabel(0)).toBeNull();
    expect(partsBookLabel(10)).toBeNull();
  });

  it("covers every digit for the assembly level and the device type", () => {
    for (let d = 0; d <= 9; d++) {
      expect(ASSEMBLY_LEVELS[d]).toBeDefined();
      expect(DEVICE_TYPES[d]).toBeDefined();
    }
  });

  it("keeps the EWI's own wording for the full labels", () => {
    expect(partsBookFullLabel(5)).toBe("Altronic V or Multiple Ignition Systems");
    expect(PRODUCT_CODES[7].full).toBe("DC Powered Digital Ignition Systems");
    expect(ASSEMBLY_LEVELS[7].full).toBe("Sub-assembly below level 8, typically PCB assembly");
    expect(DEVICE_TYPES[9].full).toBe("Wire Diagram, Sales Drawing, etc.");
  });

  it("calls the 800 book Special Products, and says EWI-005 leaves 8 unused", () => {
    expect(partsBookLabel(8)).toBe("Special Products");
    expect(partsBookFullLabel(8)).toBe("Special Products (unused in EWI-005)");
    expect(partsBookTooltip(8)).toBe("800 Parts Book — Special Products (EWI-005 Rev 5 lists 8 as unused)");
    expect(partsBookTooltip(3)).toBe("300 Parts Book — Altronic III Ignition System (EWI-005 Rev 5)");
    expect(listMeaning("810")?.description).toMatch(/^EWI-005 Rev 5: 8 = Special Products \(unused in EWI-005\)/);
  });

  it("transcribes Rev 5's duplicate: B = 0 and B = 3 mean the same thing", () => {
    expect(ASSEMBLY_LEVELS[3].full).toBe(ASSEMBLY_LEVELS[0].full);
  });
});

describe("listMeaning", () => {
  it("labels a list by its assembly level, then its device type", () => {
    expect(listMeaning("309")?.lines).toEqual(["Components / Hardware", "Wire Diagram / Sales Drawing"]);
    expect(listMeaning("291")?.lines).toEqual(["Final Assembly", "Electrical / Fasteners"]);
    expect(listMeaning("504")?.summary).toBe("Components / Hardware · Connectors / Terminals");
  });

  it("says Mechanical once when both halves say it", () => {
    expect(listMeaning("410")?.lines).toEqual(["Mechanical"]);
  });

  it("never labels a tile Unused — an unassigned device type shows the level alone", () => {
    for (const prefix of ["915", "507", "618"]) {
      const meaning = listMeaning(prefix);
      expect(meaning?.lines).toEqual([ASSEMBLY_LEVELS[Number(prefix[1])].short]);
      expect(meaning?.lines.join(" ")).not.toMatch(/unused/i);
      expect(meaning?.description).toContain("device type not assigned in EWI-005");
    }
  });

  it("spells out every digit in the tooltip, citing the EWI", () => {
    expect(listMeaning("309")?.description).toBe(
      "EWI-005 Rev 5: 3 = Altronic III Ignition System · 0 = Electrical/Electronic Components or Hardware · 9 = Wire Diagram, Sales Drawing, etc.",
    );
  });

  it("leaves the HCO component lists to their own names", () => {
    for (const prefix of Object.keys(COMPONENT_PREFIX_CATEGORY)) {
      expect(listMeaning(prefix)).toBeNull();
    }
  });

  it("returns null for anything that isn't a three-digit list", () => {
    expect(listMeaning("")).toBeNull();
    expect(listMeaning("30")).toBeNull();
    expect(listMeaning("3091")).toBeNull();
    expect(listMeaning("abc")).toBeNull();
    // "0 = not used" as a product code — there is no 000 book.
    expect(listMeaning("012")).toBeNull();
  });
});
