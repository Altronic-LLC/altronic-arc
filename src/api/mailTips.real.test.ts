import { describe, it, expect, vi, beforeEach } from "vitest";

// getMailTips in REAL mode — the request shape is invisible from mock mode.

const graphFetchScoped = vi.hoisted(() =>
  vi.fn(async (_path: string, _scopes: string[], _init?: RequestInit): Promise<unknown> => ({ value: [] })),
);

vi.mock("./graph", () => ({ graphFetchScoped }));

// The signer answers to two addresses (a UPN is not a mailbox).
vi.mock("./currentUser", () => ({
  resolveMyIdentity: async () => ({
    primary: "brandon.mirto@altronic-llc.com",
    all: ["brandon.mirto@altronic-llc.com", "bmirto@altronic-llc.com"],
  }),
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false };
});

const { findOutOfOffice, MAIL_TIPS_BATCH, MAIL_TIPS_CACHE_MS, __resetMailTipsCache } = await import("./mailTips");

const NOW = new Date("2026-11-25T15:00:00Z");

function body(call: number) {
  return JSON.parse(String(graphFetchScoped.mock.calls[call][2]?.body));
}

beforeEach(() => {
  __resetMailTipsCache();
  graphFetchScoped.mockReset();
  graphFetchScoped.mockImplementation(async () => ({ value: [] }));
});

describe("findOutOfOffice (real mode)", () => {
  it("asks /me/getMailTips for automatic replies, on the narrow scope, in UTC", async () => {
    graphFetchScoped.mockResolvedValueOnce({
      value: [{ emailAddress: { address: "glenn.terry@altronic-llc.com" }, automaticReplies: { message: "Away" } }],
    });
    const away = await findOutOfOffice(
      [
        { email: "glenn.terry@altronic-llc.com", displayName: "Glenn Terry" },
        { email: "Glenn.Terry@altronic-llc.com", displayName: "Glenn Terry" },
      ],
      NOW,
    );
    const [path, scopes, init] = graphFetchScoped.mock.calls[0];
    expect(path).toBe("/me/getMailTips");
    expect(scopes).toEqual(["MailTips.ReadBasic.Shared"]);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ Prefer: 'outlook.timezone="UTC"' });
    expect(body(0)).toEqual({ EmailAddresses: ["glenn.terry@altronic-llc.com"], MailTipsOptions: "automaticReplies" });
    expect(away.map((p) => p.displayName)).toEqual(["Glenn Terry"]);
  });

  it("splits a long list into batches", async () => {
    const people = Array.from({ length: MAIL_TIPS_BATCH + 3 }, (_, i) => ({
      email: `p${i}@altronic-llc.com`,
      displayName: `P ${i}`,
    }));
    await findOutOfOffice(people, NOW);
    expect(graphFetchScoped).toHaveBeenCalledTimes(2);
    expect(body(0).EmailAddresses).toHaveLength(MAIL_TIPS_BATCH);
    expect(body(1).EmailAddresses).toHaveLength(3);
  });

  it("asks nothing for nobody", async () => {
    expect(await findOutOfOffice([{ email: " ", displayName: "x" }], NOW)).toEqual([]);
    expect(graphFetchScoped).not.toHaveBeenCalled();
  });

  it("returns nobody, never throws, when the scope isn't consented", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    graphFetchScoped.mockRejectedValueOnce(new Error("consent_required"));
    await expect(findOutOfOffice([{ email: "a@altronic-llc.com", displayName: "A" }], NOW)).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("asks about each person once per 15 minutes — only a NEW name is looked up", async () => {
    graphFetchScoped.mockImplementation(async (_p, _s, init) => ({
      value: JSON.parse(String(init?.body)).EmailAddresses.map((address: string) => ({
        emailAddress: { address },
        automaticReplies: { message: address.startsWith("glenn") ? "Away" : "" },
      })),
    }));
    const glenn = { email: "glenn.terry@altronic-llc.com", displayName: "Glenn Terry" };
    const sarah = { email: "sarah.shaffer@altronic-llc.com", displayName: "Sarah Shaffer" };

    expect((await findOutOfOffice([glenn], NOW)).map((p) => p.displayName)).toEqual(["Glenn Terry"]);
    expect((await findOutOfOffice([glenn, sarah], NOW)).map((p) => p.displayName)).toEqual(["Glenn Terry"]);
    expect(graphFetchScoped).toHaveBeenCalledTimes(2);
    expect(body(1).EmailAddresses).toEqual([sarah.email]);

    // Nothing new: answered from memory, both the away and the not-away.
    await findOutOfOffice([glenn, sarah], NOW);
    expect(graphFetchScoped).toHaveBeenCalledTimes(2);

    // Fifteen minutes on, asked again.
    const later = new Date(NOW.getTime() + MAIL_TIPS_CACHE_MS);
    await findOutOfOffice([glenn, sarah], later);
    expect(graphFetchScoped).toHaveBeenCalledTimes(3);
  });

  it("stops showing a cached reply once its schedule has ended", async () => {
    graphFetchScoped.mockResolvedValueOnce({
      value: [
        {
          emailAddress: { address: "glenn.terry@altronic-llc.com" },
          automaticReplies: { message: "Away", scheduledEndTime: { dateTime: "2026-11-25T15:05:00", timeZone: "UTC" } },
        },
      ],
    });
    const glenn = { email: "glenn.terry@altronic-llc.com", displayName: "Glenn Terry" };
    expect(await findOutOfOffice([glenn], NOW)).toHaveLength(1);
    expect(await findOutOfOffice([glenn], new Date(NOW.getTime() + 10 * 60 * 1000))).toEqual([]);
  });

  it("after a failure, doesn't ask again for 15 minutes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    graphFetchScoped.mockRejectedValue(new Error("consent_required"));
    const a = { email: "a@altronic-llc.com", displayName: "A" };
    await findOutOfOffice([a], NOW);
    await findOutOfOffice([a, { email: "b@altronic-llc.com", displayName: "B" }], NOW);
    expect(graphFetchScoped).toHaveBeenCalledTimes(1);
    await findOutOfOffice([a], new Date(NOW.getTime() + MAIL_TIPS_CACHE_MS));
    expect(graphFetchScoped).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("never asks about the person writing the comment, by any of their addresses", async () => {
    await findOutOfOffice(
      [
        { email: "BMirto@altronic-llc.com", displayName: "Brandon Mirto" },
        { email: "glenn.terry@altronic-llc.com", displayName: "Glenn Terry" },
      ],
      NOW,
    );
    expect(body(0).EmailAddresses).toEqual(["glenn.terry@altronic-llc.com"]);
  });
});
