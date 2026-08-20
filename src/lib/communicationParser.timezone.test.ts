import { describe, it, expect } from "vitest";
import {
  appendComment,
  parseCommunication,
  serializeComment,
} from "./communicationParser";

// Comments are stamped with a bare wall-clock string that carries no zone.
// Written in the author's local time and read in the reader's, records from
// different zones weren't comparable and threads came out shuffled (reported
// 2026-08-18). Every record is now written and read in ONE zone — Eastern.
//
// These tests set the process time zone explicitly rather than trusting the
// runner's, because the whole bug is "it depends where you are".

// No @types/node in this project's tsconfig, so reach process.env explicitly.
const env = (globalThis as unknown as {
  process: { env: Record<string, string | undefined> };
}).process.env;

function withTimeZone<T>(tz: string, fn: () => T): T {
  const previous = env.TZ;
  env.TZ = tz;
  try {
    return fn();
  } finally {
    env.TZ = previous;
  }
}

/** One comment record, stamped at a real instant, written from `tz`. */
function recordPostedFrom(tz: string, isoInstant: string, author: string): string {
  return withTimeZone(tz, () =>
    serializeComment({
      timestamp: new Date(isoInstant),
      authorName: author,
      authorEmail: `${author.toLowerCase()}@altronic-llc.com`,
      bodyHtml: `<p>${author}</p>`,
    }),
  );
}

describe("comment timestamps — one clock for every author", () => {
  it("stamps the Eastern wall clock whatever zone the author is in", () => {
    // 14:30 UTC on a summer day is 10:30 EDT.
    const fromIndia = recordPostedFrom("Asia/Kolkata", "2026-07-15T14:30:00Z", "Asha");
    const fromHouston = recordPostedFrom("America/Chicago", "2026-07-15T14:30:00Z", "Ray");

    expect(fromIndia.startsWith("07/15/2026 10:30:00 AM")).toBe(true);
    expect(fromHouston.startsWith("07/15/2026 10:30:00 AM")).toBe(true);
  });

  it("keeps a thread in posting order across time zones", () => {
    // The exact shape of the bug: the earlier comment is posted from a zone
    // whose local clock reads LATER, so a naive stamp sorts it first.
    const early = recordPostedFrom("Asia/Kolkata", "2026-07-15T03:30:00Z", "Asha"); // 09:00 IST
    const late = recordPostedFrom("America/Chicago", "2026-07-15T13:00:00Z", "Ray"); // 08:00 CDT

    const comments = parseCommunication(`${early}\n${late}`);

    // Newest first.
    expect(comments.map((c) => c.authorName)).toEqual(["Ray", "Asha"]);
  });

  it("reads a record back as the instant it was posted, from any reader's zone", () => {
    const record = recordPostedFrom("America/New_York", "2026-07-15T14:30:00Z", "Ray");

    const fromIndia = withTimeZone("Asia/Kolkata", () => parseCommunication(record));
    const fromHouston = withTimeZone("America/Chicago", () => parseCommunication(record));

    expect(fromIndia[0].timestamp.toISOString()).toBe("2026-07-15T14:30:00.000Z");
    expect(fromHouston[0].timestamp.toISOString()).toBe("2026-07-15T14:30:00.000Z");
  });

  it("round-trips a timestamp through storage unchanged", () => {
    const instant = new Date("2026-02-03T21:07:42Z"); // winter: EST, UTC-5
    const record = serializeComment({
      timestamp: instant,
      authorName: "Ray",
      authorEmail: "ray@altronic-llc.com",
      bodyHtml: "<p>hi</p>",
    });

    expect(record.startsWith("02/03/2026 4:07:42 PM")).toBe(true);
    expect(parseCommunication(record)[0].timestamp.toISOString()).toBe(
      instant.toISOString(),
    );
  });

  it("handles both sides of the daylight-saving switch", () => {
    // 2026-03-08 is the US spring-forward date: 06:59 UTC is 01:59 EST,
    // 07:00 UTC is 03:00 EDT.
    const before = serializeComment({
      timestamp: new Date("2026-03-08T06:59:00Z"),
      authorName: "A",
      authorEmail: "a@x.com",
      bodyHtml: "<p>a</p>",
    });
    const after = serializeComment({
      timestamp: new Date("2026-03-08T07:00:00Z"),
      authorName: "B",
      authorEmail: "b@x.com",
      bodyHtml: "<p>b</p>",
    });

    expect(before.startsWith("03/08/2026 1:59:00 AM")).toBe(true);
    expect(after.startsWith("03/08/2026 3:00:00 AM")).toBe(true);

    // And they still come back in the right order, one minute apart.
    const comments = parseCommunication(`${before}\n${after}`);
    expect(comments.map((c) => c.authorName)).toEqual(["B", "A"]);
    expect(
      comments[0].timestamp.getTime() - comments[1].timestamp.getTime(),
    ).toBe(60_000);
  });

  it("stamps a new comment on the same clock as the stored ones", () => {
    const stored = recordPostedFrom("America/New_York", "2026-07-15T14:30:00Z", "Ray");
    const raw = withTimeZone("Asia/Kolkata", () =>
      appendComment(stored, {
        authorName: "Asha",
        authorEmail: "asha@altronic-llc.com",
        bodyHtml: "<p>later</p>",
      }),
    );

    const comments = parseCommunication(raw);
    // The new one is genuinely later than the stored one, from either zone.
    expect(comments[0].authorName).toBe("Asha");
    expect(comments[0].timestamp.getTime()).toBeGreaterThan(
      comments[1].timestamp.getTime(),
    );
  });
});
