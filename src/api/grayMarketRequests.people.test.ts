import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Gray Market Requests' Requestor column, in REAL mode.
//
// Reported by Ray, 2026-09-02: "if the person filling it out does not enter
// their name as the requester, a random person is added to the requester
// field." The create form has no Requestor picker at all — it always sends
// `requestor: null` and relies on useCreateGrayMarketRequest to fill in the
// signed-in user (`input.requestor ?? actor`).
//
// This module's OWN write/read-back logic turned out not to be the actual
// bug (every case here resolves to the actual actor, or to nothing — never
// to a wrong person). The real cause was one level up, in the auth layer:
// AuthGate/AuthProvider were silently activating `accounts[0]` out of MSAL's
// localStorage-cached accounts with no check it belonged to whoever was
// actually at the keyboard — on a shared browser, that meant a SECOND
// person's earlier session got silently attached to someone else's, and
// `useCurrentUser()` (and therefore `actor` here) returned the wrong
// person's identity. See src/auth/AuthGate.tsx and its test file for the
// actual fix.
//
// These tests are kept anyway: they pin that THIS module's requestor
// handling is correct on its own terms, and they caught the specific
// hypothesis (a bare RequestorLookupId read-back showing as unset, not
// wrong) — a real but SEPARATE gap from what was reported then.
//
// **That gap was itself reported on 2026-09-16** (GMR_2026-207: "Requestor:
// Not set" with a requestor set in SharePoint) and is now FIXED — the read
// selects both halves of the column and the mapper accepts the bare id. The
// last case below asserts the fixed behaviour; it used to assert the bug.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());
const spFetch = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
}));

vi.mock("./sharepoint", () => ({
  spFetch,
  SharePointUnavailableError: class SharePointUnavailableError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    USE_MOCK: false,
    SP_GRAY_MARKET_LIST_ID: "gray-market-list",
    SP_PMO_SITE_URL: "https://example.sharepoint.com/sites/PMO",
  };
});

import { createGrayMarketRequest } from "./grayMarketRequests";
import type { GrayMarketRequestInput } from "@/types/task";

// `ensureSiteUserLookupId`'s own resolution cache is a module-level
// Map<(siteUrl,email), lookupId> with NO reset hook exported — a lookupId
// never changes for a real person on a real site, so that's correct in
// production, but it means every test case below needs its OWN email, or an
// earlier test's successful resolution silently answers a later test that's
// deliberately trying to simulate an unresolvable person. Caught by this
// file's own second test initially reusing ACTOR's email and seeing the
// FIRST test's cached lookupId instead of the rejection it was supposed to
// simulate — worth remembering for any future test in this area.
const ACTOR = { displayName: "Demo Requester", email: "demo.requester@altronic-llc.com" };

const BASE_INPUT: GrayMarketRequestInput = {
  title: "5900-FLX30",
  status: "Open",
  requestDate: new Date("2026-09-02T12:00:00Z"),
  testingRequired: "",
  requestor: null, // exactly what the real create form always sends
  values: {},
};

function patchedFields(): Record<string, unknown> {
  const call = graphFetch.mock.calls.find(
    ([path, init]) =>
      !String(path).includes("$expand") && (init as RequestInit | undefined)?.method === "POST",
  );
  if (!call) throw new Error("no create POST was sent");
  const body = JSON.parse(String((call[1] as RequestInit).body));
  return body.fields;
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  spFetch.mockReset();
  graphFetchAll.mockResolvedValue([]); // no existing requests, for the log number
});

describe("createGrayMarketRequest — the hook already resolves requestor to the actor", () => {
  it("writes the actor's lookupId to RequestorLookupId when ensureuser resolves them", async () => {
    spFetch.mockResolvedValue({ Id: 46 }); // ensureuser resolves ACTOR
    graphFetch.mockImplementation(async (_path: unknown, init?: RequestInit) => {
      if ((init as RequestInit | undefined)?.method === "POST") return { id: "12" };
      // The read-back after create.
      return {
        id: "12",
        fields: {
          Title: "5900-FLX30",
          Requestor: { LookupId: 46, LookupValue: ACTOR.displayName, Email: ACTOR.email },
        },
      };
    });

    const created = await createGrayMarketRequest(
      { ...BASE_INPUT, requestor: ACTOR },
      [],
    );

    expect(patchedFields().RequestorLookupId).toBe(46);
    expect(created.requestor?.email).toBe(ACTOR.email);
  });

  // The actual bug: when ensureuser can't resolve the actor at all (the
  // classic SharePoint scope isn't granted, or the login form is rejected —
  // both real, tenant-dependent failure modes documented in CLAUDE.md for
  // every other list that hit this), RequestorLookupId is never sent. The
  // NEXT step — reading the row back — is where a wrong person could show
  // up, if Graph's response for an UNSET single-person column doesn't come
  // back as cleanly empty as toGrayMarketRequest assumes.
  it("leaves Requestor unset (not a wrong person) when the actor can't be resolved", async () => {
    const unresolvable = { displayName: "Nobody Resolves", email: "unresolvable.actor@altronic-llc.com" };
    spFetch.mockRejectedValue(new Error("no SharePoint scope granted"));
    graphFetch.mockImplementation(async (_path: unknown, init?: RequestInit) => {
      if ((init as RequestInit | undefined)?.method === "POST") return { id: "12" };
      return {
        id: "12",
        fields: { Title: "5900-FLX30" }, // no Requestor key at all — genuinely unset
      };
    });

    const created = await createGrayMarketRequest(
      { ...BASE_INPUT, requestor: unresolvable },
      [],
    );

    expect(patchedFields().RequestorLookupId).toBeUndefined();
    expect(created.requestor).toBeNull();
  });

  // The single-person-column trap every other list in this app has hit:
  // Graph can hand back ONLY a bare RequestorLookupId, no expanded object,
  // even though Requestor is in the $select. toGrayMarketRequest's
  // parseSinglePerson only understands the EXPANDED shape — it has no
  // fallback to the bare id the way FAIT/Feature Requests/CMMS needed.
  it("RESOLVES a bare RequestorLookupId rather than reading it as unset", async () => {
    spFetch.mockResolvedValue({ Id: 46 });
    graphFetch.mockImplementation(async (_path: unknown, init?: RequestInit) => {
      if ((init as RequestInit | undefined)?.method === "POST") return { id: "12" };
      return {
        id: "12",
        fields: {
          Title: "5900-FLX30",
          // The bare-lookupId shape, no expanded Requestor object at all —
          // exactly what Graph hands back for a single-person column in
          // practice on other lists in this app.
          RequestorLookupId: 46,
        },
      };
    });

    const created = await createGrayMarketRequest(
      { ...BASE_INPUT, requestor: ACTOR },
      [],
    );

    // This case used to assert `toBeNull()` — the gap this file's header
    // called "real but SEPARATE... worth fixing on its own merits". It was
    // reported on 2026-09-16 (GMR_2026-207 showing "Requestor: Not set" with
    // a requestor set in SharePoint) and fixed: the read now selects both
    // halves of the column and `personOrLookup` accepts the bare id.
    //
    // No site directory is mocked in this file, so the name can't be filled
    // in — it falls back to `User #46`. That fallback IS the contract: a
    // person column that is set must never render as empty, or the next
    // person to open the request overwrites somebody's entry without knowing
    // it was there. `grayMarketRequests.requestor.test.ts` covers the
    // directory-backed path where the real name appears.
    expect(created.requestor).not.toBeNull();
    expect(created.requestor?.lookupId).toBe(46);
    expect(created.requestor?.displayName).toBe("User #46");
  });
});
