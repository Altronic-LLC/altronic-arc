// =============================================================================
// Expiry status for certification records (CSA Listings today; any dated
// certificate later).
//
// Deliberately knows nothing about SharePoint or about CSA Listings' columns —
// it takes a Date and answers "where does this sit relative to now". That keeps
// it usable from the table's status filter, the row badges, and the dashboard
// count without any of them re-deriving the rules.
//
// Dates here are date-only values, which in this tenant are stored at midday
// UTC (see src/lib/teradyneMapper.ts for why). Comparisons therefore work in
// whole UTC days: "expires today" must not flip to "expired" merely because the
// browser is west of Greenwich and the clock has passed midnight there.
// =============================================================================

/**
 * How far ahead counts as "expiring soon".
 *
 * 90 days because a certification renewal is not a same-week job — paperwork,
 * a lab slot and an auditor all have to line up. If that turns out to be the
 * wrong lead time for CSA specifically, this is the one number to change.
 */
export const EXPIRING_SOON_DAYS = 90;

export const CERT_EXPIRY_STATUSES = ["expired", "expiringSoon", "current", "none"] as const;
export type CertExpiryStatus = (typeof CERT_EXPIRY_STATUSES)[number];

/** Midnight UTC on the day `date` falls in — strips the time so days compare cleanly. */
function utcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole UTC days from `now` until `expiry`. Negative once it's in the past,
 * 0 on the day itself.
 *
 * Both sides are floored to their UTC day first, so the answer doesn't drift
 * with the time of day the page happens to be open.
 */
export function daysUntilExpiry(expiry: Date | null, now: Date = new Date()): number | null {
  if (!expiry || Number.isNaN(expiry.getTime())) return null;
  return Math.round((utcDayStart(expiry) - utcDayStart(now)) / MS_PER_DAY);
}

/**
 * Which bucket a certificate is in.
 *
 * - `expired` — the expiry day has passed. The day itself is NOT expired: a
 *   certificate is valid through its expiry date.
 * - `expiringSoon` — within `EXPIRING_SOON_DAYS`, inclusive of today and of the
 *   boundary day, so nothing can fall between the two buckets.
 * - `current` — further out than that.
 * - `none` — no expiry recorded. Distinct from `current` on purpose: "we don't
 *   know" is a data gap worth seeing, not a clean bill of health.
 */
export function certExpiryStatus(
  expiry: Date | null,
  now: Date = new Date(),
  soonDays: number = EXPIRING_SOON_DAYS,
): CertExpiryStatus {
  const days = daysUntilExpiry(expiry, now);
  if (days === null) return "none";
  if (days < 0) return "expired";
  if (days <= soonDays) return "expiringSoon";
  return "current";
}

/** Short human label for a status — used on badges and filter pills. */
export const CERT_EXPIRY_LABEL: Record<CertExpiryStatus, string> = {
  expired: "Expired",
  expiringSoon: "Expiring soon",
  current: "Current",
  none: "No expiry set",
};

/**
 * A sentence for the badge tooltip / detail line: how long is left, in the
 * units someone would actually say out loud.
 */
export function expiryDescription(expiry: Date | null, now: Date = new Date()): string {
  const days = daysUntilExpiry(expiry, now);
  if (days === null) return "No expiry date recorded";
  if (days < 0) {
    const ago = Math.abs(days);
    return ago === 1 ? "Expired yesterday" : `Expired ${ago} days ago`;
  }
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  if (days < 45) return `Expires in ${days} days`;
  const months = Math.round(days / 30);
  return `Expires in about ${months} ${months === 1 ? "month" : "months"}`;
}

/**
 * Sort comparator putting whatever needs attention first: expired, then
 * expiring soonest, then current by date, then records with no expiry at all.
 *
 * Undated records sort last rather than first — they're a gap to fill, not an
 * emergency, and burying real expiries under them would defeat the point.
 */
export function compareByExpiryUrgency(
  a: Date | null,
  b: Date | null,
  now: Date = new Date(),
): number {
  const da = daysUntilExpiry(a, now);
  const db = daysUntilExpiry(b, now);
  if (da === null && db === null) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  return da - db;
}

/** Count each bucket — what the dashboard card and the filter pills need. */
export function countByExpiryStatus(
  expiries: Array<Date | null>,
  now: Date = new Date(),
  soonDays: number = EXPIRING_SOON_DAYS,
): Record<CertExpiryStatus, number> {
  const counts: Record<CertExpiryStatus, number> = {
    expired: 0,
    expiringSoon: 0,
    current: 0,
    none: 0,
  };
  for (const expiry of expiries) counts[certExpiryStatus(expiry, now, soonDays)] += 1;
  return counts;
}

/** True when a record wants someone's attention — the dashboard's headline number. */
export function needsAttention(expiry: Date | null, now: Date = new Date()): boolean {
  const status = certExpiryStatus(expiry, now);
  return status === "expired" || status === "expiringSoon";
}
