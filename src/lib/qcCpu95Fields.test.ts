import { describe, it, expect } from "vitest";
import layout from "../../scripts/data/qc-cpu95-columns.json";
import firingSpecTable from "@/data/qcCpu95FiringSpecs.json";
import { qcCpu95Altmode } from "./qcCpu95Mapper";
import { QC_CHECK_CHOICES, qcFieldsInSection } from "./qcFormEngine";
import { QC_CPU95_FORM } from "./qcCpu95Form";
import {
  QC_CPU95_FIELDS,
  QC_CPU95_FIELD_BY_KEY,
  QC_CPU95_SECTIONS,
  qcCpu95FieldLabel,
  qcCpu95FiringGrid,
  qcCpu95FiringLetter,
  qcCpu95SectionTitle,
  qcCpu95StandardFiringSpecs,
  qcCpu95Variant,
  qcCpu95VisibleFields,
} from "./qcCpu95Fields";

describe("qcCpu95StandardFiringSpecs", () => {
  const angles = (pn: string, altMode: number) => {
    const specs = qcCpu95StandardFiringSpecs(pn, altMode);
    return specs && Object.keys(specs).sort().map((k) => specs[k]);
  };

  it("reproduces the CPU-95C sheet's pre-printed TEST spec, wrapping at 360", () => {
    expect(angles("791955-16", 0)!.slice(0, 16)).toEqual(
      ["0", "60", "90", "150", "180", "240", "270", "330", "0", "60", "90", "150", "180", "240", "270", "330"],
    );
  });

  it("gives a 16-cylinder 791950-16 even 45° steps, twice round", () => {
    expect(angles("791950-16", 2)!.slice(0, 16)).toEqual(
      ["0", "45", "90", "135", "180", "225", "270", "315", "0", "45", "90", "135", "180", "225", "270", "315"],
    );
  });

  it("fills only the unit's own cylinders and blanks the rest", () => {
    // 791950-08: eight cylinders, 0, 90, 180 ↓ on the sheets.
    expect(angles("791950-08", 1)).toEqual(
      ["0", "90", "180", "270", "0", "90", "180", "270", ...Array(12).fill("")],
    );
    expect(angles("791952-18", 5)!.slice(0, 5)).toEqual(["0", "50", "80", "130", "160"]);
    expect(angles("791952-18", 5)!.slice(18)).toEqual(["", ""]);
  });

  it("matches the part number loosely — case, spaces and a bare one-digit suffix", () => {
    expect(angles(" 791950-8 ", 1)).toEqual(angles("791950-08", 1));
    expect(angles("791962-16g", 0)).toEqual(angles("791950-16", 2));
  });

  it("agrees with the shared table's cylinder counts, which the backfill script relies on", () => {
    for (const s of firingSpecTable.specs) {
      expect(qcCpu95FiringGrid(qcCpu95Altmode(s.partNumber)).cylinders, s.partNumber).toBe(s.cylinders);
    }
  });

  it("has no standard for a unit whose spec comes from elsewhere, or for no unit at all", () => {
    expect(qcCpu95StandardFiringSpecs("708939", 0)).toBeNull();
    expect(qcCpu95StandardFiringSpecs("", 0)).toBeNull();
    expect(qcCpu95StandardFiringSpecs("791950-16", null)).toBeNull();
  });
});

const keys = (altMode: number | null, pn = "") => qcCpu95VisibleFields(altMode, pn).map((f) => f.key);

describe("the layout the PMO list was built from", () => {
  // scripts/data/qc-cpu95-columns.json built the list; a column here that it
  // doesn't name is a column SharePoint hasn't got, and would read blank.
  const byName = new Map(layout.columns.map((c) => [c.name, c]));

  it("names every column ARC reads and writes", () => {
    for (const f of QC_CPU95_FIELDS) expect(byName.has(f.column), f.column).toBe(true);
  });

  it("agrees on each column's type", () => {
    const expected: Record<string, string[]> = {
      text: ["text", "title"],
      number: ["number"],
      check: ["check"],
      flag: ["flag"],
      date: ["date"],
      datetime: ["dateTime"],
      multiline: ["note"],
    };
    for (const f of QC_CPU95_FIELDS) {
      expect(expected[f.kind], `${f.key} (${f.kind})`).toContain(byName.get(f.column)!.type);
    }
  });

  it("leaves out only the migration's own columns", () => {
    const mapped = new Set(QC_CPU95_FIELDS.map((f) => f.column));
    const unmapped = layout.columns.map((c) => c.name).filter((n) => !mapped.has(n));
    expect(unmapped.sort()).toEqual(["DataQualityNotes", "LegacyCreated", "LegacyCreatedBy", "LegacySource"]);
  });

  it("offers the same three answers on a check", () => {
    expect([...QC_CHECK_CHOICES]).toEqual(layout.checkChoices);
  });
});

