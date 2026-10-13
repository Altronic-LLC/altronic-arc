import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Eir, Person, Task } from "@/types/task";
import { makeTask } from "@/test/taskFixtures";
import { renderWithProviders } from "@/test/render";
import { AgendaView } from "./AgendaView";

// =============================================================================
// /agenda — the page wiring. The rules (who, which dates, which window) are
// pinned in lib/agenda.test.ts; this file pins what the page does with them:
// grouping on screen, the window picker, the Watching toggle, remembering
// both, and — the one that matters most — never showing an empty agenda when
// a list FAILED to load.
//
// The task and EIR hooks are stubbed so each case controls its own rows and
// errors; useAgenda itself runs for real.
// =============================================================================

const ME: Person = { displayName: "Demo User", email: "demo.user@altronic-llc.com" };
const OTHER: Person = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };

const state: {
  tasks: Task[];
  eirs: Eir[];
  taskError: unknown;
  eirError: unknown;
} = { tasks: [], eirs: [], taskError: null, eirError: null };

vi.mock("@/hooks/useTasks", () => ({
  useTasks: () => ({
    data: state.taskError ? undefined : state.tasks,
    isLoading: false,
    error: state.taskError,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/useEirs", () => ({
  useEirs: () => ({
    data: state.eirError ? undefined : state.eirs,
    isLoading: false,
    error: state.eirError,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

/** Local noon, `n` days from today. */
function inDays(n: number): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
}

function makeEir(id: number, over: Partial<Eir> = {}): Eir {
  return {
    id,
    eirNo: `EIR_2026-${String(id).padStart(4, "0")}`,
    title: `Relay ${id}`,
    status: "Under Review",
    parentProjects: [],
    assignedEngineers: [],
    watchers: [],
    requestedCompletionDate: null,
    ...over,
  } as unknown as Eir;
}

beforeEach(() => {
  state.tasks = [];
  state.eirs = [];
  state.taskError = null;
  state.eirError = null;
  localStorage.clear();
});

describe("AgendaView", () => {
  it("shows Overdue first, then Today, with each item linking to its page", () => {
    state.tasks = [
      makeTask(1, { title: "Late board", assigned: [ME], dueDate: inDays(-3) }),
      makeTask(2, { title: "Due today", assigned: [ME], dueDate: inDays(0) }),
    ];
    state.eirs = [makeEir(7, { assignedEngineers: [ME], requestedCompletionDate: inDays(0) })];
    renderWithProviders(<AgendaView />, { route: "/agenda" });

    const sections = screen.getAllByRole("region");
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual(["Overdue", "Today"]);
    expect(within(sections[0]).getByText(/T1-0001-Late board/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /T2-0001-Due today/ })).toHaveAttribute(
      "href",
      "/task/2",
    );
    expect(screen.getByRole("link", { name: /EIR_2026-0007/ })).toHaveAttribute("href", "/eir/7");
  });

  it("says so when nothing is due, naming the window", () => {
    state.tasks = [makeTask(1, { assigned: [OTHER], dueDate: inDays(1) })];
    renderWithProviders(<AgendaView />, { route: "/agenda" });
    expect(screen.getByText(/Nothing overdue or due in the next 14 days/)).toBeInTheDocument();
  });

  it("widens the window from the picker and remembers it", async () => {
    state.tasks = [makeTask(1, { title: "Far off", assigned: [ME], dueDate: inDays(20) })];
    renderWithProviders(<AgendaView />, { route: "/agenda" });
    expect(screen.queryByText(/Far off/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next 30 days" }));
    expect(screen.getByText(/Far off/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next 30 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(JSON.parse(localStorage.getItem("arc-agenda-prefs") ?? "{}").days).toBe(30);
  });

  it("opens with the remembered window and toggle when the URL says nothing", () => {
    localStorage.setItem("arc-agenda-prefs", JSON.stringify({ days: 30, watching: true }));
    state.tasks = [makeTask(1, { title: "Watched far off", assigned: [OTHER], watchers: [ME], dueDate: inDays(20) })];
    renderWithProviders(<AgendaView />, { route: "/agenda" });
    expect(screen.getByText(/Watched far off/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /items I'm watching/ })).toBeChecked();
  });

  it("the URL wins over what's remembered", () => {
    localStorage.setItem("arc-agenda-prefs", JSON.stringify({ days: 90, watching: true }));
    renderWithProviders(<AgendaView />, { route: "/agenda?days=7&watching=0" });
    expect(screen.getByRole("button", { name: "Next 7 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("checkbox", { name: /items I'm watching/ })).not.toBeChecked();
  });

  it("adds watched items when the toggle is ticked, labelled as watching", async () => {
    state.tasks = [makeTask(1, { title: "Watched", assigned: [OTHER], watchers: [ME], dueDate: inDays(2) })];
    renderWithProviders(<AgendaView />, { route: "/agenda" });
    expect(screen.queryByText(/Watched/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: /items I'm watching/ }));
    const row = screen.getByRole("link", { name: /T1-0001-Watched/ });
    expect(within(row).getByText("Watching")).toBeInTheDocument();
  });

  it("a list that FAILED says so, and the other list's items still show", () => {
    state.taskError = new Error("Graph 500");
    state.eirs = [makeEir(7, { assignedEngineers: [ME], requestedCompletionDate: inDays(1) })];
    renderWithProviders(<AgendaView />, { route: "/agenda" });
    expect(screen.getByText("Couldn't load the Project Task List")).toBeInTheDocument();
    expect(screen.getByText(/EIR_2026-0007/)).toBeInTheDocument();
  });

  it("a refused list gets the access notice, not a generic failure", () => {
    state.eirError = Object.assign(new Error("Graph 403"), { status: 403 });
    renderWithProviders(<AgendaView />, { route: "/agenda" });
    expect(
      screen.getByText("You don't have access to this SharePoint list yet"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load the EIRs/)).not.toBeInTheDocument();
  });

  it("still renders when localStorage throws", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    try {
      renderWithProviders(<AgendaView />, { route: "/agenda" });
      expect(screen.getByRole("heading", { name: "My Agenda" })).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
