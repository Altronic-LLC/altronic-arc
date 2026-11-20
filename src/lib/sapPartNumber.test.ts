import { describe, expect, it } from "vitest";
import { SAP_PART_NUMBER_PROBLEM, formatSapPartNumber, sapPartNumberProblem } from "./sapPartNumber";

describe("formatSapPartNumber", () => {
  it("dashes a full number 4-4-2", () => {
    expect(formatSapPartNumber("1003011440")).toBe("1003-0114-40");
  });

  it("inserts dashes progressively as you type", () => {
    expect(formatSapPartNumber("")).toBe("");
    expect(formatSapPartNumber("1")).toBe("1");
    expect(formatSapPartNumber("1003")).toBe("1003");
    expect(formatSapPartNumber("10030")).toBe("1003-0");
    expect(formatSapPartNumber("10030114")).toBe("1003-0114");
    expect(formatSapPartNumber("100301144")).toBe("1003-0114-4");
  });

  it("strips everything but digits and stops at 10", () => {
    expect(formatSapPartNumber(" 1003-0114-40 ")).toBe("1003-0114-40");
    expect(formatSapPartNumber("1003.0114.40")).toBe("1003-0114-40");
    expect(formatSapPartNumber("abc1003")).toBe("1003");
    expect(formatSapPartNumber("100301144099")).toBe("1003-0114-40");
    // Re-formatting a formatted value is stable (a backspace over a dash works).
    expect(formatSapPartNumber("1003-")).toBe("1003");
  });
});

describe("sapPartNumberProblem", () => {
  it("allows blank — some parts have no SAP # yet", () => {
    expect(sapPartNumberProblem("")).toBeNull();
    expect(sapPartNumberProblem("   ")).toBeNull();
  });

  it("allows exactly 10 digits", () => {
    expect(sapPartNumberProblem("1003-0114-40")).toBeNull();
    expect(sapPartNumberProblem("1003011440")).toBeNull();
  });

  it("refuses anything else, with the sentence", () => {
    for (const v of ["1003-0114-4", "100301144", "1003-0114-401", "ABCD-0114-40", "10-030114-40"]) {
      expect(sapPartNumberProblem(v)).toBe(SAP_PART_NUMBER_PROBLEM);
    }
    expect(SAP_PART_NUMBER_PROBLEM).toBe("SAP part number must be 10 digits, like 1234-5678-90");
  });
});
