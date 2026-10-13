import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { ProjectReference } from "@/types/task";

// =============================================================================
// The Engineering Project Log admin page had no way to search its list of
// projects — everything relied on the four grouped tables and a scrollbar.
// Search is the same shared, multi-keyword, all-fields behaviour every other
// list in ARC has (see itemSearch.ts / "How search works (all lists)").
// =============================================================================

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  projects: [] as ProjectReference[],
  isLoading: false,
  create: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
  update: { mutate: vi.fn(), isPending: false },
  usage: { data: [] as { label: string; count: number }[], isLoading: false, isError: false, error: null, refetch: vi.fn() },
  del: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
}));

vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => mocks.isAdmin }));
vi.mock("@/hooks/useTasks", () => ({
  useProjects: () => ({ data: mocks.projects, isLoading: mocks.isLoading }),
  useCreateProject: () => mocks.create,
  useUpdateProject: () => mocks.update,
}));

vi.mock("@/hooks/useDeleteProject", () => ({
  useProjectUsage: () => mocks.usage,
  useDeleteProject: () => mocks.del,
}));

import { AdminProjectsView } from "./AdminProjectsView";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdmin = true;
  mocks.isLoading = false;
  mocks.usage = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  mocks.del = { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false };
  mocks.projects = [
    { lookupId: 1, title: "0017-AMP-5000 Refresh" },
    { lookupId: 2, title: "0021-CleanBurn Telemetry" },
    { lookupId: 3, title: "2004-Legacy Ignition Harness" },
    { lookupId: 4, title: "0001-Engineering Apps" },
    { lookupId: 5, title: "5002-Insourcing Valve Line" },
  ];
});

function render() {
  return renderWithProviders(<AdminProjectsView />);
}

describe("AdminProjectsView — search", () => {
  it("shows every project until a search narrows them", () => {
    render();
    expect(screen.getByText("0017-AMP-5000 Refresh")).toBeInTheDocument();
    expect(screen.getByText("2004-Legacy Ignition Harness")).toBeInTheDocument();
    expect(screen.getByText(/existing projects \(5\)/i)).toBeInTheDocument();
  });

  it("narrows to matching projects across every table", async () => {
    render();
    await userEvent.type(screen.getByPlaceholderText(/search projects/i), "AMP");
    expect(await screen.findByText(/existing projects \(1 of 5\)/i)).toBeInTheDocument();
    expect(screen.getByText("0017-AMP-5000 Refresh")).toBeInTheDocument();
    expect(screen.queryByText("2004-Legacy Ignition Harness")).not.toBeInTheDocument();
  });

  it("matches on any word in any order", async () => {
    render();
    await userEvent.type(screen.getByPlaceholderText(/search projects/i), "5000 AMP");
    expect(await screen.findByText("0017-AMP-5000 Refresh")).toBeInTheDocument();
  });

  it("says plainly when nothing matches, instead of showing empty tables", async () => {
    render();
    await userEvent.type(screen.getByPlaceholderText(/search projects/i), "nonexistent project xyz");
    expect(await screen.findByText(/no projects match/i)).toBeInTheDocument();
    expect(screen.queryByText(/no projects in this series yet/i)).not.toBeInTheDocument();
  });

  it("clearing the search shows every project again", async () => {
    render();
    const input = screen.getByPlaceholderText(/search projects/i);
    await userEvent.type(input, "AMP");
    expect(await screen.findByText(/existing projects \(1 of 5\)/i)).toBeInTheDocument();
    await userEvent.clear(input);
    expect(await screen.findByText(/existing projects \(5\)/i)).toBeInTheDocument();
    expect(screen.getByText("2004-Legacy Ignition Harness")).toBeInTheDocument();
  });
});

// BusinessIT#41 — delete a duplicate project, refused while anything uses it.
describe("AdminProjectsView — delete", () => {
  it("deletes a project nothing points at, after confirming", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Delete 0017-AMP-5000 Refresh" }));
    expect(screen.getByText(/nothing points at this project/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /delete project$/i }));
    expect(mocks.del.mutateAsync).toHaveBeenCalledWith({ lookupId: 1, title: "0017-AMP-5000 Refresh" });
  });

  it("says where a project is used and won't delete it", async () => {
    mocks.usage.data = [
      { label: "tasks", count: 3 },
      { label: "EIR", count: 1 },
    ];
    render();
    await userEvent.click(screen.getByRole("button", { name: "Delete 0017-AMP-5000 Refresh" }));
    expect(screen.getByText(/still used by 3 tasks and 1 EIR/i)).toBeInTheDocument();
    const del = screen.getByRole("button", { name: /delete project$/i });
    expect(del).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(del);
    expect(mocks.del.mutateAsync).not.toHaveBeenCalled();
  });

  it("won't delete while the check is still running", async () => {
    mocks.usage = { ...mocks.usage, data: [], isLoading: true };
    render();
    await userEvent.click(screen.getByRole("button", { name: "Delete 0017-AMP-5000 Refresh" }));
    await userEvent.click(screen.getByRole("button", { name: /delete project$/i }));
    expect(mocks.del.mutateAsync).not.toHaveBeenCalled();
  });

  it("Cancel closes the dialog without deleting", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Delete 0017-AMP-5000 Refresh" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.del.mutateAsync).not.toHaveBeenCalled();
  });
});
