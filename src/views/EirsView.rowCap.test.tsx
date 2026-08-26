import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS } from "@/data/mockData";
import type { Eir } from "@/types/task";

// =============================================================================
// Searching EIRs was reported to "slow down the app and the computer" —
// hundreds of EirRows re-mounting on every filter/search change. Every other
// big list in ARC (ECNs, Teradyne Log, and now the task ListView) caps what's
// RENDERED with a "Show all" escape hatch while filtering/counting still run
// over everything; EirsView had no such cap. Mirrors ListView.test.tsx.
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@hoerbiger.com", lookupId: 122 }),
  useCurrentUserEmails: () => ["ray.white@hoerbiger.com"],
}));

import { EirsView } from "./EirsView";

const EIRS_KEY = ["eirs", "list"] as const;
const PROJECTS_KEY = ["projects"] as const;

function bigEirList(n: number): Eir[] {
  const base = MOCK_EIRS[0];
  return Array.from({ length: n }, (_, i) => ({
    ...base,
    id: 10_000 - i,
    eirNo: `EIR_2026-${String(9000 - i)}`,
    title: `Board ${i}`,
    riskPart: null,
    riskPartLevel: null,
    ltbDate: null,
    createdAt: new Date(Date.UTC(2026, 0, 1) - i * 86_400_000),
  }));
}

function render(n: number) {
  return renderWithProviders(<EirsView />, {
    route: "/eirs",
    seedQueryData: [
      { key: EIRS_KEY, data: bigEirList(n) },
      { key: PROJECTS_KEY, data: [] },
    ],
  });
}

describe("EirsView — rendered-row cap", () => {
  it("renders only the first 150 rows, and says that's what it's doing", async () => {
    render(200);
    await waitFor(
      () => expect(screen.getByText(/showing 150 — show all/i)).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(screen.getByText("Board 0")).toBeInTheDocument();
    expect(screen.queryByText("Board 199")).not.toBeInTheDocument();
  }, 15_000);

  // Putting 200 rows into jsdom and then querying them all is genuinely
  // slow — comfortably inside the 5s default alone, but not when the suite
  // runs this file alongside everything else. The generous timeout is about
  // machine load, not about the assertion being uncertain (same rationale as
  // TeradyneLogView's equivalent test).
  it("shows every EIR once 'show all' is clicked", async () => {
    render(200);
    await userEvent.click(await screen.findByRole("button", { name: /show all/i }));
    await waitFor(() => expect(screen.getByText("Board 199")).toBeInTheDocument(), {
      timeout: 20_000,
    });
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  }, 30_000);

  it("drops the cap once a filter narrows the list below it", async () => {
    render(200);
    await userEvent.type(screen.getByPlaceholderText(/search/i), "Board 199");
    await waitFor(
      () => expect(screen.getByText(/showing 1 of 200 eirs/i)).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  }, 15_000);

  it("doesn't cap a list already under the threshold", async () => {
    render(50);
    await waitFor(() => expect(screen.getByText(/showing 50 of 50 eirs/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  });
});