describe("qcCpu95Variant", () => {
  it("knows the 95C, EVS and 791956-16 by part number, trimmed and in any case", () => {
    expect(qcCpu95Variant(0, "791955-16")).toBe("95c");
    expect(qcCpu95Variant(0, " 791963-16a ")).toBe("evs");
    expect(qcCpu95Variant(0, "791963-16E")).toBe("evs");
    expect(qcCpu95Variant(0, "791956-16")).toBe("791956");
  });

  it("calls 791952-18 and 791962-18 (Altmode 5/6) the high-voltage unit, and everything else base", () => {
    expect(qcCpu95Variant(5, "791952-18")).toBe("highVolt");
    expect(qcCpu95Variant(6, "791962-18")).toBe("highVolt");
    expect(qcCpu95Variant(2, "791950-16")).toBe("base");
    expect(qcCpu95Variant(0, "")).toBe("base");
  });
});

describe("qcCpu95VisibleFields", () => {
  it("shows everything on the blank form", () => {
    expect(qcCpu95VisibleFields(null)).toHaveLength(QC_CPU95_FIELDS.length);
  });

  it("shows the header, sign-off and Post Test Inspection on every unit", () => {
    for (const pn of ["791950-16", "791962-18", "791955-16", "791963-16A", "791956-16"]) {
      const k = keys(0, pn);
      for (const key of ["serialNumber", "comments", "finalInspectionDate", "inspLabelMatches", "inspClean", "ovenOn"]) {
        expect(k, `${key} on ${pn}`).toContain(key);
      }
    }
  });

  const CHECKS_791956 = ["final791956Timing", "final791956LossOfLoop", "final791956Below250Rpm", "final791956CanComm"];

  it("shows the four 'On 791956-16' checks only for part number 791956-16", () => {
    for (const key of CHECKS_791956) expect(keys(0, "791956-16")).toContain(key);
    for (const [mode, pn] of [[2, "791950-16"], [0, ""], [5, "791952-18"], [6, "791962-18"]] as const) {
      for (const key of CHECKS_791956) expect(keys(mode, pn)).not.toContain(key);
    }
  });

  const ONLY_95C = ["application", "startupGndGProgram", "startupDisplayReady", "finalCatFirePulses", "finalHDisconnect", "finalModeMessage", "finalMagCal", "finalTiming110Rpm"];
  const HIDDEN_ON_95C = [
    "memoryNumber", "startupVerifyACountSetup", "finalGndGLead", "finalGndSD", "finalLossOfReset", "finalInternal4Leds",
    "finalCheck420maLoop", "testCurrentLoop", "finalCurrentLoop", "finalVerifyOneStep", "finalProgramOrBlankMemory",
  ];

  it("gives a 791955-16 the CPU-95C checks and hides the base checks its sheet hasn't got", () => {
    const k = keys(0, "791955-16");
    for (const key of ONLY_95C) expect(k).toContain(key);
    for (const key of HIDDEN_ON_95C) expect(k).not.toContain(key);
    expect(k).toContain("finalEachOutputFiring");
  });

  it("shows no CPU-95C check on any other unit", () => {
    for (const key of ONLY_95C) expect(keys(2, "791950-16")).not.toContain(key);
    for (const key of HIDDEN_ON_95C) expect(keys(2, "791950-16")).toContain(key);
  });

  it("gives an EVS its own readings and drops the peak volts and the checks it hasn't got", () => {
    const k = keys(0, "791963-16E");
    for (const key of ["startupE1SupplyCurrent", "finalE1SupplyCurrent", "finalSixEnergyLevels"]) expect(k).toContain(key);
    for (const key of ["startup20vE1", "finalE3Current_24v", "finalShortPrimary", "finalCheck420maLoop", "finalTriacLeakage", "finalDiodeLeakage"]) {
      expect(k).not.toContain(key);
    }
    expect(keys(2, "791950-16")).not.toContain("finalSixEnergyLevels");
  });

  it("shows the firing rows the unit's grid has: 8, 16, 18 or 20", () => {
    const slots = (mode: number) => keys(mode).filter((k) => k.startsWith("firingSpec")).length;
    expect(slots(1)).toBe(8);
    expect(slots(0)).toBe(16);
    expect(slots(2)).toBe(16);
    expect(slots(4)).toBe(18);
    expect(slots(6)).toBe(18);
    expect(slots(3)).toBe(20);
    expect(keys(1)).toContain("firingActualsAtSpec");
  });
});

