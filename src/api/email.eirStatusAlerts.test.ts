import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// WHICH configured list feeds WHICH alert.
//
// Nothing pinned this. The builders take `Person[]` and the hook tests mock
// `@/api/email` wholesale, so the only code that reads the config constants —
// the two `fire*` wrappers — was never executed by a test. That is precisely
// the hazard config.ts warns about in its own doc comment: the "Response
// Accepted" pair and the "missing project reference" reviewers have the SAME
// default pair today, so swapping the two constants would be invisible until
// somebody changed one list and the wrong alert moved with it.
// =============================================================================

const graphFetch = vi.hoisted(() =>
  vi.fn(async (_path: string, _init?: RequestInit) => ({})),
);

// Only GRAPH is stubbed. The wrappers, the builders and notifyChangeEmails are
// all the real ones, so this exercises the whole path from "a status changed"
// to "this address is in the To line" — which is where a swapped config
// constant would show up and nowhere else.
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
    // Deliberately DIFFERENT people in each list, so a swapped constant shows.
    EIR_RESPONSE_ACCEPTED_ALERTS: "Sheila Horn <sheila.horn@altronic-llc.com>",
    EIR_TRIAGE_ASSIGNERS: "Glenn Terry <glenn.terry@altronic-llc.com>",
    EIR_TRIAGE_PROJECT_REVIEWERS: "Somebody Else <somebody.else@altronic-llc.com>",
  };
});

const email = await import("./email");

/** Every address the sendMail calls were addressed to, in order. */
function sentTo(): string[] {
  return graphFetch.mock.calls
    .filter(([path]) => String(path).includes("/sendMail"))
    .map(([, init]) => {
      const body = JSON.parse(String(init?.body));
      return body.message.toRecipients
        .map((r: { emailAddress: { address: string } }) => r.emailAddress.address)
        .join(",");
    });
}

/** The rendered HTML of the nth sent message. */
function sentHtml(n = 0): string {
  const call = graphFetch.mock.calls.filter(([path]) => String(path).includes("/sendMail"))[n];
  if (!call) throw new Error("no sendMail call to read");
  return JSON.parse(String(call[1]?.body)).message.body.content;
}

/** Wait for the fire-and-forget sends to land. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const TARGET = { kind: "eir" as const, id: 7, title: "EIR_2026-0042" };
const ACTOR = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" };

beforeEach(() => {
  graphFetch.mockClear();
});

describe("fireEirResponseAcceptedAlert", () => {
  it("addresses the Response Accepted list, not the project reviewers", async () => {
    email.fireEirResponseAcceptedAlert({ target: TARGET, actor: ACTOR });
    await settle();
    expect(sentTo()).toEqual(["sheila.horn@altronic-llc.com"]);
  });

  it("asks for the EIR to be closed", async () => {
    email.fireEirResponseAcceptedAlert({ target: TARGET, actor: ACTOR });
    await settle();
    expect(sentHtml()).toContain("Please close it");
  });
});

describe("fireEirResponseNotAcceptedAlert", () => {
  it("goes to the assigned engineer when there is one", async () => {
    email.fireEirResponseNotAcceptedAlert({
      target: TARGET,
      actor: ACTOR,
      engineers: [{ displayName: "Thomas Terhune", email: "thomas.terhune@altronic-llc.com" }],
    });
    await settle();
    expect(sentTo()).toEqual(["thomas.terhune@altronic-llc.com"]);
    expect(sentHtml()).toContain("more detailed response");
  });

  // The fallback is the ASSIGNERS list, not the Response Accepted pair — they
  // are the people who put an engineer on an EIR.
  it("falls back to the triage assigners, not to Sheila", async () => {
    email.fireEirResponseNotAcceptedAlert({ target: TARGET, actor: ACTOR, engineers: [] });
    await settle();
    expect(sentTo()).toEqual(["glenn.terry@altronic-llc.com"]);
    expect(sentHtml()).toContain("No engineer is assigned");
  });

  // The actor is both the only engineer AND the only assigner: strict exclusion
  // empties the engineer pool, then the fallback keeps him rather than mailing
  // nobody — and the wording is the "couldn't be asked" variant, not the false
  // "no engineer is assigned".
  it("keeps the actor rather than mailing nobody, with honest wording", async () => {
    const glenn = { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" };
    email.fireEirResponseNotAcceptedAlert({ target: TARGET, actor: glenn, engineers: [glenn] });
    await settle();
    expect(sentTo()).toEqual(["glenn.terry@altronic-llc.com"]);
    expect(sentHtml()).toContain("couldn't be asked");
  });
});
