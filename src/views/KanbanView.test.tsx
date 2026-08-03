import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS, MOCK_PROJECTS } from "@/data/mockData";
import { KanbanView } from "./KanbanView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

// Phone-sized: Kanban isn't offered, so the view redirects to the List.
vi.mock("@/hooks/useIsPhone", () => ({
  useIsPhone: () => true,
  useKanbanAvailable: () => false,
}));

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="loc">{pathname + search}</div>;
}

function renderKanbanAt(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/kanban" element={<KanbanView />} />
      <Route path="/list" element={<LocationProbe />} />
    </Routes>,
    {
      route,
      seedQueryData: [
        { key: ["tasks", "list"] as const, data: MOCK_TASKS },
        { key: ["projects"] as const, data: MOCK_PROJECTS },
      ],
    },
  );
}

describe("KanbanView — phone fallback to the List", () => {
  it("carries the filters through the redirect", () => {
    renderKanbanAt("/kanban?assigned=brandon.mirto@hoerbiger.com&q=firmware");

    const loc = screen.getByTestId("loc").textContent!;
    expect(loc.startsWith("/list?")).toBe(true);
    const params = new URLSearchParams(loc.slice(loc.indexOf("?")));
    expect(params.get("assigned")).toBe("brandon.mirto@hoerbiger.com");
    expect(params.get("q")).toBe("firmware");
  });

  it("redirects to a bare /list when no filters are set", () => {
    renderKanbanAt("/kanban");

    expect(screen.getByTestId("loc")).toHaveTextContent("/list");
  });
});
