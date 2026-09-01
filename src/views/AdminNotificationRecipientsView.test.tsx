import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { Person } from "@/types/task";

// =============================================================================
// Every configured recipient list belongs on this screen — that's the whole
// point of it (Ray, 2026-08-25: built after an address with no mailbox behind
// it failed silently). A new intake/alert list that isn't added here is
// exactly the same class of gap the screen exists to catch.
// =============================================================================

vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => ({ isAdmin: true, isResolving: false }),
}));

const DIRECTORY: Person[] = [
  { displayName: "Jerrod Waldron", email: "Jerrod.Waldron@altronic-llc.com" },
  { displayName: "Alexandra Russell", email: "Alexandra.Russell@altronic-llc.com" },
  { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com" },
];

vi.mock("@/hooks/useDirectory", () => ({
  useDirectoryPeople: () => DIRECTORY,
}));

import { AdminNotificationRecipientsView } from "./AdminNotificationRecipientsView";

describe("AdminNotificationRecipientsView", () => {
  it("lists the FAIT intake alert alongside the others", () => {
    renderWithProviders(<AdminNotificationRecipientsView />);
    expect(screen.getByText("FAIT — new FAIT")).toBeInTheDocument();
    expect(screen.getByText("VITE_FAIT_NEW_ALERTS")).toBeInTheDocument();
  });

  it("checks the FAIT intake addresses against the directory", () => {
    renderWithProviders(<AdminNotificationRecipientsView />);
    // Jerrod is on the intake list AND the SQE reviewer list — two rows, both
    // audited, which is why this is getAllByText rather than getByText.
    expect(screen.getAllByText("Jerrod.Waldron@altronic-llc.com").length).toBeGreaterThan(0);
  });

  // A new recipient-list const that isn't added to LISTS is invisible to the
  // one screen that checks its addresses — the FAIT alerts already shipped
  // missing that once.
  it("lists the FAIT SQE reviewers, separately from the intake list", () => {
    renderWithProviders(<AdminNotificationRecipientsView />);
    expect(screen.getByText("FAIT — SQE sign-off")).toBeInTheDocument();
    expect(screen.getByText("VITE_FAIT_SQE_REVIEWERS")).toBeInTheDocument();
  });

  it("still lists the pre-existing lists", () => {
    renderWithProviders(<AdminNotificationRecipientsView />);
    expect(screen.getByText("Gray Market — new request")).toBeInTheDocument();
    expect(screen.getByText("EIR — add a project reference")).toBeInTheDocument();
  });
});