describe("firing grid and labels", () => {
  it("labels a slot with its cylinder letter on the unit's grid", () => {
    expect(qcCpu95FiringLetter(7, 2)).toBe("K");
    expect(qcCpu95FiringLetter(7, 4)).toBe("G");
    expect(qcCpu95FiringLetter(1, 3)).toBe("AL");
    expect(qcCpu95FiringLetter(8, 1)).toBe("L");
    expect(qcCpu95FieldLabel(QC_CPU95_FIELD_BY_KEY.firingActual08!, 1)).toBe("L");
  });

  it("names the cylinder count in the section title", () => {
    expect(qcCpu95SectionTitle("Firing Angles", 1)).toBe("Firing Angles — 8 Cyl");
    expect(qcCpu95SectionTitle("Firing Angles", 6)).toBe("Firing Angles — 18 Cyl");
    expect(qcCpu95SectionTitle("Firing Angles", null)).toBe("Firing Angles");
    expect(qcCpu95SectionTitle("Header", 1)).toBe("Header");
    expect(qcCpu95FiringGrid(null)).toEqual({ grid: "20", cylinders: 20 });
  });

  it("words a field the way the unit's paper does", () => {
    const e1 = QC_CPU95_FIELD_BY_KEY.startup20vE1!;
    expect(qcCpu95FieldLabel(e1, 2, "791950-16")).toBe("20V Input Peak Volt E1 (130V)");
    expect(qcCpu95FieldLabel(e1, 6, "791962-18")).toBe("20V Input Peak Volt E1 (140V)");
    expect(qcCpu95FieldLabel(QC_CPU95_FIELD_BY_KEY.startupEavg!, 0, "791963-16A")).toBe("CAVG");
    expect(qcCpu95FieldLabel(QC_CPU95_FIELD_BY_KEY.finalAdjust2OutputTiming!, 0, "791963-16A")).toMatch(/Adjust 1 output/);
    expect(qcCpu95FieldLabel(QC_CPU95_FIELD_BY_KEY.finalMultiFire!, 0, "791955-16")).toMatch(/Multi strike/);
    expect(qcCpu95FieldLabel(QC_CPU95_FIELD_BY_KEY.finalMultiFire!, null)).toBe("Multi-fire, no warnings");
  });
});

describe("the sections", () => {
  it("only hold fields tagged with that section, and every section has some", () => {
    for (const section of QC_CPU95_SECTIONS) {
      const fields = qcFieldsInSection(QC_CPU95_FORM, section);
      expect(fields.length, section).toBeGreaterThan(0);
      for (const f of fields) expect(f.section).toBe(section);
    }
  });
});

describe("QC_CPU95_FIELDS", () => {
  it("declares every column and every key exactly once", () => {
    const columns = QC_CPU95_FIELDS.map((f) => f.column);
    const fieldKeys = QC_CPU95_FIELDS.map((f) => f.key);
    expect(new Set(columns).size).toBe(columns.length);
    expect(new Set(fieldKeys).size).toBe(fieldKeys.length);
    expect(QC_CPU95_FIELD_BY_KEY.serialNumber?.column).toBe("Title");
  });

  it("has 20 spec and 20 actual firing slots", () => {
    expect(QC_CPU95_FIELDS.filter((f) => f.key.startsWith("firingSpec"))).toHaveLength(20);
    expect(QC_CPU95_FIELDS.filter((f) => f.key.startsWith("firingActual") && f.slot)).toHaveLength(20);
  });

  it("gives every unit's checks the three-answer kind and the defects the yes/no kind", () => {
    expect(QC_CPU95_FIELDS.filter((f) => f.section === "Defects / NCM").every((f) => f.kind === "flag")).toBe(true);
    expect(QC_CPU95_FIELDS.filter((f) => f.section === "Post Test Inspection").every((f) => f.kind === "check")).toBe(true);
  });
});
