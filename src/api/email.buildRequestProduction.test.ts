import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// WHICH configured list feeds WHICH build request production alert — the same
// reasoning as email.eirStatusAlerts.test.ts: the builders take Person[] and
// the hook tests mock @/api/email, so only this file runs the config reads.
// Each list holds a DIFFERENT person so a swapped constant shows.
// =============================================================================

const graphFetch = vi.hoisted(() =>
  vi.fn(async (_path: string, _init?: RequestInit) => ({})),
);

vi.mock("./graph", () => ({
  graphFetch,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SHARED_MAILBOX: "automation@altronic-llc.com",
    BUILD_REQUEST_PRODUCTION_ALERTS: "Prod Queue <prod.queue@altronic-llc.com>",
    BUILD_REQUEST_COMPLETE_REVIEWERS: "Review Queue <review.queue@altronic-llc.com>",
    BUILD_REQUEST_FINAL_ALERTS: "Final Queue <final.queue@altronic-llc.com>",
  };
});

const email = await import("./email");

type Addr = { emailAddress: { address: string } };

/** Each message sent: everyone it went to (To or Bcc), its subject and HTML. */
function sent(): { to: string[]; subject: string; html: string }[] {
  return graphFetch.mock.calls
    .filter(([path]) => String(path).includes("/sendMail"))
    .map(([, init]) => {
      const m = JSON.parse(String(init?.body)).message;
      return {
        to: [...(m.toRecipients ?? []), ...(m.bccRecipients ?? [])].map((r: Addr) =>
          r.emailAddress.address.toLowerCase(),
        ),
        subject: m.subject,
        html: m.body.content,
      };
    });
}

/** Everyone reached, across every message, in send order. */
function reached(): string[] {
  return sent().flatMap((m) => m.to);
}

/**
 * Wait for the fire-and-forget sends to land — ALL of them. Each send first
 * awaits a Web Crypto digest (the Outlook thread index), so a fixed number of
 * ticks isn't enough under full-suite load: a slow send then leaks into the
 * NEXT test, which sees doubles while this one sees none.
 */
async function settle(expected = 1): Promise<void> {
  await vi.waitFor(() =>
    expect(
      graphFetch.mock.calls.filter(([path]) => String(path).includes("/sendMail")),
    ).toHaveLength(expected),
  );
}

const ENGINEER = { displayName: "Femi Olugbon", email: "femi.olugbon@altronic-llc.com" };
const REQUESTOR = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };
const WATCHER = { displayName: "Brandon Mirto", email: "brandon.mirto@altronic-llc.com" };
const PART_WATCHER = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com" };
const ACTOR = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };

const BR = {
  id: 9,
  brNo: "BR_2026-0070",
  title: "Panel build",
  engineerAssigned: ENGINEER,
  requestor: REQUESTOR,
  watchers: [WATCHER],
};

beforeEach(() => graphFetch.mockClear());

describe("fireBuildRequestReadyForProductionAlert", () => {
  it("uses the production queue plus the request's people, linked to the build request", async () => {
    email.fireBuildRequestReadyForProductionAlert({ buildRequest: BR, actor: ACTOR });
    // The queue's email is worded for the queue; the request's people share one.
    await settle(2);
    expect(sent().map((m) => m.to)).toEqual([
      ["prod.queue@altronic-llc.com"],
      [ENGINEER.email, WATCHER.email, REQUESTOR.email],
    ]);
    expect(sent()[0].html).toContain("/build-request/9");
    expect(reached()).not.toContain("review.queue@altronic-llc.com");
  });
});

describe("fireBuildRequestPartProductionCompleteAlert", () => {
  it("reaches no queue and links to the PART", async () => {
    email.fireBuildRequestPartProductionCompleteAlert({
      buildRequest: BR,
      part: { id: 41, partNumber: "791950-16", watchers: [PART_WATCHER] },
      actor: ACTOR,
    });
    await settle(1);
    expect(reached()).toEqual([
      ENGINEER.email,
      WATCHER.email,
      PART_WATCHER.email,
      REQUESTOR.email,
    ]);
    expect(sent()[0].html).toContain("/build-request-item/41");
  });
});

describe("fireBuildRequestProductionCompleteAlert", () => {
  it("asks only the complete reviewers", async () => {
    email.fireBuildRequestProductionCompleteAlert({ buildRequest: BR, actor: ACTOR });
    await settle();
    expect(reached()).toEqual(["review.queue@altronic-llc.com"]);
  });
});

describe("fireBuildRequestCompleteAlert", () => {
  it("uses the final queue plus watchers, engineer and requestor", async () => {
    email.fireBuildRequestCompleteAlert({ buildRequest: BR, actor: ACTOR });
    await settle(1);
    expect(reached()).toEqual([
      "final.queue@altronic-llc.com",
      WATCHER.email,
      ENGINEER.email,
      REQUESTOR.email,
    ]);
  });

  it("falls back to the title when there is no BR No.", async () => {
    email.fireBuildRequestCompleteAlert({ buildRequest: { ...BR, brNo: "" }, actor: ACTOR });
    await settle(1);
    // The subject is the request's own (one Outlook conversation per request);
    // what happened is the hidden preview line.
    expect(sent()[0].subject).toBe("Panel build");
    expect(sent()[0].html).toContain(">Build request complete: Panel build</div>");
  });

  it("is subjected 'BR No — title', like the request's comment emails", async () => {
    email.fireBuildRequestCompleteAlert({ buildRequest: BR, actor: ACTOR });
    await settle(1);
    expect(sent()[0].subject).toBe("BR_2026-0070 — Panel build");
  });
});
