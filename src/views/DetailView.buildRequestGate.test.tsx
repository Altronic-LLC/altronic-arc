import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_BUILD_REQUESTS } from "@/data/buildRequestMockData";
import type { BuildRequest } from "@/types/task";
import { DetailView } from "./DetailView";

// BusinessIT#2 — a task can't be closed while a build request raised from it
// isn't Complete. canCompleteTask() in taskGraph.ts holds the rule (pinned in
// taskGraph.test.ts); this file pins the wiring on the task page: the button,
// the on-screen reason, the sidebar picker, and the loading window.
//
// Task 102 is used because its only child (110) is already Complete, so the
// child rule never interferes — whatever blocks it here is the build request.

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

const linked = vi.hoisted(() => ({ list: [] as BuildRequest[], loading: false }));

vi.mock("@/hooks/useBuildRequests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useBuildRequests")>();
  return {
    ...actual,
    useBuildRequestsForTask: () => ({ data: linked.list, isLoading: linked.loading }),
  };
});

function linkedBr(status: string): BuildRequest {
  return { ...MOCK_BUILD_REQUESTS[0], id: 77, brNo: "BR_2026-0077", status, taskReferenceLookupId: 102 };
}

async function renderTask(id = 102) {
  renderWithProviders(<DetailView />, { route: `/task/${id}`, routePattern: "/task/:id" });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
}

describe("DetailView — a task with an open linked build request can't be marked Complete", () => {
  beforeEach(() => {
    linked.list = [];
    linked.loading = false;
  });

  it("greys Mark Complete (aria-disabled) and says which build request is holding it", async () => {
    linked.list = [linkedBr("Ready for Production")];
    await renderTask();

    const button = screen.getByRole("button", { name: "Mark Complete" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(screen.getByTestId("task-complete-gate")).toHaveTextContent(
      "Build request BR_2026-0077 is still Ready for Production — it must be Complete first.",
    );
  });

  it("refuses the write when Mark Complete is clicked anyway", async () => {
    linked.list = [linkedBr("In-process")];
    await renderTask();

    await userEvent.click(screen.getByRole("button", { name: "Mark Complete" }));

    expect(await screen.findAllByText(/BR_2026-0077 is still In-process/)).not.toHaveLength(0);
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  it("refuses picking Complete from the sidebar Status dropdown", async () => {
    linked.list = [linkedBr("Blocked")];
    await renderTask();

    const statusSelect = screen
      .getAllByRole("combobox")
      // The task Status select is the one offering a status only tasks have.
      .find((el) =>
        Array.from((el as HTMLSelectElement).options ?? []).some((o) => o.value === "SELECTED FOR DEVELOPMENT"),
      ) as HTMLSelectElement;
    expect(statusSelect).toBeTruthy();
    const before = statusSelect.value;

    await userEvent.selectOptions(statusSelect, "Complete");

    expect(await screen.findAllByText(/BR_2026-0077 is still Blocked/)).not.toHaveLength(0);
    expect(statusSelect.value).toBe(before);
  });

  it("holds the button while the build requests are still loading", async () => {
    linked.loading = true;
    await renderTask();

    const button = screen.getByRole("button", { name: "Mark Complete" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", "Checking the linked build requests…");
  });

  it("allows Mark Complete once the linked build request is Complete", async () => {
    linked.list = [linkedBr("Complete")];
    await renderTask();

    const button = screen.getByRole("button", { name: "Mark Complete" });
    expect(button).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByTestId("task-complete-gate")).toBeNull();
  });
});
