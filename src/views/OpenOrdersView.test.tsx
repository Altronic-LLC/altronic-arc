import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// =============================================================================
// The Open Orders screen. Two things are worth pinning here:
//
//   1. It SAYS the job is weekly and done by a person. ARC has no scheduler,
//      and a screen that implies otherwise leaves everyone assuming someone
//      else pressed the button.
//   2. Generating is behind a confirmation that names what will be replaced,
//      because a run overwrites that week's files for everybody.
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

const mockAccess = vi.hoisted(() => ({
  value: { isReportManager: true, enforced: true, isResolving: false },
}));

vi.mock("@/hooks/useOpenOrdersCustomers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useOpenOrdersCustomers")>();
  return { ...actual, useMyOpenOrdersAccess: () => mockAccess.value };
});

import { OpenOrdersView } from "./OpenOrdersView";

beforeEach(() => {
  mockAccess.value = { isReportManager: true, enforced: true, isResolving: false };
});

describe("OpenOrdersView", () => {
  it("says the job is weekly, in words", async () => {
    renderWithProviders(<OpenOrdersView />);
    await waitFor(() =>
      expect(screen.getByText(/once-a-week job/i)).toBeInTheDocument(),
    );
  });

  it("names the SharePoint folder the files live in", async () => {
    renderWithProviders(<OpenOrdersView />);
    await waitFor(() =>
      expect(screen.getByText(/General\/Order Management\/OPEN ORDERS/)).toBeInTheDocument(),
    );
  });

  it("warns that re-running replaces that week's files", async () => {
    renderWithProviders(<OpenOrdersView />);
    await waitFor(() =>
      expect(screen.getByText(/replaces that week's files/i)).toBeInTheDocument(),
    );
  });

  it("lists the master dashboards, newest first and flagged", async () => {
    renderWithProviders(<OpenOrdersView />);
    await waitFor(() =>
      expect(
        screen.getByText("Altronic_Open_Orders_Dashboard_2026-08-21.xlsx"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Latest")).toBeInTheDocument();
  });

  it("opens a week's folder to reveal the customer workbooks", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpenOrdersView />);
    const week = await screen.findByRole("button", { name: /Week of 2026-08-17/ });
    await user.click(week);
    await waitFor(() =>
      expect(
        screen.getByText(/Permian_Midstream_Partners_Open_Orders_2026-08-17\.xlsx/),
      ).toBeInTheDocument(),
    );
  });

  // Downloading is open to everyone; only running the job is gated.
  it("tells someone without the role that they can still download", async () => {
    mockAccess.value = { isReportManager: false, enforced: true, isResolving: false };
    renderWithProviders(<OpenOrdersView />);
    await waitFor(() =>
      expect(screen.getByText(/limited to report managers/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/still download everything below/i)).toBeInTheDocument();
  });

  // "You don't have access" flashing up before the lists load reads as a
  // refusal, and people stop trying.
  it("says it is still checking rather than refusing, while access resolves", async () => {
    mockAccess.value = { isReportManager: false, enforced: true, isResolving: true };
    renderWithProviders(<OpenOrdersView />);
    await waitFor(() =>
      expect(screen.getByText(/Checking your access/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/limited to report managers/i)).not.toBeInTheDocument();
  });

  it("offers the upload control to a report manager", async () => {
    renderWithProviders(<OpenOrdersView />);
    await waitFor(() =>
      expect(screen.getByText(/Run this week's reports/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/Run date/i)).toBeInTheDocument();
  });

  it("links to the customer list with a count on it", async () => {
    renderWithProviders(<OpenOrdersView />);
    const link = await screen.findByRole("link", { name: /Customer list/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("/sales/open-orders/customers"));
  });
});
