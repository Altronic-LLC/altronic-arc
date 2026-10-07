import { describe, expect, it } from "vitest";
import { nextScnNumber, scnYearOf } from "./scnNumber";

// =============================================================================
// The SCN# rule, pinned against the shape the live list holds (2026-10-07):
// three-digit per-year numbers through 2023, then ONE global four-digit
// sequence from 2024. Only the four-digit titles feed the maximum.
// =============================================================================

const LIVE_SHAPE = [
  "2020-001",
  "2020-022",
  "2021-007",
  "2022-016",
  "2023-012",
  "2024-0064",
  "2024-0094",
  "2025-0095",
  "2025-0127",
  "2026-0128",
  "2026-0148",
];

const TODAY = new Date(2026, 9, 7); // 7 Oct 2026, local

describe("nextScnNumber", () => {
  it("continues the GLOBAL four-digit sequence under the current year", () => {
    expect(nextScnNumber(LIVE_SHAPE, TODAY)).toBe("2026-0149");
  });

  it("ignores the legacy three-digit per-year titles entirely", () => {
    // 2020-022 is a bigger "number" than 0004 only if the two schemes are
    // confused; it must not push the sequence to 0023.
    expect(nextScnNumber(["2020-022", "2026-0004"], TODAY)).toBe("2026-0005");
    // And on their own they count for nothing — the sequence starts fresh.
    expect(nextScnNumber(["2020-022", "2023-012"], TODAY)).toBe("2026-0001");
  });

  it("starts at 0001 with no four-digit titles at all", () => {
    expect(nextScnNumber([], TODAY)).toBe("2026-0001");
  });

  it("does NOT restart in a new year — the sequence is global, not per year", () => {
    // 2025-0127 was the last of 2025; the first of 2026 was 0128, not 0001.
    expect(nextScnNumber(["2025-0127"], new Date(2026, 0, 2))).toBe("2026-0128");
  });

  it("reads the year off `now`, not off the newest title", () => {
    expect(nextScnNumber(["2026-0148"], new Date(2027, 2, 1))).toBe("2027-0149");
  });

  it("tolerates whitespace, blanks and junk titles", () => {
    expect(nextScnNumber([" 2026-0010 ", "", "SCN?", "2026-ABCD", "2026-00011"], TODAY)).toBe(
      "2026-0011",
    );
  });

  it("keeps a number wider than four digits at its natural width", () => {
    expect(nextScnNumber(["2031-9999"], new Date(2031, 5, 1))).toBe("2031-10000");
  });
});

describe("scnYearOf", () => {
  it("is the four-digit prefix", () => {
    expect(scnYearOf("2026-0149")).toBe("2026");
    expect(scnYearOf("2020-001")).toBe("2020");
  });
});
