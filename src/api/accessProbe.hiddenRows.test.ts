import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchListItemCount = vi.fn();
vi.mock("./listItemCount", () => ({
  fetchListItemCount: (siteUrl?: string, listId?: string) => fetchListItemCount(siteUrl, listId),
}));

import { resolveHiddenRows, type EmptyListCandidate } from "./accessProbe";

// =============================================================================
// "This list has 102 records and you can see none of them."
//
// Customers read fine and came back with zero rows, and SharePoint answers an
// item-level permission problem in exactly that way — a security-trimmed 200
// with an empty array, identical to an empty list (Tim, 2026-09-24). The
// list's own ItemCount is NOT trimmed, so it is the one thing that separates
// the two, and it runs at sign-in so the app is locked before anybody opens it.
// =============================================================================

const CANDIDATE: EmptyListCandidate = {
  appPath: "/sales/customers",
  listId: "customers",
  siteUrl: "https://example.sharepoint.com/sites/TEAM/OrderEntry",
};

beforeEach(() => fetchListItemCount.mockReset());

describe("resolveHiddenRows", () => {
  it("locks the app, with the count, when the rows are there", () => {
    fetchListItemCount.mockResolvedValue(102);
    return expect(resolveHiddenRows([CANDIDATE])).resolves.toEqual({
      "/sales/customers": 102,
    });
  });

  it("locks NOTHING when the list is genuinely empty", async () => {
    // The rule that makes this safe: an empty list reports 0, so the person
    // whose job is to add the first record is never shut out of the screen
    // that adds it.
    fetchListItemCount.mockResolvedValue(0);
    await expect(resolveHiddenRows([CANDIDATE])).resolves.toEqual({});
  });

  it("locks nothing when the count can't be read", async () => {
    // No SP REST grant, a dead side-channel session, a renamed site: that is
    // "no corroboration", never "no access".
    fetchListItemCount.mockResolvedValue(null);
    await expect(resolveHiddenRows([CANDIDATE])).resolves.toEqual({});
  });

  it("asks nothing when no list came back empty", async () => {
    await expect(resolveHiddenRows([])).resolves.toEqual({});
    expect(fetchListItemCount).not.toHaveBeenCalled();
  });

  it("asks the list's own site, not the default one", async () => {
    // A lookup against the wrong site answers 404 and would quietly never
    // lock anything — Customers lives on the OrderEntry subsite.
    fetchListItemCount.mockResolvedValue(5);
    await resolveHiddenRows([CANDIDATE]);
    expect(fetchListItemCount).toHaveBeenCalledWith(CANDIDATE.siteUrl, "customers");
  });
});
