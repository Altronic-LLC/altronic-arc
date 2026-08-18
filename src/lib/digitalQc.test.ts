import { describe, expect, it } from "vitest";
import { filterDigitalQcRecords, getDigitalQcFamilies } from "./digitalQc";
import { DIGITAL_QC_SAMPLE_RECORDS } from "@/data/digitalQcMockData";

describe("digital QC helpers", () => {
  it("includes the workbook's family list and keeps DE Terminal among them", () => {
    const families = getDigitalQcFamilies(DIGITAL_QC_SAMPLE_RECORDS);

    expect(families).toContain("DE Terminal");
    expect(families).toEqual(expect.arrayContaining([
      "A.F.M.",
      "DE Terminal",
      "Tachometer",
    ]));
  });

  it("filters rows to the DE Terminal sample set and keeps the newest date first", () => {
    const rows = filterDigitalQcRecords(DIGITAL_QC_SAMPLE_RECORDS, "DE Terminal");

    expect(rows.length).toBeGreaterThan(3);
    expect(rows.every((row) => row.productFamily === "DE Terminal")).toBe(true);
    expect(Date.parse(rows[0].dateTested)).toBeGreaterThanOrEqual(
      Date.parse(rows[rows.length - 1].dateTested),
    );
  });
});
