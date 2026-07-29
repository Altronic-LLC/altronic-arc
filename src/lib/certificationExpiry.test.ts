import { describe, it, expect } from "vitest";
import {
  CERT_EXPIRY_LABEL,
  EXPIRING_SOON_DAYS,
  certExpiryStatus,
  compareByExpiryUrgency,
  countByExpiryStatus,
  daysUntilExpiry,
  expiryDescription,
  needsAttention,
} from "./certificationExpiry";

// A fixed "now" so none of this depends on when the suite runs. Midday UTC,
// matching how the tenant stores date-only columns.
const NOW = new Date("2026-07-29T12:00:00Z");
const at = (iso: string) => new Date(iso);

describe("daysUntilExpiry", () => {
  it("counts whole days ahead", () => {
    expect(daysUntilExpiry(at("2026-08-08T12:00:00Z"), NOW)).toBe(10);
  });

  it("is 0 on the expiry day itself", () => {
    expect(daysUntilExpiry(at("2026-07-29T12:00:00Z"), NOW)).toBe(0);
  });

  it("goes negative once past", () => {
    expect(daysUntilExpiry(at("2026-07-27T12:00:00Z"), NOW)).toBe(-2);
  });

  it("ignores the time of day on either side", () => {
    // Same calendar day, wildly different clock times — still 0 days.
    expect(daysUntilExpiry(at("2026-07-29T23:59:00Z"), at("2026-07-29T00:01:00Z"))).toBe(0);
  });

  it("returns null for a missing or invalid date", () => {
    expect(daysUntilExpiry(null, NOW)).toBeNull();
    expect(daysUntilExpiry(new Date("nonsense"), NOW)).toBeNull();
  });
});

describe("certExpiryStatus", () => {
  it("treats the expiry day as still valid, not expired", () => {
    // A certificate is good through its expiry date; calling it expired that
    // morning would have people chasing a renewal a day early.
    expect(certExpiryStatus(at("2026-07-29T12:00:00Z"), NOW)).toBe("expiringSoon");
  });

  it("is expired the day after", () => {
    expect(certExpiryStatus(at("2026-07-28T12:00:00Z"), NOW)).toBe("expired");
  });

  it("flags anything inside the lead time as expiring soon", () => {
    expect(certExpiryStatus(at("2026-09-01T12:00:00Z"), NOW)).toBe("expiringSoon");
  });

  it("includes the boundary day itself, so nothing falls between buckets", () => {
    const boundary = new Date(NOW);
    boundary.setUTCDate(boundary.getUTCDate() + EXPIRING_SOON_DAYS);
    expect(certExpiryStatus(boundary, NOW)).toBe("expiringSoon");

    const justPast = new Date(NOW);
    justPast.setUTCDate(justPast.getUTCDate() + EXPIRING_SOON_DAYS + 1);
    expect(certExpiryStatus(justPast, NOW)).toBe("current");
  });

  it("is current when comfortably ahead", () => {
    expect(certExpiryStatus(at("2027-06-01T12:00:00Z"), NOW)).toBe("current");
  });

  it("separates 'no expiry recorded' from 'current'", () => {
    // A missing date is a data gap to chase, not a clean bill of health.
    expect(certExpiryStatus(null, NOW)).toBe("none");
  });

  it("honours a custom lead time", () => {
    expect(certExpiryStatus(at("2026-08-20T12:00:00Z"), NOW, 7)).toBe("current");
    expect(certExpiryStatus(at("2026-08-02T12:00:00Z"), NOW, 7)).toBe("expiringSoon");
  });

  it("has a label for every status", () => {
    expect(Object.keys(CERT_EXPIRY_LABEL).sort()).toEqual(
      ["current", "expired", "expiringSoon", "none"].sort(),
    );
  });
});

describe("expiryDescription", () => {
  it("describes the near cases in the words people use", () => {
    expect(expiryDescription(at("2026-07-29T12:00:00Z"), NOW)).toBe("Expires today");
    expect(expiryDescription(at("2026-07-30T12:00:00Z"), NOW)).toBe("Expires tomorrow");
    expect(expiryDescription(at("2026-07-28T12:00:00Z"), NOW)).toBe("Expired yesterday");
  });

  it("counts days when close and months when not", () => {
    expect(expiryDescription(at("2026-08-08T12:00:00Z"), NOW)).toBe("Expires in 10 days");
    expect(expiryDescription(at("2026-11-01T12:00:00Z"), NOW)).toMatch(/about 3 months/);
  });

  it("pluralises a single month", () => {
    expect(expiryDescription(at("2026-09-15T12:00:00Z"), NOW)).toMatch(/about 2 months/);
    expect(expiryDescription(at("2026-06-01T12:00:00Z"), NOW)).toMatch(/^Expired \d+ days ago$/);
  });

  it("says so when there's no date", () => {
    expect(expiryDescription(null, NOW)).toBe("No expiry date recorded");
  });
});

describe("compareByExpiryUrgency", () => {
  it("puts the most urgent first and undated last", () => {
    const dates: Array<Date | null> = [
      at("2027-01-01T12:00:00Z"), // current
      null, // no date
      at("2026-07-01T12:00:00Z"), // expired
      at("2026-08-10T12:00:00Z"), // expiring soon
    ];
    const sorted = [...dates].sort((a, b) => compareByExpiryUrgency(a, b, NOW));
    expect(sorted.map((d) => (d === null ? "none" : certExpiryStatus(d, NOW)))).toEqual([
      "expired",
      "expiringSoon",
      "current",
      "none",
    ]);
  });

  it("treats two undated records as equal", () => {
    expect(compareByExpiryUrgency(null, null, NOW)).toBe(0);
  });
});

describe("countByExpiryStatus", () => {
  it("tallies each bucket", () => {
    const counts = countByExpiryStatus(
      [
        at("2026-07-01T12:00:00Z"),
        at("2026-07-02T12:00:00Z"),
        at("2026-08-10T12:00:00Z"),
        at("2027-05-01T12:00:00Z"),
        null,
      ],
      NOW,
    );
    expect(counts).toEqual({ expired: 2, expiringSoon: 1, current: 1, none: 1 });
  });

  it("returns zeroes for an empty list", () => {
    expect(countByExpiryStatus([], NOW)).toEqual({
      expired: 0,
      expiringSoon: 0,
      current: 0,
      none: 0,
    });
  });
});

describe("needsAttention", () => {
  it("covers expired and expiring, not current or undated", () => {
    expect(needsAttention(at("2026-07-01T12:00:00Z"), NOW)).toBe(true);
    expect(needsAttention(at("2026-08-10T12:00:00Z"), NOW)).toBe(true);
    expect(needsAttention(at("2027-05-01T12:00:00Z"), NOW)).toBe(false);
    expect(needsAttention(null, NOW)).toBe(false);
  });
});
