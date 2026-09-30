// The bug only exists WEST of Greenwich — which is every Altronic user — so
// the zone is pinned here rather than left to whatever machine runs the suite.
// No @types/node in this project's tsconfig — reach process.env the way
// communicationParser.timezone.test.ts does. Restored after the file.
const env = (globalThis as unknown as {
  process: { env: Record<string, string | undefined> };
}).process.env;
const previousTz = env.TZ;
env.TZ = "America/Chicago";

import { describe, it, expect, afterAll } from "vitest";
import { parseWrittenDate, toIsoDate } from "./dateInput";

afterAll(() => {
  env.TZ = previousTz;
});

describe("parseWrittenDate", () => {
  it("reads a picker's bare yyyy-mm-dd as that LOCAL day, not the day before", () => {
    // Ray, 2026-09-30: picking 9/30 showed 9/29 until the refetch landed.
    const d = parseWrittenDate("2026-09-30");
    expect(d && toIsoDate(d)).toBe("2026-09-30");
  });

  it("is exactly the trap it replaces: new Date() on a bare date lands a day early here", () => {
    // Guards the premise — if this ever passes the test above proves nothing.
    expect(toIsoDate(new Date("2026-09-30"))).toBe("2026-09-29");
  });

  it("parses a value carrying a time as the instant it is", () => {
    expect(parseWrittenDate("2026-09-30T12:00:00Z")?.toISOString()).toBe("2026-09-30T12:00:00.000Z");
  });

  it("returns null for blank, non-string and garbage", () => {
    expect(parseWrittenDate("")).toBeNull();
    expect(parseWrittenDate(null)).toBeNull();
    expect(parseWrittenDate(42)).toBeNull();
    expect(parseWrittenDate("not a date")).toBeNull();
  });
});
