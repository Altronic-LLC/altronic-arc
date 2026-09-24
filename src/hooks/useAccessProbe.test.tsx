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
  probeAppAccess.mockResolvedValue({ deniedLists: [], deniedDrives: [] });
});

afterEach(() => clearAccessDenials());

describe("useAccessProbe", () => {
  it("locks an app on FIRST LOAD, before anything has been opened", async () => {
    // The bug it exists for (Tim, 2026-09-24): every Sales card looked live
    // until he opened Visit Reports, was refused, and came back — at which
    // point one card locked and the rest still invited him in.
    probeAppAccess.mockResolvedValue({
      deniedLists: [{ listId: visitReports.lists[0], siteId: SITES.salesTeam }],
      deniedDrives: [],
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
      deniedLists: [{ listId: visitReports.lists[0], siteId: SITES.salesTeam }],
      deniedDrives: [],
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
    probeAppAccess.mockResolvedValue({ deniedLists: [], deniedDrives: [SITES.salesTeam] });

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
});
