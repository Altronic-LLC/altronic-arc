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

function sent(): { to: string; subject: string; html: string }[] {
  return graphFetch.mock.calls
    .filter(([path]) => String(path).includes("/sendMail"))
    .map(([, init]) => {
      const m = JSON.parse(String(init?.body)).message;
      return {
        to: m.toRecipients[0].emailAddress.address.toLowerCase(),
        subject: m.subject,
        html: m.body.content,
      };
    });
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
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
    await settle();
    const mails = sent();
    expect(mails.map((m) => m.to)).toEqual([
      "prod.queue@altronic-llc.com",
      ENGINEER.email,
      WATCHER.email,
      REQUESTOR.email,
    ]);
    expect(mails[0].html).toContain("/build-request/9");
    expect(mails.map((m) => m.to)).not.toContain("review.queue@altronic-llc.com");
  });
});

describe("fireBuildRequestPartProductionCompleteAlert", () => {
  it("reaches no queue and links to the PART", async () => {
    email.fireBuildRequestPartProductionCompleteAlert({
      buildRequest: BR,
      part: { id: 41, partNumber: "791950-16", watchers: [PART_WATCHER] },
      actor: ACTOR,
    });
    await settle();
    const mails = sent();
    expect(mails.map((m) => m.to)).toEqual([
      ENGINEER.email,
      WATCHER.email,
      PART_WATCHER.email,
      REQUESTOR.email,
    ]);
    expect(mails[0].html).toContain("/build-request-item/41");
  });
});

describe("fireBuildRequestProductionCompleteAlert", () => {
  it("asks only the complete reviewers", async () => {
    email.fireBuildRequestProductionCompleteAlert({ buildRequest: BR, actor: ACTOR });
    await settle();
    expect(sent().map((m) => m.to)).toEqual(["review.queue@altronic-llc.com"]);
  });
});

describe("fireBuildRequestCompleteAlert", () => {
  it("uses the final queue plus watchers, engineer and requestor", async () => {
    email.fireBuildRequestCompleteAlert({ buildRequest: BR, actor: ACTOR });
    await settle();
    expect(sent().map((m) => m.to)).toEqual([
      "final.queue@altronic-llc.com",
      WATCHER.email,
      ENGINEER.email,
      REQUESTOR.email,
    ]);
  });

  it("falls back to the title when there is no BR No.", async () => {
    email.fireBuildRequestCompleteAlert({ buildRequest: { ...BR, brNo: "" }, actor: ACTOR });
    await settle();
    expect(sent()[0].subject).toBe("Build request complete: Panel build");
  });
});
