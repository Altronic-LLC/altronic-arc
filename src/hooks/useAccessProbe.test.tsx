import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SITES } from "@/api/config";
import { APPS } from "@/api/appAccess";

const probeAppAccess = vi.fn();
vi.mock("@/api/accessProbe", () => ({ probeAppAccess: () => probeAppAccess() }));

import {
  clearAccessDenials,
  useAccessDenials,
  useAccessProbe,
  useAppUnavailable,
  useHiddenRowCount,
} from "./useListAccess";

const visitReports = APPS.find((a) => a.label === "Visit Reports")!;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  probeAppAccess.mockReset();
  probeAppAccess.mockResolvedValue({ deniedSites: [], deniedLists: [], deniedDrives: [], unreadableApps: [], hiddenRowCounts: {} });
});

afterEach(() => clearAccessDenials());

describe("useAccessProbe", () => {
  it("locks an app on FIRST LOAD, before anything has been opened", async () => {
    // The bug it exists for (Tim, 2026-09-24): every Sales card looked live
    // until he opened Visit Reports, was refused, and came back — at which
    // point one card locked and the rest still invited him in.
    probeAppAccess.mockResolvedValue({
      deniedSites: [],
      deniedLists: [{ listId: visitReports.lists[0], siteId: SITES.salesTeam }],
      deniedDrives: [],
      unreadableApps: [],
      hiddenRowCounts: {},
    });

    const { result } = renderHook(
      () => {
        useAccessProbe();
        return useAppUnavailable("/sales/visit-reports");
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("carries the site through, so the banner can name somewhere to ask", async () => {
    probeAppAccess.mockResolvedValue({
      deniedSites: [],
      deniedLists: [{ listId: visitReports.lists[0], siteId: SITES.salesTeam }],
      deniedDrives: [],
      unreadableApps: [],
      hiddenRowCounts: {},
    });

    const { result } = renderHook(
      () => {
        useAccessProbe();
        return useAccessDenials();
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current.implicatedSites.has(SITES.salesTeam)).toBe(true));
  });

  it("records a refused document library against its site only", async () => {
    probeAppAccess.mockResolvedValue({ deniedSites: [], deniedLists: [], deniedDrives: [SITES.salesTeam], unreadableApps: [], hiddenRowCounts: {} });

    const { result } = renderHook(
      () => {
        useAccessProbe();
        return useAccessDenials();
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current.drives.has(SITES.salesTeam)).toBe(true));
    expect(result.current.sites.size).toBe(0);
  });

  it("locks nothing when the probe comes back clean", async () => {
    const { result } = renderHook(
      () => {
        useAccessProbe();
        return useAccessDenials();
      },
      { wrapper },
    );

    await waitFor(() => expect(probeAppAccess).toHaveBeenCalled());
    expect(result.current.count).toBe(0);
  });

  it("runs ONCE per session, not per render", async () => {
    const { rerender } = renderHook(() => useAccessProbe(), { wrapper });
    await waitFor(() => expect(probeAppAccess).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    expect(probeAppAccess).toHaveBeenCalledTimes(1);
  });

  it("runs AGAIN after Check again", async () => {
    // Without this the query holds its first answer for the whole session and
    // the button does nothing for the one person it exists for — somebody who
    // has just been granted access.
    renderHook(() => useAccessProbe(), { wrapper });
    await waitFor(() => expect(probeAppAccess).toHaveBeenCalledTimes(1));

    act(() => clearAccessDenials());

    await waitFor(() => expect(probeAppAccess).toHaveBeenCalledTimes(2));
  });

  it("locks a SUBSITE's app when the parent site is refused", async () => {
    // OrderEntry sits under ALTRONICSALESTEAM (Tim, 2026-09-24): no access to
    // the parent means no access to the subsite, so Customers has to lock even
    // though nothing refused its own list.
    probeAppAccess.mockResolvedValue({
      deniedSites: [SITES.salesTeam],
      deniedLists: [],
      deniedDrives: [],
      unreadableApps: [],
      hiddenRowCounts: {},
    });

    const { result } = renderHook(
      () => {
        useAccessProbe();
        return {
          customers: useAppUnavailable("/sales/customers"),
          visits: useAppUnavailable("/sales/visit-reports"),
        };
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current.customers).toBe(true));
    expect(result.current.visits).toBe(true);
  });

  it("locks an app whose FOLDER couldn't be read", async () => {
    // Open Orders' files live in a folder that answered itemNotFound for Tim
    // while the library root read fine (2026-09-24). Nothing was refused, so
    // it locks as "unreadable" rather than as a denial.
    probeAppAccess.mockResolvedValue({
      deniedSites: [],
      deniedLists: [],
      deniedDrives: [],
      unreadableApps: ["/sales/open-orders"],
      hiddenRowCounts: {},
    });

    const { result } = renderHook(
      () => {
        useAccessProbe();
        return useAppUnavailable("/sales/open-orders");
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("locks a list whose rows are hidden, ON LOAD, with the count", async () => {
    // Tim, 2026-09-24: "I would rather it lock right away" — it used to take
    // opening the screen, because the check lived in the view.
    probeAppAccess.mockResolvedValue({
      deniedSites: [],
      deniedLists: [],
      deniedDrives: [],
      unreadableApps: ["/sales/customers"],
      hiddenRowCounts: { "/sales/customers": 102 },
    });

    const { result } = renderHook(
      () => {
        useAccessProbe();
        return {
          locked: useAppUnavailable("/sales/customers"),
          hidden: useHiddenRowCount("/sales/customers"),
        };
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current.locked).toBe(true));
    // The number travels with the lock, so the screen can show it without
    // asking SharePoint a second time.
    expect(result.current.hidden).toBe(102);
  });
});
