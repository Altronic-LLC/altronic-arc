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
}));

vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => mocks.isAdmin }));
vi.mock("@/hooks/useTasks", () => ({
  useProjects: () => ({ data: mocks.projects, isLoading: mocks.isLoading }),
  useCreateProject: () => mocks.create,
  useUpdateProject: () => mocks.update,
}));

import { AdminProjectsView } from "./AdminProjectsView";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdmin = true;
  mocks.isLoading = false;
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
