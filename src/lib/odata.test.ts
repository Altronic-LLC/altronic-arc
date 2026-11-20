import { describe, it, expect } from "vitest";
import { odataString } from "./odata";

describe("odataString", () => {
  it("wraps a plain value in single quotes and percent-encodes it", () => {
    expect(odataString("ray.white@altronic-llc.com")).toBe("'ray.white%40altronic-llc.com'");
  });

  it("doubles an embedded single quote so it can't end the literal", () => {
    // O'Brien → O''Brien → percent-encoded
    expect(odataString("O'Brien")).toBe("'O''Brien'");
  });

  // The injection shape: a quote, then filter syntax. After doubling, the
  // whole thing stays inside one literal.
  it("keeps filter syntax after a quote inside the literal", () => {
    const out = odataString("x' or fields/Title ne '");
    expect(out.startsWith("'x''")).toBe(true);
    expect(out.endsWith("''")).toBe(true);
    expect(out).not.toContain("' or");
  });

  it("encodes spaces, hashes and ampersands", () => {
    expect(odataString("A B#1 & 2")).toBe("'A%20B%231%20%26%202'");
  });

  it("gives an empty literal for an empty string", () => {
    expect(odataString("")).toBe("''");
  });
});
