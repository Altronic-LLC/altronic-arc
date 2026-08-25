import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS, MOCK_PROJECTS } from "@/data/mockData";

// =============================================================================
// Opening the EIR list shows EVERY EIR.
//
// It was reported as "the EIR filter isn't working — users see only a limited
// number of EIRs" (Ray, 2026-08-25). The list itself was fine; the DASHBOARD's
// EIRs card was sending `engineer=<me>` whenever the dashboard was in Mine
// scope, which is its default, so following that link landed people on their
// own EIRs only.
//
// The card is fixed in DashboardView; this pins the other half — that the list
// applies nothing of its own. A person default creeping into `useEirFilters`
// later would look identical to the original report.
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    // Deliberately somebody who appears on SOME of the fixtures: a default-to-me
    // filter would then show a subset rather than nothing, which is exactly how
    // the original bug presented.
    displayName: "Ray White",
    email: "ray.white@hoerbiger.com",
    lookupId: 122,
  }),
  useCurrentUserEmails: () => ["ray.white@hoerbiger.com"],
}));

import { EirsView } from "./EirsView";

const EIRS_KEY = ["eirs", "list"] as const;
const PROJECTS_KEY = ["projects"] as const;

function render(route = "/eirs") {
  return renderWithProviders(<EirsView />, {
    route,
    seedQueryData: [
      { key: EIRS_KEY, data: MOCK_EIRS },
      { key: PROJECTS_KEY, data: MOCK_PROJECTS },
    ],
  });
}

/** The "Showing N of M EIRs" line the list prints above the rows. */
async function showing(): Promise<{ shown: number; total: number }> {
  const el = await screen.findByText(/Showing \d+ of \d+ EIRs/);
  const m = /Showing (\d+) of (\d+) EIRs/.exec(el.textContent ?? "");
  return { shown: Number(m?.[1]), total: Number(m?.[2]) };
}

describe("the EIR list on arrival", () => {
  it("shows every EIR when opened with no params", async () => {
    render("/eirs");
    const { shown, total } = await showing();
    expect(total).toBe(MOCK_EIRS.length);
    expect(shown).toBe(MOCK_EIRS.length);
  });

  // The fixtures carry a mix of statuses, including closed ones. "All" has to
  // mean all — an implicit open-only default would read as missing EIRs.
  it("includes closed EIRs, not just open ones", async () => {
    const closed = MOCK_EIRS.filter((e) => e.status === "Closed");
    expect(closed.length).toBeGreaterThan(0);
    render("/eirs");
    const { shown } = await showing();
    expect(shown).toBe(MOCK_EIRS.length);
  });

  it("doesn't quietly filter to the signed-in user's own EIRs", async () => {
    const mine = MOCK_EIRS.filter((e) =>
      e.assignedEngineers.some((p) => p.email === "ray.white@hoerbiger.com"),
    );
    // The fixture has to be able to tell the two apart for this to mean
    // anything.
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(MOCK_EIRS.length);

    render("/eirs");
    const { shown } = await showing();
    expect(shown).not.toBe(mine.length);
    expect(shown).toBe(MOCK_EIRS.length);
  });

  // An explicit filter in the URL still works — the fix removes a default, not
  // the feature.
  it("still honours an engineer filter that was actually asked for", async () => {
    const mine = MOCK_EIRS.filter((e) =>
      e.assignedEngineers.some((p) => p.email === "ray.white@hoerbiger.com"),
    );
    render("/eirs?engineer=ray.white%40hoerbiger.com");
    await waitFor(async () => {
      const { shown } = await showing();
      expect(shown).toBe(mine.length);
    });
  });
});
