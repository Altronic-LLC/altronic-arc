import { describe, expect, it } from "vitest";
import type { AltronicComponent } from "@/types/task";
import { componentCsvFileName, componentCsvRows, csvField, toCsv } from "./componentCsv";
import { COMPONENT_FIELDS } from "./partFields";

function component(over: Partial<AltronicComponent>): AltronicComponent {
  return {
    id: 1,
    partNumber: "701001",
    category: "Surface Mount",
    description: "RESISTOR - THICK FILM",
    mfgName: "Demo Mfg",
    mfgNumber: "DM-1",
    ratingA: "4K7",
    ratingB: "250mW",
    ratingC: "200V",
    tempMin: "-55",
    tempMax: "155",
    tolerance: "±1%",
    footprint: "0603",
    notes: "",
    hasDataSheet: true,
    signOffStatus: "Approved",
    legacySource: "",
    comments: [],
    createdBy: null,
    hasAttachments: false,
    createdAt: new Date(2026, 0, 5),
    modifiedAt: new Date(2026, 9, 22),
    ...over,
  };
}

describe("csvField", () => {
  it("quotes only when it has to, doubling quotes", () => {
    expect(csvField("4K7")).toBe("4K7");
    expect(csvField("CAP, CERAMIC")).toBe('"CAP, CERAMIC"');
    expect(csvField('6" LEAD')).toBe('"6"" LEAD"');
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });
});

describe("toCsv", () => {
  it("starts with a UTF-8 byte-order mark and ends every line CRLF", () => {
    const text = toCsv([["a", "b"], ["±1%", "c,d"]]);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe('a,b\r\n±1%,"c,d"\r\n');
  });
});

describe("componentCsvRows", () => {
  it("has a column for every field a component's page shows, under the same labels", () => {
    const [header] = componentCsvRows([]);
    expect(header).toEqual(["Altronic Part #", "Category", ...COMPONENT_FIELDS.map((f) => f.label), "Sign-off Status", "Created", "Modified"]);
  });

  it("writes live components in part-number order, values as stored, and leaves deleted numbers out", () => {
    const rows = componentCsvRows([
      component({ id: 2, partNumber: "711002" }),
      component({ id: 3, partNumber: "701999", signOffStatus: "Deleted", description: "DELETED" }),
      component({ id: 1, partNumber: "601010", hasDataSheet: false, signOffStatus: null }),
    ]);
    expect(rows.slice(1).map((r) => r[0])).toEqual(["601010", "711002"]);
    const first = rows[1];
    const col = (label: string) => first[rows[0].indexOf(label)];
    expect(col("Footprint")).toBe("0603");
    expect(col("Tolerance")).toBe("±1%");
    expect(col("Has Data Sheet")).toBe("No");
    expect(col("Sign-off Status")).toBe("");
    expect(col("Created")).toBe("2026-01-05");
    expect(col("Modified")).toBe("2026-10-22");
  });
});

describe("componentCsvFileName", () => {
  it("is named for the day it was exported", () => {
    expect(componentCsvFileName(new Date(2026, 9, 22))).toBe("altronic-component-list-2026-10-22.csv");
  });
});
