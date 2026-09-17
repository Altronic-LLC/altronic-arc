import { describe, it, expect } from "vitest";
import {
  QC_CPU95_FIELDS,
  QC_CPU95_FIELD_BY_KEY,
  QC_CPU95_SECTIONS,
  qcCpu95EmptyValues,
  qcCpu95FieldLabel,
  qcCpu95FieldsInSection,
  qcCpu95SectionTitle,
  qcCpu95VisibleFields,
} from "./qcCpu95Fields";

describe("qcCpu95VisibleFields", () => {
  it("shows everything when the Altmode can't be determined", () => {
    expect(qcCpu95VisibleFields(null)).toHaveLength(QC_CPU95_FIELDS.length);
  });

  it("always shows a field with no altModes restriction, on every Altmode", () => {
    for (let mode = 0; mode <= 6; mode++) {
      const keys = qcCpu95VisibleFields(mode).map((f) => f.key);
      expect(keys).toContain("serialNumber");
      expect(keys).toContain("comments");
    }
  });

  it("shows the standard 20V/24V startup fields only below Altmode 5", () => {
    for (const mode of [0, 1, 2, 3, 4]) {
      expect(qcCpu95VisibleFields(mode).map((f) => f.key)).toContain("startup20vE1");
    }
    for (const mode of [5, 6]) {
      expect(qcCpu95VisibleFields(mode).map((f) => f.key)).not.toContain("startup20vE1");
    }
  });

  it("shows the 791962/52-18 'Alt' voltage fields only above Altmode 4", () => {
    for (const mode of [0, 1, 2, 3, 4]) {
      expect(qcCpu95VisibleFields(mode).map((f) => f.key)).not.toContain("startup20vE1Alt");
    }
    for (const mode of [5, 6]) {
      expect(qcCpu95VisibleFields(mode).map((f) => f.key)).toContain("startup20vE1Alt");
    }
  });

  it("shows the four 'On 791956-16' checklist booleans on the same condition as the Alt voltage fields", () => {
    for (const mode of [5, 6]) {
      expect(qcCpu95VisibleFields(mode).map((f) => f.key)).toContain("final791956Timing");
    }
    for (const mode of [0, 1, 2, 3, 4]) {
      expect(qcCpu95VisibleFields(mode).map((f) => f.key)).not.toContain("final791956Timing");
    }
  });

  it("shows the 16-cylinder firing angle grid only below Altmode 3", () => {
    for (const mode of [0, 1, 2]) {
      expect(qcCpu95VisibleFields(mode).map((f) => f.key)).toContain("firingSpec16A");
    }
    for (const mode of [3, 4, 5, 6]) {
      expect(qcCpu95VisibleFields(mode).map((f) => f.key)).not.toContain("firingSpec16A");
    }
  });

  it("shows the 18-cylinder firing angle grid only above Altmode 3", () => {
    for (const mode of [4, 5, 6]) {
      expect(qcCpu95VisibleFields(mode).map((f) => f.key)).toContain("firingSpec18A");
    }
    for (const mode of [0, 1, 2, 3]) {
      expect(qcCpu95VisibleFields(mode).map((f) => f.key)).not.toContain("firingSpec18A");
    }
  });

  it("shows the 20-cylinder firing angle grid only at exactly Altmode 3", () => {
    expect(qcCpu95VisibleFields(3).map((f) => f.key)).toContain("firingSpec20AL");
    for (const mode of [0, 1, 2, 4, 5, 6]) {
      expect(qcCpu95VisibleFields(mode).map((f) => f.key)).not.toContain("firingSpec20AL");
    }
  });

  // 791950-08 is Altmode 1 exclusively, and it's an 8-cylinder unit that
  // shares the 16-cylinder columns rather than having its own — only A-L
  // (the first 8 of 16 letters) hold real values on it.
  it("hides the unused M-V firing-angle letters on Altmode 1 (791950-08, 8 cyl)", () => {
    const keys = qcCpu95VisibleFields(1).map((f) => f.key);
    for (const letter of ["A", "B", "C", "D", "E", "F", "K", "L"]) {
      expect(keys).toContain(`firingSpec16${letter}`);
      expect(keys).toContain(`firingActual16${letter}`);
    }
    for (const letter of ["M", "N", "P", "R", "S", "T", "U", "V"]) {
      expect(keys).not.toContain(`firingSpec16${letter}`);
      expect(keys).not.toContain(`firingActual16${letter}`);
    }
  });

  it("keeps all 16 firing-angle letters on Altmode 0 and 2 — genuinely 16-cylinder", () => {
    for (const mode of [0, 2]) {
      const keys = qcCpu95VisibleFields(mode).map((f) => f.key);
      for (const letter of ["M", "N", "P", "R", "S", "T", "U", "V"]) {
        expect(keys).toContain(`firingSpec16${letter}`);
        expect(keys).toContain(`firingActual16${letter}`);
      }
    }
  });
});

