import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// Work Type and Priority on screen (demo mode): picked as pills on a new task,
// shown as chips on the list, and filterable from the URL ("none" = not set).

vi.mock("@/hooks/useDirectory", () => ({ useDirectoryPeople: () => [] }));

import { listPanelTasks, resetPanelTasksMockStore } from "@/api/panelTasks";
import { PanelTaskFormModal } from "@/components/PanelTaskFormModal";
import { PanelTasksView } from "./PanelTasksView";

beforeEach(() => resetPanelTasksMockStore());

describe("Panel Tasks: Work Type and Priority", () => {
  it("are picked as pills on a new task, and saved", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<PanelTaskFormModal onClose={onClose} />);
    await user.type(screen.getByRole("textbox", { name: /title/i }), "Rewire cabinet");
    await user.click(screen.getByRole("radio", { name: "Improvement / Internal" }));
    await user.click(screen.getByRole("radio", { name: "Medium" }));
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const saved = (await listPanelTasks()).find((t) => t.title === "Rewire cabinet");
    expect(saved).toMatchObject({ workType: "Improvement / Internal", priority: "Medium" });
  });

  it("filter the list from the URL, with none meaning not set", async () => {
    renderWithProviders(<PanelTasksView />, { route: "/panels/tasks?priority=none" });
    await screen.findByText(/Showing 2 of 6 panel tasks/);
    expect(screen.getByText("Quote panel rebuild for Kodiak retrofit")).toBeInTheDocument();
    expect(screen.queryByText("Draw up enclosure layout for Archrock skids")).not.toBeInTheDocument();
  });

  it("show as chips on the list", async () => {
    renderWithProviders(<PanelTasksView />, { route: "/panels/tasks?workType=Improvement%20%2F%20Internal" });
    await screen.findByText(/Showing 1 of 6 panel tasks/);
    expect(screen.getByTitle("Work type: Improvement / Internal")).toBeInTheDocument();
    expect(screen.getByTitle("Priority: Low")).toBeInTheDocument();
  });
});
