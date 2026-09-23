import { describe, expect, it } from "vitest";
import { stripSapPadding } from "./sapMaterialNumber";

describe("stripSapPadding", () => {
  it("strips SAP's leading zero padding", () => {
    expect(stripSapPadding("000000000001234")).toBe("1234");
    expect(stripSapPadding("0000501505")).toBe("501505");
  });

  it("keeps a single 0 rather than collapsing an all-zeros value to empty", () => {
    expect(stripSapPadding("0")).toBe("0");
    expect(stripSapPadding("00000")).toBe("0");
  });

  it("leaves an unpadded value alone", () => {
    expect(stripSapPadding("791950-08")).toBe("791950-08");
  });

  it("only strips LEADING zeros — an interior or trailing zero is part of the number", () => {
    expect(stripSapPadding("0010200")).toBe("10200");
  });

  it("tolerates null and undefined instead of throwing", () => {
    // A GraphQL field is nullable unless the schema says otherwise, and a
    // bare `row.MATNR_OLD.replace(...)` takes the whole batch down with it
    // the moment one row has no value.
    expect(stripSapPadding(null)).toBe("");
    expect(stripSapPadding(undefined)).toBe("");
  });
});
