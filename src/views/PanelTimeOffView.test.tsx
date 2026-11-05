import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { PanelTimeOff } from "@/types/task";

// The calendar wiring (the grid itself is components/MonthCalendar, also
// covered by WhereAmIView's tests). jsdom's window is desktop-wide, so the
// calendar is what renders; `?view=list` gives the list.

const d = (k: string) => new Date(`${k}T12:00:00Z`);
const state = vi.hoisted(() => ({
  entries: [] as PanelTimeOff[],
  access: { canOpen: true, canEdit: true, resolving: false, hint: "" },
}));

vi.mock("@/hooks/usePanelTimeOff", () => ({
  usePanelTimeOff: () => ({ data: state.entries, isLoading: false, error: null, refetch: vi.fn() }),
  useSavePanelTimeOff: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePanelTimeOff: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/usePanelRoles", () => ({
  usePanelTeamAccess: () => state.access,
  usePanelRoles: () => ({ data: [] }),
}));
vi.mock("@/hooks/useIsPhone", () => ({ useKanbanAvailable: () => true }));
vi.mock("@/api/panelTimeOff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/panelTimeOff")>()),
  PANEL_TIME_OFF_CONFIGURED: true,
}));

import { PanelTimeOffView } from "./PanelTimeOffView";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T15:00:00"));
  state.access = { canOpen: true, canEdit: true, resolving: false, hint: "" };
  state.entries = [
    {
      id: 1,
      person: { displayName: "Eric Gilkinson", email: "eric@example.com" },
      reason: "Vacation",
      startDate: d("2026-11-02"),
      endDate: d("2026-11-03"),
      hoursPerDay: null,
      companyHoliday: false,
    },
    {
      id: 2,
      person: { displayName: "Sarah Shaffer", email: "sarah@example.com" },
      reason: "Doctor's appointment",
      startDate: d("2026-11-05"),
      endDate: d("2026-11-05"),
      hoursPerDay: 4,
      companyHoliday: false,
    },
  ];
});
afterEach(() => vi.useRealTimers());

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

describe("PanelTimeOffView calendar", () => {
  it("shows each entry on every day of its range, and a part day with its hours", () => {
    renderWithProviders(<PanelTimeOffView />, { route: "/panels/time-off" });
    expect(screen.getByText("November 2026")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Eric Gilkinson" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Sarah Shaffer · 4h" })).toHaveAttribute(
      "title",
      "Sarah Shaffer — Doctor's appointment (4h off)",
    );
  });

  it("opens the day panel from the date, with each entry in full", async () => {
    renderWithProviders(<PanelTimeOffView />, { route: "/panels/time-off" });
    await user().click(screen.getByRole("button", { name: "Show Thursday, November 5" }));
    const panel = screen.getByRole("complementary", { name: "Entries for Thursday, November 5" });
    expect(within(panel).getByText("Doctor's appointment")).toBeInTheDocument();
    expect(within(panel).getByText(/4h off/)).toBeInTheDocument();
  });

  it("the + on a day opens a new entry starting that day", async () => {
    renderWithProviders(<PanelTimeOffView />, { route: "/panels/time-off" });
    await user().click(screen.getByRole("button", { name: "Add to Tuesday, November 10" }));
    const dialog = screen.getByRole("dialog", { name: "Add time off" });
    const first = within(dialog).getByRole("button", { name: /First day/ });
    expect(first).toHaveTextContent("Nov 10, 2026");
  });

  it("gives a Viewer no way to add", () => {
    state.access = { canOpen: true, canEdit: false, resolving: false, hint: "Viewers can look." };
    renderWithProviders(<PanelTimeOffView />, { route: "/panels/time-off" });
    expect(screen.queryByRole("button", { name: /Add to Tuesday/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add time off" })).toBeDisabled();
  });

  it("switches to the list", async () => {
    renderWithProviders(<PanelTimeOffView />, { route: "/panels/time-off" });
    await user().click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("November 2026")).not.toBeInTheDocument();
  });
});
