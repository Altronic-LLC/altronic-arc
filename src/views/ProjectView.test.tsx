import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS, MOCK_EIRS, MOCK_TEST_SHEETS, MOCK_PROJECTS } from "@/data/mockData";
import { ProjectView } from "./ProjectView";

const TASK_LIST_KEY = ["tasks", "list"] as const;
const PROJECTS_KEY = ["projects"] as const;
const EIRS_KEY = ["eirs", "list"] as const;
const TEST_SHEETS_KEY = ["testSheets", "list"] as const;

function renderProject(id: number) {
  return renderWithProviders(<ProjectView />, {
    route: `/project/${id}`,
    routePattern: "/project/:id",
    seedQueryData: [
      { key: TASK_LIST_KEY, data: MOCK_TASKS },
      { key: PROJECTS_KEY, data: MOCK_PROJECTS },
      { key: EIRS_KEY, data: MOCK_EIRS },
      { key: TEST_SHEETS_KEY, data: MOCK_TEST_SHEETS },
    ],
  });
}

describe("ProjectView", () => {
  it("shows tasks, EIRs, and test sheets linked to the project reference", () => {
    // Project 501 ("0017-AMP-5000 Refresh") has a linked task, two EIRs,
    // and two test sheets in the mock fixtures.
    const project = MOCK_PROJECTS.find((p) => p.title === "0017-AMP-5000 Refresh")!;
    renderProject(project.lookupId);

    expect(screen.getByRole("heading", { name: project.title })).toBeInTheDocument();
    expect(screen.getByText(/EIRs \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Test Sheets \(2\)/)).toBeInTheDocument();
  });

  it("shows an empty state when nothing is linked to the project", () => {
    const emptyProject = { lookupId: 999999, title: "Empty Project" };
    renderWithProviders(<ProjectView />, {
      route: `/project/${emptyProject.lookupId}`,
      routePattern: "/project/:id",
      seedQueryData: [
        { key: TASK_LIST_KEY, data: MOCK_TASKS },
        { key: PROJECTS_KEY, data: [...MOCK_PROJECTS, emptyProject] },
        { key: EIRS_KEY, data: MOCK_EIRS },
        { key: TEST_SHEETS_KEY, data: MOCK_TEST_SHEETS },
      ],
    });

    expect(screen.getByText("Nothing is linked to this project yet.")).toBeInTheDocument();
  });

  it("shows a not-found message for an unknown project id", () => {
    renderWithProviders(<ProjectView />, {
      route: "/project/424242",
      routePattern: "/project/:id",
      seedQueryData: [
        { key: TASK_LIST_KEY, data: MOCK_TASKS },
        { key: PROJECTS_KEY, data: MOCK_PROJECTS },
        { key: EIRS_KEY, data: MOCK_EIRS },
        { key: TEST_SHEETS_KEY, data: MOCK_TEST_SHEETS },
      ],
    });

    expect(screen.getByText("Project not found.")).toBeInTheDocument();
  });
});
