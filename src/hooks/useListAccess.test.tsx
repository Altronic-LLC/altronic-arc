import { afterEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  clearAccessDenials,
  markListDenied,
  markSiteDenied,
  recordAccessFailure,
  useAccessDenials,
  useAppUnavailable,
} from "./useListAccess";
import { APPS } from "@/api/appAccess";
import { SITES } from "@/api/config";

class FakeGraphError extends Error {
  constructor(
    public status: number,
    public body: string,
    public url: string,
  ) {
    super(`Graph ${status} at ${url}`);
    this.name = "GraphError";
  }
}

const teradyne = APPS.find((a) => a.label === "Teradyne Log")!;
const teradyneListId = teradyne.lists[0];
const itemsUrl = `https://graph.microsoft.com/v1.0/sites/${SITES.pmo}/lists/${teradyneListId}/items`;

afterEach(() => {
  // The store is module-level, so a denial left behind leaks into the next
  // test — the same discipline resetOpenDropdown() needs.
  clearAccessDenials();
});

describe("recordAccessFailure", () => {
  it("records the list a 403 names", () => {
    recordAccessFailure(new FakeGraphError(403, '{"error":{"code":"accessDenied"}}', itemsUrl));
    const { result } = renderHook(() => useAccessDenials());
    expect(result.current.lists.has(teradyneListId)).toBe(true);
    expect(result.current.count).toBe(1);
  });

  it("does NOT mark the whole site when a single list is refused", () => {
    // Somebody can hold access to twenty lists on a site and not the
    // twenty-first. Marking the site would disable every other app on it.
    recordAccessFailure(new FakeGraphError(403, "", itemsUrl));
    const { result } = renderHook(() => useAccessDenials());
    expect(result.current.sites.size).toBe(0);
    expect(result.current.implicatedSites.has(SITES.pmo)).toBe(true);
  });

  it("marks the site for a refused drive path", () => {
    recordAccessFailure(
      new FakeGraphError(403, "", `https://graph.microsoft.com/v1.0/sites/${SITES.engineering}/drive/root`),
    );
    const { result } = renderHook(() => useAccessDenials());
    expect(result.current.sites.has(SITES.engineering)).toBe(true);
  });

  it("ignores a throttle, a 500, a dead session and a plain bug", () => {
    const expired = new Error("Not signed in");
    expired.name = "SessionExpiredError";

    recordAccessFailure(new FakeGraphError(429, "", itemsUrl));
    recordAccessFailure(new FakeGraphError(500, "", itemsUrl));
    recordAccessFailure(new FakeGraphError(401, "unauthorized", itemsUrl));
    recordAccessFailure(expired);
    recordAccessFailure(new Error("Failed to fetch"));

    const { result } = renderHook(() => useAccessDenials());
    expect(result.current.count).toBe(0);
  });

  it("ignores a 403 that names no site", () => {
    recordAccessFailure(new FakeGraphError(403, "", "https://graph.microsoft.com/v1.0/me/sendMail"));
    const { result } = renderHook(() => useAccessDenials());
    expect(result.current.count).toBe(0);
  });

  it("is idempotent", () => {
    recordAccessFailure(new FakeGraphError(403, "", itemsUrl));
    recordAccessFailure(new FakeGraphError(403, "", itemsUrl));
    const { result } = renderHook(() => useAccessDenials());
    expect(result.current.count).toBe(1);
  });
});

describe("subscribers", () => {
  it("re-renders when a denial lands", () => {
    const { result } = renderHook(() => useAccessDenials());
    expect(result.current.count).toBe(0);
    act(() => markListDenied(teradyneListId, SITES.pmo));
    expect(result.current.count).toBe(1);
  });

  it("re-renders when the denials are cleared", () => {
    markSiteDenied(SITES.pmo);
    const { result } = renderHook(() => useAccessDenials());
    expect(result.current.count).toBe(1);
    act(() => clearAccessDenials());
    expect(result.current.count).toBe(0);
  });
});

describe("useAppUnavailable", () => {
  it("is false before anything is refused", () => {
    const { result } = renderHook(() => useAppUnavailable("/operations/teradyne"));
    expect(result.current).toBe(false);
  });

  it("turns true once that app's list is refused", () => {
    const { result } = renderHook(() => useAppUnavailable("/operations/teradyne"));
    act(() => markListDenied(teradyneListId, SITES.pmo));
    expect(result.current).toBe(true);
  });

  it("leaves other apps alone", () => {
    const { result } = renderHook(() => useAppUnavailable("/eirs"));
    act(() => markListDenied(teradyneListId, SITES.pmo));
    expect(result.current).toBe(false);
  });

  it("is false for no path", () => {
    const { result } = renderHook(() => useAppUnavailable(undefined));
    act(() => markSiteDenied(SITES.pmo));
    expect(result.current).toBe(false);
  });
});
