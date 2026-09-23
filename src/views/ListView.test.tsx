import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { Task } from "@/types/task";

// =============================================================================
// Searching the task list was reported to "slow down the app and the
// computer" — hundreds of TaskRows (each computing its own checklist/
// child-task derivations) re-mounting on every keystroke-driven filter
// change. Every other big list in ARC (ECNs, Teradyne Log) caps what's
// RENDERED with a "Show all" escape hatch while filtering/counting still run
// over everything; ListView had no such cap. These tests pin the fix the same
// way TeradyneLogView's cap is pinned.
// =============================================================================

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

function bigTaskList(n: number): Task[] {
  return Array.from({ length: n }, (_, i) => ({
    id: 10_000 - i,
    numberedTitle: `T${i}-0001-Board ${i}`,
    title: `Board ${i}`,
    description: "",
    status: "BACKLOG",
    priority: null,
    category: null,
    labels: [],
    dueDate: null,
    createdAt: new Date(Date.UTC(2026, 0, 1) - i * 86_400_000),
    modifiedAt: new Date(Date.UTC(2026, 0, 1)),
    authorLookupId: 0,
    author: null,
    editorLookupId: 0,
    parentProject: null,
    relatedProjects: [],
    parentTask: null,
    childTasks: [],
    assigned: [],
    watchers: [],
    softwareRevision: "",
    eirReference: null,
    comments: [],
    hasAttachments: false,
  }));
}

async function renderBig(n = 200) {
  const { ListView } = await import("./ListView");
  const tasks = bigTaskList(n);
  const result = renderWithProviders(<ListView />, {
    // ?assigned= (present, empty) is the app's encoding for "Anyone" —
    // without it, ListView defaults the filter to the signed-in user and
    // these fixture tasks (assigned to nobody) would all be filtered out.
    route: "/list?assigned=",
    seedQueryData: [
      { key: ["tasks", "list"], data: tasks },
      { key: ["projects"], data: [] },
    ],
  });
  await waitFor(() => expect(screen.getByText(/tasks$/)).toBeInTheDocument(), {
    timeout: 10_000,
  });
  return { result, tasks };
}

/**
 * STUB `TaskRow`. This file is about the CAP — how many rows reach the DOM —
 * not about what a row looks like.
 *
 * The real row renders a button plus badges, chips and derived checklist and
 * child-task state, so 150 of them is seconds of work repeated on every
 * filter change. That cost is why the row-cap files timed out under
 * full-suite load and FAILED THE DEPLOY on 2026-09-16 (measured on the EIR
 * equivalent: 1.6s isolated, 15-30s in the suite).
 *
 * The stub renders `numberedTitle`, which is exactly what every assertion
 * here keys on, so the cap is tested as before. **`TaskRow`'s own rendering
 * now has no test of its own** — it was only ever covered incidentally by
 * this file, and a dedicated `TaskRow.test.tsx` is the right home for it if
 * someone wants that coverage back; asserting it 150 times through a cap test
 * was never the point.
 */
vi.mock("@/components/TaskRow", () => ({
  TaskRow: ({ task }: { task: Task }) => <div>{task.numberedTitle}</div>,
}));

describe("ListView — rendered-row cap", () => {
  /**
   * WHY THIS BLOCK AVOIDS `*ByRole` AND USES 151 ROWS, NOT 200.
   *
   * Profiled on the equivalent EIR file (2026-09-16), with 151 rows mounted:
   *
   *     render                     726ms
   *     findByRole(/show all/)   4,079ms   <-- 47%
   *     click                      275ms
   *     waitFor(getByText)         116ms
   *     queryByRole(/show all/)  3,411ms   <-- 39%
   *
   * A role query builds an accessibility tree across the WHOLE document, so it
   * scales with every row on screen; `getByText` is a flat text scan and is
   * ~30x cheaper. Those two calls were 87% of the runtime, which is what blew
   * the timeouts under full-suite load and FAILED THE DEPLOY on 2026-09-16
   * (`npm test` gates it). 151 is just over the 150 cap, which is all any
   * assertion here needs, and a quarter of the rows to mount once uncapped.
   *
   * The `userEvent` instance has no inter-event delay for the same reason: the
   * default waits between the events a click dispatches, and each of those
   * ticks drags a re-render of every mounted row behind it.
   *
   * **Don't "tidy" these back to getByRole or a round 200** — on a capped-list
   * view the query cost IS the test's cost. If you raise `INITIAL_ROWS`, raise
   * OVER_CAP to match it + 1.
   */
  const OVER_CAP = 151;
  const user = userEvent.setup({ delay: null });

  it("renders only the first 150 rows, and says that's what it's doing", async () => {
    await renderBig(OVER_CAP);
    await waitFor(
      () => expect(screen.getByText(/showing 150 — show all/i)).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(screen.getByText("T0-0001-Board 0")).toBeInTheDocument();
    expect(screen.queryByText("T150-0001-Board 150")).not.toBeInTheDocument();
  }, 15_000);

  // Putting 200 rows into jsdom and then querying them all is genuinely slow
  // — comfortably inside the 5s default alone, but not when the suite runs
  // this file alongside everything else (same rationale as TeradyneLogView's
  // equivalent test).
  it("shows every task once 'show all' is clicked", async () => {
    await renderBig(OVER_CAP);
    await user.click(await screen.findByText(/show all/i));
    await waitFor(() => expect(screen.getByText("T150-0001-Board 150")).toBeInTheDocument(), {
      timeout: 20_000,
    });
    expect(screen.queryByText(/show all/i)).not.toBeInTheDocument();
  }, 30_000);

  it("drops the cap once a filter narrows the list below it", async () => {
    await renderBig(OVER_CAP);
    await user.type(screen.getByPlaceholderText(/search/i), "Board 150");
    await waitFor(
      () => expect(screen.getByText(/showing 1 of 151 tasks/i)).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(screen.queryByText(/show all/i)).not.toBeInTheDocument();
  }, 15_000);

  it("doesn't cap a list already under the threshold", async () => {
    await renderBig(50);
    expect(screen.queryByText(/show all/i)).not.toBeInTheDocument();
  });
});
