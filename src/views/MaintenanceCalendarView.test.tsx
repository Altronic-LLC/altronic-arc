import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { resetScheduledMaintenanceMockStore } from "@/api/scheduledMaintenance";
import { resetMaintenanceMockStore } from "@/api/maintenanceTasks";
import MaintenanceCalendarView from "./MaintenanceCalendarView";

// =============================================================================
// The flagship screen. What these tests exist to protect is the ONE thing the
// calendar has to get across — that a solid chip is a record and a dashed one
// is a prediction — plus the phone rendering, which is a different component
// tree entirely.
// =============================================================================

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

let phone = false;
vi.mock("@/hooks/useIsPhone", () => ({
  useIsPhone: () => phone,
  useKanbanAvailable: () => !phone,
}));

const SLOW = { timeout: 8000 };

async function renderCalendar(search = "") {
  const result = renderWithProviders(<MaintenanceCalendarView />, {
    route: `/operations/maintenance/calendar${search}`,
    routePattern: "/operations/maintenance/calendar",
  });
  // The filter bar renders immediately; wait for the data-dependent body.
  // LoadingTasks' own footer line is the marker that it is still on screen.
  await waitFor(
    () => expect(screen.queryByText(/cold starts take a moment/i)).not.toBeInTheDocument(),
    SLOW,
  );
  return result;
}

/** Projected chips identify themselves in their tooltip. */
function projectedChips(): HTMLElement[] {
  return screen.queryAllByTitle(/nothing logged yet/i);
}

describe("MaintenanceCalendarView", () => {
  beforeEach(() => {
    phone = false;
    resetScheduledMaintenanceMockStore();
    resetMaintenanceMockStore();
  });

  it("explains the solid / dashed distinction in words, not just in styling", async () => {
    await renderCalendar();
    expect(screen.getByText(/work order — a real, logged job/i)).toBeInTheDocument();
    expect(
      screen.getByText(/projected from a PM schedule, nothing logged yet/i),
    ).toBeInTheDocument();
  });

  it("shows both real work orders and projected occurrences", async () => {
    await renderCalendar();
    expect(projectedChips().length).toBeGreaterThan(0);
    // Work-order chips are the ones that aren't projections.
    const chips = screen.getAllByRole("button").filter((b) => b.title);
    expect(chips.some((b) => !/nothing logged yet/i.test(b.title))).toBe(true);
  });

  it("names each chip's kind for a screen reader, not only in the outline", async () => {
    await renderCalendar();
    expect(screen.getAllByText(/^Scheduled —$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Work order —$/).length).toBeGreaterThan(0);
  });

  it("filters to one-off work with the Type pills, dropping every projection", async () => {
    await renderCalendar();
    expect(projectedChips().length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("radio", { name: "One-off" }));
    await waitFor(() => expect(projectedChips()).toHaveLength(0));
  });

  it("Scheduled keeps the projections", async () => {
    await renderCalendar();
    await userEvent.click(screen.getByRole("radio", { name: "Scheduled" }));
    await waitFor(() => expect(projectedChips().length).toBeGreaterThan(0));
  });

  it("carries the Type filter in the URL so a view is shareable", async () => {
    await renderCalendar("?type=one-off");
    expect(screen.getByRole("radio", { name: "One-off" })).toBeChecked();
    expect(projectedChips()).toHaveLength(0);
  });

  it("keeps overdue work on screen with its real due date", async () => {
    await renderCalendar();
    const strip = screen.getByRole("region", { name: /overdue maintenance/i });
    expect(within(strip).getByText(/outstanding/i)).toBeInTheDocument();
    expect(
      within(strip).getByText(/nothing rolls forward on its own/i),
    ).toBeInTheDocument();
  });

  it("the overdue strip survives paging to another month", async () => {
    await renderCalendar();
    expect(screen.getByRole("region", { name: /overdue maintenance/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /next month/i }));
    await userEvent.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.getByRole("region", { name: /overdue maintenance/i })).toBeInTheDocument();
  });

  it("clicking a projection offers to log it — there is nothing to open", async () => {
    await renderCalendar();
    await userEvent.click(projectedChips()[0]);
    const dialog = await screen.findByRole("dialog", { name: /log maintenance/i });
    expect(
      within(dialog).getByText(/nothing has been logged for this occurrence yet/i),
    ).toBeInTheDocument();
  });

  it("clicking an empty day starts a new schedule on that date", async () => {
    await renderCalendar();
    await userEvent.click(screen.getAllByLabelText(/add a maintenance schedule starting/i)[0]);
    expect(await screen.findByRole("dialog", { name: /new maintenance schedule/i })).toBeInTheDocument();
  });

  it("moves month with the arrows, and the month is in the URL", async () => {
    await renderCalendar("?month=2026-09");
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /next month/i }));
    expect(await screen.findByRole("heading", { name: "October 2026" })).toBeInTheDocument();
  });

  it("gives a phone an agenda, not a redirect and not a seven-column grid", async () => {
    phone = true;
    await renderCalendar();
    // No weekday header row.
    expect(screen.queryByText("Sun")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next month/i })).not.toBeInTheDocument();
    // Grouped by day, in the words people actually use.
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0);
    expect(screen.getByText(/everything outstanding and coming up/i)).toBeInTheDocument();
  });
});
