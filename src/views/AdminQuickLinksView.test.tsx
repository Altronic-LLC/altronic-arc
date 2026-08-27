import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const mocks = vi.hoisted(() => ({ isAdmin: true }));

vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => mocks.isAdmin,
  useAdminAccess: () => ({ isAdmin: mocks.isAdmin, isResolving: false }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

import { AdminQuickLinksView } from "./AdminQuickLinksView";

beforeEach(() => {
  mocks.isAdmin = true;
});

async function render() {
  renderWithProviders(<AdminQuickLinksView />);
  await waitFor(() => expect(screen.getByText("Engineering")).toBeInTheDocument());
}

describe("AdminQuickLinksView", () => {
  it("refuses a non-admin, without showing the table", async () => {
    mocks.isAdmin = false;
    renderWithProviders(<AdminQuickLinksView />);
    expect(await screen.findByText(/don't have admin access/i)).toBeInTheDocument();
    expect(screen.queryByText("Add link")).not.toBeInTheDocument();
  });

  it("groups links under every one of the seven departments, even ones with none yet", async () => {
    await render();
    for (const dept of [
      "Engineering",
      "Panels",
      "Operations",
      "Coils",
      "Quality Control",
      "Supply Chain",
      "Customer Service / Sales",
    ]) {
      expect(screen.getByText(dept)).toBeInTheDocument();
    }
    // Coils has no fixture links.
    const coils = screen.getByText("Coils").closest("section")!;
    expect(within(coils).getByText(/no links yet/i)).toBeInTheDocument();
  });

  it("adds a new link to the department whose Add button was pressed", async () => {
    await render();
    const engineering = screen.getByText("Engineering").closest("section")!;
    await userEvent.click(within(engineering).getByRole("button", { name: /add link/i }));

    const dialog = await screen.findByRole("heading", { name: /new link — engineering/i });
    const form = dialog.closest("div")!.parentElement as HTMLElement;
    await userEvent.type(within(form).getByLabelText(/button name/i), "Test Portal");
    await userEvent.type(within(form).getByLabelText(/web address/i), "https://portal.example.com");
    await userEvent.click(within(form).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(within(engineering).getByText("Test Portal")).toBeInTheDocument(),
    );
  });

  it("refuses to save a link with an invalid web address", async () => {
    await render();
    const engineering = screen.getByText("Engineering").closest("section")!;
    await userEvent.click(within(engineering).getByRole("button", { name: /add link/i }));

    const dialog = await screen.findByRole("heading", { name: /new link — engineering/i });
    const form = dialog.closest("div")!.parentElement as HTMLElement;
    await userEvent.type(within(form).getByLabelText(/button name/i), "Bad Link");
    await userEvent.type(within(form).getByLabelText(/web address/i), "not a url");
    await userEvent.click(within(form).getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/enter a full web address/i)).toBeInTheDocument();
    expect(screen.queryByText("Bad Link")).not.toBeInTheDocument();
  });

  it("moves a link down within its department via the arrow button", async () => {
    await render();
    const engineering = screen.getByText("Engineering").closest("section")!;
    const rows = within(engineering).getAllByRole("listitem");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const firstLabel = within(rows[0]).getByRole("button", { name: /^Edit/i })
      .getAttribute("aria-label");

    await userEvent.click(within(rows[0]).getByRole("button", { name: /move .* down/i }));

    await waitFor(() => {
      const reordered = within(screen.getByText("Engineering").closest("section")!).getAllByRole(
        "listitem",
      );
      expect(
        within(reordered[1]).getByRole("button", { name: /^Edit/i }).getAttribute("aria-label"),
      ).toBe(firstLabel);
    });
  });

  it("removes a link after confirming", async () => {
    await render();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const engineering = screen.getByText("Engineering").closest("section")!;
    const before = within(engineering).getAllByRole("listitem").length;

    await userEvent.click(within(engineering).getAllByRole("button", { name: /^Remove/i })[0]);

    await waitFor(() =>
      expect(
        within(screen.getByText("Engineering").closest("section")!).getAllByRole("listitem")
          .length,
      ).toBe(before - 1),
    );
  });
});
