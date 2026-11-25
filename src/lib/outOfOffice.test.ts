import { describe, it, expect } from "vitest";
import {
  awayRecipients,
  outOfOfficeExcerpt,
  outOfOfficeHeadline,
  parseGraphDateTime,
  OUT_OF_OFFICE_EXCERPT_CHARS,
  type GraphMailTips,
} from "./outOfOffice";

const NOW = new Date("2026-11-25T15:00:00Z");
const NAMES = new Map([
  ["glenn.terry@altronic-llc.com", "Glenn Terry"],
  ["sarah.shaffer@altronic-llc.com", "Sarah Shaffer"],
]);

function tip(address: string, message: string, extra: Partial<NonNullable<GraphMailTips["automaticReplies"]>> = {}): GraphMailTips {
  return { emailAddress: { address }, automaticReplies: { message, ...extra } };
}

describe("parseGraphDateTime", () => {
  it("reads Graph's zone-less UTC time as UTC", () => {
    expect(parseGraphDateTime({ dateTime: "2026-12-02T08:00:00.0000000", timeZone: "UTC" })?.toISOString()).toBe(
      "2026-12-02T08:00:00.000Z",
    );
  });
  it("keeps an explicit offset", () => {
    expect(parseGraphDateTime({ dateTime: "2026-12-02T08:00:00-05:00", timeZone: "UTC" })?.toISOString()).toBe(
      "2026-12-02T13:00:00.000Z",
    );
  });
  it("is null for nothing or nonsense", () => {
    expect(parseGraphDateTime(undefined)).toBeNull();
    expect(parseGraphDateTime({ dateTime: "", timeZone: "UTC" })).toBeNull();
    expect(parseGraphDateTime({ dateTime: "soon", timeZone: "UTC" })).toBeNull();
  });
});

describe("outOfOfficeExcerpt", () => {
  it("turns an HTML reply into one line of plain text", () => {
    expect(outOfOfficeExcerpt("<html><body><p>I'm away&nbsp;until Monday.</p><p>Call Ray.</p></body></html>")).toBe(
      "I'm away until Monday. Call Ray.",
    );
  });
  it("cuts a long reply at a word, with an ellipsis", () => {
    const long = "word ".repeat(100);
    const out = outOfOfficeExcerpt(long);
    expect(out.length).toBeLessThanOrEqual(OUT_OF_OFFICE_EXCERPT_CHARS + 1);
    expect(out.endsWith("word…")).toBe(true);
  });
});

describe("awayRecipients", () => {
  it("lists only people with an automatic reply, named from ARC", () => {
    const away = awayRecipients(
      [tip("Glenn.Terry@altronic-llc.com", "Away"), tip("sarah.shaffer@altronic-llc.com", "")],
      NAMES,
      NOW,
    );
    expect(away).toEqual([{ email: "Glenn.Terry@altronic-llc.com", displayName: "Glenn Terry", message: "Away", until: null }]);
  });

  it("skips a reply scheduled to start later, and one whose schedule has ended", () => {
    const later = tip("glenn.terry@altronic-llc.com", "Away", {
      scheduledStartTime: { dateTime: "2026-11-26T00:00:00", timeZone: "UTC" },
    });
    const over = tip("sarah.shaffer@altronic-llc.com", "Away", {
      scheduledEndTime: { dateTime: "2026-11-25T14:00:00", timeZone: "UTC" },
    });
    expect(awayRecipients([later, over], NAMES, NOW)).toEqual([]);
  });

  it("counts a reply inside its schedule and keeps the end date", () => {
    const [p] = awayRecipients(
      [
        tip("glenn.terry@altronic-llc.com", "Away", {
          scheduledStartTime: { dateTime: "2026-11-24T00:00:00", timeZone: "UTC" },
          scheduledEndTime: { dateTime: "2026-12-02T12:00:00", timeZone: "UTC" },
        }),
      ],
      NAMES,
      NOW,
    );
    expect(p.until?.toISOString()).toBe("2026-12-02T12:00:00.000Z");
  });

  it("skips a recipient Exchange couldn't answer for, and counts a person once", () => {
    const away = awayRecipients(
      [
        { ...tip("outside@example.com", "Away"), error: { code: "x", message: "no" } },
        tip("glenn.terry@altronic-llc.com", "Away"),
        tip("GLENN.TERRY@altronic-llc.com", "Away"),
      ],
      NAMES,
      NOW,
    );
    expect(away.map((p) => p.displayName)).toEqual(["Glenn Terry"]);
  });

  it("falls back to Exchange's name, then the address", () => {
    const away = awayRecipients(
      [
        { emailAddress: { address: "a@x.com", name: "A Person" }, automaticReplies: { message: "Away" } },
        tip("b@x.com", "Away"),
      ],
      new Map(),
      NOW,
    );
    expect(away.map((p) => p.displayName)).toEqual(["A Person", "b@x.com"]);
  });
});

describe("outOfOfficeHeadline", () => {
  const glenn = { email: "g@x.com", displayName: "Glenn Terry", message: "Back Monday.", until: null };
  it("names the person", () => {
    expect(outOfOfficeHeadline(glenn)).toBe("Glenn Terry is out of office");
  });
  it("adds the return date when there is one", () => {
    expect(outOfOfficeHeadline({ ...glenn, until: new Date(2026, 11, 2, 12) })).toMatch(
      /^Glenn Terry is out of office until \S+ 2$/,
    );
  });
});
