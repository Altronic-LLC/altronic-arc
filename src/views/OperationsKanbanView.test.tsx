import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { MOCK_OPERATIONS_TASKS } from "@/data/operationsMockData";
import { OperationsKanbanView } from "./OperationsKanbanView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

vi.mock("@/hooks/useIsPhone", () => ({
  useIsPhone: () => true,
  useKanbanAvailable: () => false,
}));

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="loc">{pathname + search}</div>;
}

function renderOpsKanbanAt(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/operations/tasks/kanban" element={<OperationsKanbanView />} />
      <Route path="/operations/tasks" element={<LocationProbe />} />
    </Routes>,
    {
      route,
      seedQueryData: [
        { key: ["operationsTasks", "list"] as const, data: MOCK_OPERATIONS_TASKS },
        { key: ["operationsProjects"] as const, data: [] },
      ],
    },
  );
}

describe("OperationsKanbanView — phone fallback to the List", () => {
  it("carries the filters through the redirect", () => {
    renderOpsKanbanAt("/operations/tasks/kanban?assigned=alice@x.com&project=7");

    const loc = screen.getByTestId("loc").textContent!;
    expect(loc.startsWith("/operations/tasks?")).toBe(true);
    const params = new URLSearchParams(loc.slice(loc.indexOf("?")));
    expect(params.get("assigned")).toBe("alice@x.com");
    expect(params.get("project")).toBe("7");
  });

  it("redirects to a bare list path when no filters are set", () => {
    renderOpsKanbanAt("/operations/tasks/kanban");

    expect(screen.getByTestId("loc")).toHaveTextContent("/operations/tasks");
  });
});
