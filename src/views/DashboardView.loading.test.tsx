import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS } from "@/data/mockData";
import { cardLoad, DashboardView } from "./DashboardView";

// =============================================================================
// The Dashboard renders at once; each card follows its own list (Tim,
// 2026-10-13). It used to sit behind a full-page loading screen until six
// lists had arrived, while cards fed by the OTHER lists showed a confident 0.
//
// The task list's read is held open by a gate here, so a case can look at the
// card while its list is still on the way — first load, and a refetch over
// data already shown.
// =============================================================================

const gate = vi.hoisted(() => ({ hold: true }));
vi.mock("@/api/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/tasks")>();
  return {
    ...actual,
    listTasks: () => (gate.hold ? new Promise<never>(() => {}) : actual.listTasks()),
  };
});

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

const TASK_LIST_KEY = ["tasks", "list"] as const;

/** The Engineering Tasks card, whatever state it's in. */
function taskCard(): HTMLElement {
  const name = screen.getByText("Engineering Tasks");
  return name.closest("button, [aria-disabled='true']") as HTMLElement;
}

beforeEach(() => {
  gate.hold = true;
  mockNavigate.mockReset();
});

describe("DashboardView — loading, card by card", () => {
  it("shows the page and its cards straight away, not a full-page loading screen", () => {
    renderWithProviders(<DashboardView />);
    expect(screen.getByRole("heading", { name: /Dashboard/, level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Engineering Tasks")).toBeInTheDocument();
  });

  it("a card whose list is still loading says so, shows no number, and can't be opened", async () => {
    renderWithProviders(<DashboardView />);
    const card = taskCard();
    expect(card.tagName).toBe("DIV");
    expect(card).toHaveAttribute("aria-disabled", "true");
    expect(card).toHaveAttribute("aria-busy", "true");
    expect(within(card).getByText("Loading…")).toBeInTheDocument();
    expect(within(card).queryByText("active")).not.toBeInTheDocument();

    await userEvent.click(card);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("a card with no data to wait for is clickable while the lists load", async () => {
    renderWithProviders(<DashboardView />);
    await userEvent.click(screen.getByRole("button", { name: /Drawing File Logs/ }));
    expect(mockNavigate).toHaveBeenCalledWith("/drawing-logs");
  });

  it("turns into a normal card with its count once the list arrives", async () => {
    gate.hold = false;
    renderWithProviders(<DashboardView />);
    const card = await screen.findByRole("button", { name: /Engineering Tasks/ });
    expect(within(card).getByText("active")).toBeInTheDocument();
    expect(within(card).queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("a REFRESH keeps the last count on a clickable card, marked Updating", async () => {
    // Seeded data is fresh (useTasks' own staleTime), so invalidate it — what
    // the header's Refresh does — and the gate holds that refetch open.
    const { queryClient } = renderWithProviders(<DashboardView />, {
      seedQueryData: [{ key: TASK_LIST_KEY, data: MOCK_TASKS }],
    });
    expect(screen.getByRole("button", { name: /Engineering Tasks/ })).toBeInTheDocument();
    // A SYNC act that only starts the refetch: the gate never lets it settle,
    // so an awaited act would never return.
    act(() => {
      void queryClient.invalidateQueries({ queryKey: TASK_LIST_KEY });
    });
    await screen.findByText("Updating");
    const card = screen.getByRole("button", { name: /Engineering Tasks/ });
    expect(within(card).getByText("Updating")).toBeInTheDocument();
    expect(within(card).getByText("active")).toBeInTheDocument();
    expect(card).toHaveAttribute("aria-busy", "true");

    await userEvent.click(card);
    expect(mockNavigate).toHaveBeenCalled();
  });
});

describe("cardLoad", () => {
  it("is loading only before the first data, refreshing only after it", () => {
    expect(cardLoad({ isLoading: true, isFetching: true })).toEqual({ loading: true, refreshing: false });
    expect(cardLoad({ isLoading: false, isFetching: true })).toEqual({ loading: false, refreshing: true });
    expect(cardLoad({ isLoading: false, isFetching: false })).toEqual({ loading: false, refreshing: false });
  });
});
