import { beforeEach, describe, expect, it, vi } from "vitest";

// The CMMS role gates aren't what this file is about — they have their own
// tests (lib/maintenanceRoles.test.ts, and the .roles.test files beside the two
// maintenance hooks). Full rights here, controllable where a case needs to see
// a refusal, so nothing in this file depends on the roles list loading.
const maintenanceAccess = vi.hoisted(() => ({
  value: { isTech: true, isAdmin: true, enforced: true, isResolving: false },
}));

vi.mock("@/hooks/useMaintenanceRoles", () => ({
  useMyMaintenanceRoles: () => maintenanceAccess.value,
  useResolveMaintenanceAccess: () => async () => maintenanceAccess.value,
}));
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
    maintenanceAccess.value = { isTech: true, isAdmin: true, enforced: true, isResolving: false };
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

  // ==========================================================================
  // Adding a SCHEDULE from a day cell is maintenance-admin only.
  //
  // The day cell is the control here, so when they can't, the "+" is gone and
  // the cell isn't clickable — rather than opening a form whose Create button
  // is dead. A dashed PM chip still opens the log modal for everyone: that
  // modal explains the tech gate itself, and a chip that silently does nothing
  // is worse than one that tells you why.
  // ==========================================================================
  describe("the admin gate on adding a schedule", () => {
    it("offers a day '+' to a maintenance admin", async () => {
      await renderCalendar();
      expect(screen.getAllByRole("button", { name: /add a maintenance schedule/i }).length)
        .toBeGreaterThan(0);
    });

    it("removes every day '+' for a TECH", async () => {
      maintenanceAccess.value = {
        isTech: true,
        isAdmin: false,
        enforced: true,
        isResolving: false,
      };
      await renderCalendar();
      expect(screen.queryByRole("button", { name: /add a maintenance schedule/i })).toBeNull();
    });

    // The subtitle told everyone to click a day. A screen that says that and
    // then does nothing when you do is worse than one that doesn't mention it.
    it("stops promising 'click a day to add a schedule' when they can't", async () => {
      maintenanceAccess.value = {
        isTech: true,
        isAdmin: false,
        enforced: true,
        isResolving: false,
      };
      await renderCalendar();
      expect(screen.queryByText(/click a day to add a schedule/i)).toBeNull();
      expect(screen.getByText(/every PM the schedules say is due/i)).toBeInTheDocument();
    });

    // Raising a one-off work order is NOT gated — anyone signed in does that.
    it("still offers New work order to a tech", async () => {
      maintenanceAccess.value = {
        isTech: true,
        isAdmin: false,
        enforced: true,
        isResolving: false,
      };
      await renderCalendar();
      expect(screen.getByRole("button", { name: /new work order/i })).toBeEnabled();
    });

    // Lockout safety.
    it("keeps the '+' for everyone while gating is unenforced", async () => {
      maintenanceAccess.value = {
        isTech: false,
        isAdmin: false,
        enforced: false,
        isResolving: false,
      };
      await renderCalendar();
      expect(screen.getAllByRole("button", { name: /add a maintenance schedule/i }).length)
        .toBeGreaterThan(0);
    });
  });
});
