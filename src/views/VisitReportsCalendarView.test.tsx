import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { VisitReportsCalendarView } from "./VisitReportsCalendarView";
import { calendarDays } from "@/lib/calendarGrid";

const viewport = vi.hoisted(() => ({ calendarAvailable: true }));

vi.mock("@/hooks/useIsPhone", () => ({
  useKanbanAvailable: () => viewport.calendarAvailable,
  useIsPhone: () => !viewport.calendarAvailable,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

/** August 2026 — the month two of the mock reports fall in. */
async function renderCalendar(search = "?month=2026-08") {
  const result = renderWithProviders(<VisitReportsCalendarView />, {
    route: `/sales/visit-reports/calendar${search}`,
    routePattern: "/sales/visit-reports/calendar",
  });
  await waitFor(() => expect(screen.getByText("August 2026")).toBeInTheDocument());
  // The grid only renders once the reports have loaded — the weekday row is
  // the first thing that appears with them.
  await screen.findByText("Wed");
  return result;
}

beforeEach(() => {
  viewport.calendarAvailable = true;
});

describe("calendarDays", () => {
  it("covers whole weeks, Sunday through Saturday", () => {
    const days = calendarDays(new Date(Date.UTC(2026, 7, 1))); // August 2026
    expect(days.length % 7).toBe(0);
    expect(days[0].getUTCDay()).toBe(0);
    expect(days[days.length - 1].getUTCDay()).toBe(6);
  });

  it("includes every day of the month", () => {
    const days = calendarDays(new Date(Date.UTC(2026, 7, 1)));
    const august = days.filter((d) => d.getUTCMonth() === 7);
    expect(august).toHaveLength(31);
  });

  it("pads with the neighbouring months' days", () => {
    const days = calendarDays(new Date(Date.UTC(2026, 7, 1)));
    expect(days.some((d) => d.getUTCMonth() === 6)).toBe(true); // July
    expect(days.some((d) => d.getUTCMonth() === 8)).toBe(true); // September
  });

  it("handles a month that starts on a Sunday without a blank week", () => {
    // February 2026 starts on a Sunday.
    const days = calendarDays(new Date(Date.UTC(2026, 1, 1)));
    expect(days[0].getUTCDate()).toBe(1);
    expect(days[0].getUTCMonth()).toBe(1);
  });
});

describe("VisitReportsCalendarView", () => {
  it("shows each visit on its day", async () => {
    await renderCalendar();
    // CSI Compressco visited 2026-08-11, AGES on 2026-08-04.
    expect(screen.getByText("CSI Compressco")).toBeInTheDocument();
    expect(screen.getByText("AGES Energy Services")).toBeInTheDocument();
    // …and nothing from a month the grid doesn't reach. (July 29 IS on this
    // grid — a month view starts on the Sunday before the 1st, and a visit on
    // a padding day still belongs on the calendar.)
    expect(screen.queryByText("Gulf Coast Pipeline Partners")).not.toBeInTheDocument();
  });

  it("counts the month's visits", async () => {
    await renderCalendar();
    expect(screen.getByText("2 visits this month")).toBeInTheDocument();
  });

  it("moves between months", async () => {
    await renderCalendar();
    await userEvent.click(screen.getByRole("button", { name: /previous month/i }));

    await waitFor(() => expect(screen.getByText("July 2026")).toBeInTheDocument());
    // July's visits, and August's 11th is well outside July's grid.
    expect(screen.getByText("Bluestem Midstream")).toBeInTheDocument();
    expect(screen.queryByText("CSI Compressco")).not.toBeInTheDocument();
  });

  it("opens the new-report form on the day that was clicked", async () => {
    await renderCalendar();

    await userEvent.click(
      screen.getByRole("button", { name: /add a visit report on Wednesday, August 12/i }),
    );

    const dialog = await screen.findByRole("dialog", { name: /new visit report/i });
    // The form opens with that day already set, so it doesn't have to be picked.
    expect(within(dialog).getByText(/Aug(ust)? 12, 2026/)).toBeInTheDocument();
  });

  it("opens a visit when its chip is clicked", async () => {
    await renderCalendar();
    await userEvent.click(screen.getByRole("button", { name: /CSI Compressco/ }));
    // Navigating away unmounts the calendar.
    await waitFor(() => expect(screen.queryByText("August 2026")).not.toBeInTheDocument());
  });

  it("applies the filters it was opened with", async () => {
    await renderCalendar("?month=2026-08&rm=Wes+Wagner");
    expect(screen.getByText("AGES Energy Services")).toBeInTheDocument();
    expect(screen.queryByText("CSI Compressco")).not.toBeInTheDocument();
  });

  // A seven-column month grid is unusable at phone width, so the calendar is
  // desktop / large-tablet only — and a phone that reaches the URL (bookmark,
  // shared link) gets the list instead of something it can't read.
  it("sends a phone to the list instead", async () => {
    viewport.calendarAvailable = false;
    renderWithProviders(<VisitReportsCalendarView />, {
      route: "/sales/visit-reports/calendar?rm=Wes+Wagner",
      routePattern: "/sales/visit-reports/calendar",
    });
    await waitFor(() =>
      expect(screen.queryByText(/visits this month/)).not.toBeInTheDocument(),
    );
  });
});