describe("qcCpu95SectionTitle", () => {
  it("relabels both 16-cyl firing-angle sections as 8 Cyl on Altmode 1", () => {
    expect(qcCpu95SectionTitle("Firing Angle Spec — 16 Cyl", 1)).toBe("Firing Angle Spec — 8 Cyl");
    expect(qcCpu95SectionTitle("Firing Angle Actual — 16 Cyl", 1)).toBe(
      "Firing Angle Actual — 8 Cyl",
    );
  });

  it("leaves every other section, and every other Altmode, unchanged", () => {
    expect(qcCpu95SectionTitle("Firing Angle Spec — 16 Cyl", 0)).toBe("Firing Angle Spec — 16 Cyl");
    expect(qcCpu95SectionTitle("Firing Angle Spec — 16 Cyl", 2)).toBe("Firing Angle Spec — 16 Cyl");
    expect(qcCpu95SectionTitle("Firing Angle Spec — 16 Cyl", null)).toBe(
      "Firing Angle Spec — 16 Cyl",
    );
    expect(qcCpu95SectionTitle("Header", 1)).toBe("Header");
  });
});

describe("qcCpu95FieldLabel", () => {
  it("relabels the visible 16-cyl firing-angle fields '8A'..'8L' on Altmode 1", () => {
    const fieldA = QC_CPU95_FIELD_BY_KEY.firingSpec16A!;
    const fieldL = QC_CPU95_FIELD_BY_KEY.firingActual16L!;
    expect(qcCpu95FieldLabel(fieldA, 1)).toBe("8A");
    expect(qcCpu95FieldLabel(fieldL, 1)).toBe("8L");
  });

  it("leaves the label alone on every other Altmode", () => {
    const fieldA = QC_CPU95_FIELD_BY_KEY.firingSpec16A!;
    expect(qcCpu95FieldLabel(fieldA, 0)).toBe("16A");
    expect(qcCpu95FieldLabel(fieldA, 2)).toBe("16A");
    expect(qcCpu95FieldLabel(fieldA, null)).toBe("16A");
  });

  it("leaves every non-firing-16 field alone, even on Altmode 1", () => {
    const serial = QC_CPU95_FIELD_BY_KEY.serialNumber!;
    const firing18 = QC_CPU95_FIELD_BY_KEY.firingSpec18A!;
    expect(qcCpu95FieldLabel(serial, 1)).toBe(serial.label);
    expect(qcCpu95FieldLabel(firing18, 1)).toBe(firing18.label);
  });
});

describe("qcCpu95FieldsInSection", () => {
  it("only returns fields tagged with that section", () => {
    for (const field of qcCpu95FieldsInSection("Defects / NCM")) {
      expect(field.section).toBe("Defects / NCM");
    }
  });

  it("covers every declared section", () => {
    for (const section of QC_CPU95_SECTIONS) {
      expect(qcCpu95FieldsInSection(section).length).toBeGreaterThan(0);
    }
  });
});

describe("QC_CPU95_FIELD_BY_KEY", () => {
  it("indexes every field by its key", () => {
    expect(Object.keys(QC_CPU95_FIELD_BY_KEY)).toHaveLength(QC_CPU95_FIELDS.length);
    expect(QC_CPU95_FIELD_BY_KEY.serialNumber?.column).toBe("Title");
  });
});

describe("QC_CPU95_FIELDS — no $select, so these are the only safety nets", () => {
  // There is deliberately no $select on the CPU-95 read (see the file header
  // comment and api/qcCpu95.ts) — a fully-named one for ~200 columns pushed
  // the request URL near 5,000 characters and came back 404. Every field is
  // fetched unconditionally now, so a duplicate or wrong column name here
  // wouldn't 400 the whole read the way it would on a $select'd list — it
  // would silently mis-map data instead, which these tests exist to catch.
  it("declares every column exactly once", () => {
    const columns = QC_CPU95_FIELDS.map((f) => f.column);
    expect(new Set(columns).size).toBe(columns.length);
  });

  it("declares every key exactly once", () => {
    const keys = QC_CPU95_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not map 'ProjectTag' — it's a real lookup column, not yet wired in", () => {
    expect(QC_CPU95_FIELDS.some((f) => f.column === "ProjectTag")).toBe(false);
  });

  it("gives the 18-cylinder firing grid its own two columns (G, H) the 16-cylinder grid doesn't have", () => {
    const columns = QC_CPU95_FIELDS.map((f) => f.column);
    expect(columns).toContain("FiringAngleSpec18G");
    expect(columns).toContain("FiringAngleSpec18H");
    expect(columns).toContain("FiringAngleActual18G");
    expect(columns).toContain("FiringAngleActual18H");
    expect(columns).not.toContain("FiringAngleSpec16G");
    expect(columns).not.toContain("FiringAngleSpec16H");
  });

  it("has 16 firing-angle letters for 16 cylinders and 18 for 18 cylinders", () => {
    const spec16 = QC_CPU95_FIELDS.filter((f) => f.column.startsWith("FiringAngleSpec16"));
    const spec18 = QC_CPU95_FIELDS.filter((f) => f.column.startsWith("FiringAngleSpec18"));
    expect(spec16).toHaveLength(16);
    expect(spec18).toHaveLength(18);
  });
});

describe("qcCpu95EmptyValues", () => {
  it("gives every declared field key a blank string", () => {
    const empty = qcCpu95EmptyValues();
    expect(Object.keys(empty)).toHaveLength(QC_CPU95_FIELDS.length);
    for (const field of QC_CPU95_FIELDS) {
      expect(empty[field.key]).toBe("");
    }
  });
});
