import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { listHarnessAlertRecipients, resetHarnessAlertRecipientMockStore } from "@/api/harnessAlertRecipients";
import { HarnessAlertRecipientsView } from "./HarnessAlertRecipientsView";

const adminAccess = vi.hoisted(() => ({ isAdmin: false, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));
// The real guard awaits the Admins list; make this file's user one when adminAccess says so.
vi.mock("@/hooks/useRequireArcAdmin", () => ({
  useRequireArcAdmin: () => async (action: string) => {
    if (!adminAccess.isAdmin) throw new Error(`Only ARC admins can ${action}.`);
  },
}));

beforeEach(() => {
  resetHarnessAlertRecipientMockStore();
  adminAccess.isAdmin = false;
});

describe("HarnessAlertRecipientsView", () => {
  it("shows who each alert goes to, read-only for somebody who isn't an ARC admin", async () => {
    renderWithProviders(<HarnessAlertRecipientsView />, { route: "/harness/alert-recipients" });
    const crimp = await screen.findByRole("region", { name: "Crimp out of spec" });
    expect(within(crimp).getByText("Demo Supervisor")).toBeInTheDocument();
    expect(within(crimp).getByText("Demo Quality")).toBeInTheDocument();
    expect(within(crimp).getByRole("button", { name: /Remove Demo Quality/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.getByText(/Only ARC admins can change who is notified/)).toBeInTheDocument();
  });

  it("lets an ARC admin remove somebody, from that alert only", async () => {
    adminAccess.isAdmin = true;
    renderWithProviders(<HarnessAlertRecipientsView />, { route: "/harness/alert-recipients" });
    const crimp = await screen.findByRole("region", { name: "Crimp out of spec" });
    await userEvent.click(within(crimp).getByRole("button", { name: /Remove Demo Supervisor/ }));
    await waitFor(async () => {
      const rows = await listHarnessAlertRecipients();
      expect(rows.filter((r) => r.alert === "Crimp out of spec").map((r) => r.name)).toEqual(["Demo Quality"]);
      // Still on the part number requests.
      expect(rows.filter((r) => r.alert === "Part number request").map((r) => r.name)).toEqual(["Demo Supervisor"]);
    });
  });
});
