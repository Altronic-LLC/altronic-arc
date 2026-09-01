import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

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
import { renderWithProviders } from "@/test/render";
import MaintenanceCalendarView from "./MaintenanceCalendarView";

// =============================================================================
// The calendar is where people land from the Dashboard's Maintenance card, and
// raising a one-off job ("the compressor is tripping") is the single most
// common thing anyone does in this module.
//
// It shipped with only a per-day "+" that opens the SCHEDULE form, so from the
// landing screen there was no way to raise a work order at all — reported
// during the first walkthrough as "I see no way to add a work order, only
// scheduled". This pins the button so it can't quietly go missing again.
// =============================================================================

describe("raising a work order from the calendar", () => {
  it("offers a New work order button", async () => {
    renderWithProviders(<MaintenanceCalendarView />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /new work order/i })).toBeInTheDocument(),
    );
  });

  it("opens the work order form, not the schedule form", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MaintenanceCalendarView />);

    const button = await screen.findByRole("button", { name: /new work order/i });
    await user.click(button);

    // The schedule form's heading is "New Maintenance Schedule"; the work order
    // form is a different dialog. Asserting the schedule form is ABSENT is the
    // half that catches the two being wired the wrong way round.
    await waitFor(() => {
      expect(screen.queryByText(/new maintenance schedule/i)).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("still offers the PM library link alongside it", async () => {
    renderWithProviders(<MaintenanceCalendarView />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /pm library/i })).toBeInTheDocument(),
    );
  });
});
