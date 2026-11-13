import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { filterSearch } from "@/hooks/useFilters";
import { RememberedViewRoute, rememberedView, rememberView } from "./useRememberedView";

// =============================================================================
// BusinessIT#51 — remember List or Kanban, like the theme (Thomas Terhune).
// The pick is saved in the switcher; arriving at a list any other way goes to
// the board if the board was the last pick.
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

const kanbanAvailable = vi.hoisted(() => ({ value: true }));
vi.mock("./useIsPhone", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useIsPhone")>()),
  useKanbanAvailable: () => kanbanAvailable.value,
}));

import { Header } from "@/components/Header";

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderTasks(route: string, withHeader = false) {
  return renderWithProviders(
    <>
      {withHeader && <Header />}
      <Routes>
        <Route
          path="/list"
          element={
            <RememberedViewRoute pair="tasks" boardPath="/kanban" carrySearch={filterSearch}>
              <Where />
            </RememberedViewRoute>
          }
        />
        <Route path="/kanban" element={<Where />} />
        <Route path="/" element={<Where />} />
      </Routes>
    </>,
    { route },
  );
}

beforeEach(() => {
  localStorage.clear();
  kanbanAvailable.value = true;
});
afterEach(() => vi.restoreAllMocks());

describe("rememberedView / rememberView", () => {
  it("is List until something else is picked", () => {
    expect(rememberedView("tasks")).toBe("list");
  });

  it("keeps each pair separately", () => {
    rememberView("tasks", "board");
    expect(rememberedView("tasks")).toBe("board");
    expect(rememberedView("eirs")).toBe("list");
  });

  it("reads List when storage can't be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(rememberedView("tasks")).toBe("list");
  });

  it("doesn't throw when storage can't be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => rememberView("tasks", "board")).not.toThrow();
  });
});

describe("RememberedViewRoute", () => {
  it("shows the list when the list was the last pick", () => {
    renderTasks("/list");
    expect(screen.getByTestId("where")).toHaveTextContent("/list");
  });

  it("goes to the board when the board was the last pick, filters and all", () => {
    rememberView("tasks", "board");
    renderTasks("/list?assigned=brandon.mirto%40altronic-llc.com&q=hub");
    const where = screen.getByTestId("where").textContent!;
    expect(where.startsWith("/kanban?")).toBe(true);
    expect(where).toContain("q=hub");
    expect(where).toContain("assigned=");
  });

  it("stays on the list on a screen too small for a board", () => {
    rememberView("tasks", "board");
    kanbanAvailable.value = false;
    renderTasks("/list");
    expect(screen.getByTestId("where")).toHaveTextContent("/list");
  });
});

describe("the switcher saves the pick", () => {
  it("pressing Kanban remembers the board; pressing List takes it back", async () => {
    const user = userEvent.setup();
    renderTasks("/list", true);

    await user.click(screen.getByRole("link", { name: "Kanban" }));
    expect(rememberedView("tasks")).toBe("board");
    expect(screen.getByTestId("where")).toHaveTextContent("/kanban");

    // Pressing List must land on the list, not bounce back to the board.
    await user.click(screen.getByRole("link", { name: "List" }));
    expect(rememberedView("tasks")).toBe("list");
    expect(screen.getByTestId("where")).toHaveTextContent("/list");
  });
});
