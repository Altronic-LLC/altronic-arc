import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS, MOCK_PROJECTS } from "@/data/mockData";
import { EIR_STATUSES } from "@/types/task";
import { EirKanbanView } from "./EirKanbanView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

// Toggled per-test: the board is only offered above phone width.
const viewport = vi.hoisted(() => ({ kanbanAvailable: true }));
vi.mock("@/hooks/useIsPhone", () => ({
  useIsPhone: () => !viewport.kanbanAvailable,
  useKanbanAvailable: () => viewport.kanbanAvailable,
}));

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="loc">{pathname + search}</div>;
}

function renderBoardAt(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/eirs/kanban" element={<EirKanbanView />} />
      <Route path="/eirs" element={<LocationProbe />} />
    </Routes>,
    {
      route,
      seedQueryData: [
        { key: ["eirs", "list"] as const, data: MOCK_EIRS },
        { key: ["projects"] as const, data: MOCK_PROJECTS },
      ],
    },
  );
}

const column = (status: string) => screen.getByTestId(`eir-column-${status}`);

beforeEach(() => {
  viewport.kanbanAvailable = true;
});

describe("EirKanbanView — columns", () => {
  it("renders a column per EIR status", () => {
    renderBoardAt("/eirs/kanban");

    for (const status of EIR_STATUSES) {
      expect(column(status)).toBeInTheDocument();
    }
  });

  it("puts every EIR in the column matching its status, and nowhere else", () => {
    renderBoardAt("/eirs/kanban");

    // Derived from the fixtures rather than hard-coded, so growing the demo
    // data can't quietly make this test assert less than it used to.
    for (const status of EIR_STATUSES) {
      const expected = MOCK_EIRS.filter((e) => e.status === status);
      const col = within(column(status));
      for (const e of expected) expect(col.getByText(e.eirNo)).toBeInTheDocument();
      for (const e of MOCK_EIRS.filter((x) => x.status !== status)) {
        expect(col.queryByText(e.eirNo)).not.toBeInTheDocument();
      }
    }
  });

  it("shows each column's count in its header", () => {
    renderBoardAt("/eirs/kanban");

    for (const status of EIR_STATUSES) {
      const expected = MOCK_EIRS.filter((e) => e.status === status).length;
      // Scope to the header's own count chip — a bare getByText would also
      // match a card's comment count further down the column.
      const label = within(column(status)).getByText(status);
      expect(label.nextElementSibling).toHaveTextContent(String(expected));
    }
  });

  it("narrows the board to the active view tab", () => {
    // The LTB view keeps only EIRs with a last-time-buy date set.
    renderBoardAt("/eirs/kanban?view=ltb");

    const withLtb = MOCK_EIRS.filter((e) => e.ltbDate != null);
    expect(withLtb.length).toBeGreaterThan(0);
    for (const e of withLtb) expect(screen.getByText(e.eirNo)).toBeInTheDocument();
    for (const e of MOCK_EIRS.filter((x) => x.ltbDate == null)) {
      expect(screen.queryByText(e.eirNo)).not.toBeInTheDocument();
    }
  });

  it("applies the filter bar from the URL", () => {
    const target = MOCK_EIRS[0];
    renderBoardAt(`/eirs/kanban?q=${encodeURIComponent(target.eirNo)}`);

    expect(screen.getByText(target.eirNo)).toBeInTheDocument();
    for (const e of MOCK_EIRS.filter((x) => x.eirNo !== target.eirNo)) {
      expect(screen.queryByText(e.eirNo)).not.toBeInTheDocument();
    }
  });

  it("invites a drop on a column the current filter leaves empty", () => {
    const target = MOCK_EIRS[0];
    renderBoardAt(`/eirs/kanban?q=${encodeURIComponent(target.eirNo)}`);

    // Every status but the matched EIR's is now empty and says so.
    const emptyColumns = EIR_STATUSES.filter((s) => s !== target.status);
    for (const status of emptyColumns) {
      expect(within(column(status)).getByText("Drop EIRs here")).toBeInTheDocument();
    }
  });
});

describe("EirKanbanView — phone fallback to the list", () => {
  beforeEach(() => {
    viewport.kanbanAvailable = false;
  });

  it("carries the filters through the redirect", () => {
    renderBoardAt("/eirs/kanban?q=relay&project=10&engineer=sarah@a.com&view=at-risk");

    const loc = screen.getByTestId("loc").textContent!;
    expect(loc.startsWith("/eirs?")).toBe(true);
    const params = new URLSearchParams(loc.slice(loc.indexOf("?")));
    expect(params.get("q")).toBe("relay");
    expect(params.get("project")).toBe("10");
    expect(params.get("engineer")).toBe("sarah@a.com");
    expect(params.get("view")).toBe("at-risk");
  });

  it("redirects to a bare /eirs when no filters are set", () => {
    renderBoardAt("/eirs/kanban");

    expect(screen.getByTestId("loc")).toHaveTextContent("/eirs");
  });
});

describe("EirKanbanView — view tabs", () => {
  it("counts each bucket from the bar-filtered set", () => {
    renderBoardAt("/eirs/kanban");

    const allTab = screen.getByRole("button", { name: /^All/ });
    expect(within(allTab).getByText(String(MOCK_EIRS.length))).toBeInTheDocument();
  });
});
