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

/**
 * STUB `EirRow`. This file is about the CAP — how many rows reach the DOM —
 * not about what a row looks like; `EirRow.test.tsx` covers that.
 *
 * The real row renders a button, several badges and chips, and calls
 * `useIsMentioned`, so 150 of them is seconds of work that has to happen
 * again on every filter change. That cost is why this file timed out under
 * full-suite load (1.8s in isolation, 15-30s in the suite) and FAILED THE
 * DEPLOY on 2026-09-16 — twice, since trimming the row count and the role
 * queries helped but did not make it reliable.
 *
 * The stub still renders the title, which is what every assertion here keys
 * on ("Board 0" present, "Board 150" absent), so the cap is tested exactly as
 * before — just without re-rendering the row internals 150 times over.
 */
vi.mock("@/components/EirRow", () => ({
  EirRow: ({ eir }: { eir: Eir }) => <div>{eir.title}</div>,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 122 }),
  useCurrentUserEmails: () => ["ray.white@altronic-llc.com"],
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

/**
 * Just over the 150-row cap — NOT a round 200.
 *
 * Every assertion here only needs "more rows than the cap", and the expensive
 * part of the file is mounting each uncapped `EirRow` (each computing its own
 * badges and derivations) once "show all" is pressed. 200 made this the
 * slowest file in the suite and it timed out on a loaded CI runner while
 * passing in isolation — the deploy-gating failure on 2026-09-16, which
 * reproduced at commits predating the change being deployed. 151 proves the
 * cap identically. If you raise `INITIAL_ROWS`, raise this to match it + 1.
 */
const OVER_CAP = 151;

/**
 * WHY THIS FILE AVOIDS `*ByRole` QUERIES.
 *
 * Profiled 2026-09-16, with 151 rows mounted:
 *
 *     render                     726ms
 *     findByRole(/show all/)   4,079ms   <-- 47%
 *     click                      275ms
 *     waitFor(getByText)         116ms
 *     queryByRole(/show all/)  3,411ms   <-- 39%
 *
 * A role query builds an accessibility tree across the WHOLE document, so it
 * scales with every row on screen; `getByText` is a flat text scan and is
 * ~30x cheaper here. Those two calls were 87% of the runtime, which is what
 * blew the 20s timeout under full-suite load (23-34s, against 4-10s in
 * isolation) and FAILED THE DEPLOY on 2026-09-16 — `npm test` gates it.
 *
 * The button carries distinctive text, so matching on text tests exactly the
 * same thing. **Don't "tidy" these back to getByRole** — on a capped-list
 * view the query cost is the test's whole cost.
 */

/**
 * `userEvent` with NO inter-event delay.
 *
 * The default `userEvent.click` awaits a realistic delay between the pointer
 * events it dispatches, and with 200 EirRows mounted each of those ticks drags
 * a re-render behind it. That is what made this file time out on a loaded CI
 * runner while passing in isolation — the deploy-gating failure on 2026-09-16,
 * which reproduced at commits predating the change being deployed. Removing
 * the delay tests the same behaviour (the click still dispatches every event,
 * in order); it just doesn't sit and wait between them.
 */
const user = userEvent.setup({ delay: null });

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
    render(OVER_CAP);
    await waitFor(
      () => expect(screen.getByText(/showing 150 — show all/i)).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(screen.getByText("Board 0")).toBeInTheDocument();
    expect(screen.queryByText("Board 150")).not.toBeInTheDocument();
  }, 15_000);

  // Putting 200 rows into jsdom and then querying them all is genuinely
  // slow — comfortably inside the 5s default alone, but not when the suite
  // runs this file alongside everything else. The generous timeout is about
  // machine load, not about the assertion being uncertain (same rationale as
  // TeradyneLogView's equivalent test).
  it("shows every EIR once 'show all' is clicked", async () => {
    render(OVER_CAP);
    await user.click(await screen.findByText(/show all/i));
    await waitFor(() => expect(screen.getByText("Board 150")).toBeInTheDocument(), {
      timeout: 20_000,
    });
    expect(screen.queryByText(/show all/i)).not.toBeInTheDocument();
  }, 30_000);

  it("drops the cap once a filter narrows the list below it", async () => {
    render(OVER_CAP);
    await user.type(screen.getByPlaceholderText(/search/i), "Board 150");
    await waitFor(
      () => expect(screen.getByText(/showing 1 of 151 eirs/i)).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(screen.queryByText(/show all/i)).not.toBeInTheDocument();
  }, 15_000);

  it("doesn't cap a list already under the threshold", async () => {
    render(50);
    await waitFor(() => expect(screen.getByText(/showing 50 of 50 eirs/i)).toBeInTheDocument());
    expect(screen.queryByText(/show all/i)).not.toBeInTheDocument();
  });
});
