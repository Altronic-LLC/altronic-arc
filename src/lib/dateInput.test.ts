import { describe, it, expect } from "vitest";
import { isCommittableDate, DATE_INPUT_MIN, DATE_INPUT_MAX } from "./dateInput";

describe("isCommittableDate", () => {
  it("accepts an ordinary date", () => {
    expect(isCommittableDate("2026-05-01")).toBe(true);
  });

  it("accepts the empty value, which is how a field gets cleared", () => {
    expect(isCommittableDate("")).toBe(true);
  });

  // The bug this exists for: typing the year of 05/01/2026 one digit at a
  // time makes the input emit each of these as a "complete" date.
  it.each(["0002-05-01", "0020-05-01", "0202-05-01"])(
    "rejects the half-typed year %s",
    (partial) => {
      expect(isCommittableDate(partial)).toBe(false);
    },
  );

  it("accepts the year the user was actually typing", () => {
    expect(isCommittableDate("2026-05-01")).toBe(true);
  });

  it("rejects years SharePoint can't store", () => {
    expect(isCommittableDate("1899-12-31")).toBe(false);
    expect(isCommittableDate("3000-01-01")).toBe(false);
  });

  it("accepts the documented bounds themselves", () => {
    expect(isCommittableDate(DATE_INPUT_MIN)).toBe(true);
    expect(isCommittableDate(DATE_INPUT_MAX)).toBe(true);
  });

  it("rejects a date the calendar doesn't have", () => {
    expect(isCommittableDate("2026-02-31")).toBe(false);
    expect(isCommittableDate("2026-13-01")).toBe(false);
  });

  it("rejects anything that isn't YYYY-MM-DD", () => {
    expect(isCommittableDate("05/01/2026")).toBe(false);
    expect(isCommittableDate("2026-5-1")).toBe(false);
    expect(isCommittableDate("not a date")).toBe(false);
  });
});
