import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// ARC Feature Requests' Watchers column, in REAL mode.
//
// Reported by Ray, 2026-09-02: "i still can not add watchers to feature
// requests manually." Invisible from mock mode (the existing
// featureRequests.test.ts passed throughout) because the mock branch of
// setFeatureRequestWatchers stores whatever Person objects it's handed,
// lookupId or no — exactly the gap that hid the identical bug class in
// FAIT/Panel Orders/CMMS person columns before.
//
// Root cause: `multiPersonField` SILENTLY DROPS any person with no
// `lookupId` — and a person picked from the tenant directory
// (`useDirectoryPeople`, real mode) never carries one; that's a per-site
// SharePoint concept, not a tenant/Entra one. `setFeatureRequestWatchers`
// wrote straight to `multiPersonField` with no resolution step, so picking
// anyone not already resolved onto some OTHER feature request (and
// therefore already present in the in-app people list with a real
// lookupId) silently wrote them out of the array — the PATCH "succeeded"
// with that person simply missing.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    // Force the REAL branch — the mock branch is what hid this.
    USE_MOCK: false,
    SP_FEATURE_REQUESTS_LIST_ID: "feature-requests-list",
    SP_SITE_ID: "engineering-site",
    SP_SITE_URL: "https://example.sharepoint.com/sites/Eng",
  };
});

import { setFeatureRequestWatchers } from "./featureRequests";

const ONE_ROW = {
  id: "12",
  fields: {
    Title: "Add dark mode",
    Watchers: [],
  },
};

/** The body of the one PATCH sent to the feature request item's /fields endpoint. */
function patchedFields(): Record<string, unknown> {
  const call = graphFetch.mock.calls.find(
    ([path, init]) =>
      String(path).includes("/fields") && (init as RequestInit | undefined)?.method === "PATCH",
  );
  if (!call) throw new Error("no PATCH to /fields was sent");
  return JSON.parse(String((call[1] as RequestInit).body));
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetchAll.mockReset();
  // Every getFeatureRequest re-read (after the PATCH) returns the same row —
  // its exact content doesn't matter for these tests, only the PATCH body.
  graphFetch.mockImplementation(async (path: unknown, init?: RequestInit) => {
    if ((init as RequestInit | undefined)?.method === "PATCH") return {};
    if (String(path).includes("User Information List")) {
      // resolveCurrentUserLookupId's $filter query — respond with a match
      // for Sarah, nobody for the brand-new person.
      if (String(path).includes("sarah.shaffer")) {
        return { value: [{ id: "46", fields: { EMail: "sarah.shaffer@altronic-llc.com" } }] };
      }
      return { value: [] };
    }
    return ONE_ROW;
  });
});

describe("setFeatureRequestWatchers — resolving a manually-picked person", () => {
  it("resolves a person with no lookupId (a fresh tenant-directory pick) before writing", async () => {
    await setFeatureRequestWatchers(12, [
      { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" }, // no lookupId
    ]);

    expect(patchedFields().WatchersLookupId).toEqual([46]);
  });

  it("does not re-resolve a person who already carries a lookupId", async () => {
    await setFeatureRequestWatchers(12, [
      { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 1 },
    ]);

    expect(patchedFields().WatchersLookupId).toEqual([1]);
    // No User Information List query needed — already resolved.
    expect(
      graphFetch.mock.calls.some(([path]) => String(path).includes("User Information List")),
    ).toBe(false);
  });

  it("drops a person who can't be resolved at all, rather than failing the whole write", async () => {
    // Watchers is multi-value: a partial match is still useful, unlike a
    // single-person column where a silent partial write reads as "cleared".
    await setFeatureRequestWatchers(12, [
      { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 1 },
      { displayName: "Brand New Starter", email: "brand.new@altronic-llc.com" },
    ]);

    expect(patchedFields().WatchersLookupId).toEqual([1]);
  });

  it("writes the two-key multi-person shape", () => {
    return setFeatureRequestWatchers(12, [
      { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 1 },
    ]).then(() => {
      expect(patchedFields()["WatchersLookupId@odata.type"]).toBe("Collection(Edm.Int32)");
    });
  });

  it("clears Watchers with an empty array rather than refusing", async () => {
    await setFeatureRequestWatchers(12, []);
    expect(patchedFields().WatchersLookupId).toEqual([]);
  });
});
