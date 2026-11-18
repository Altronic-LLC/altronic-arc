import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { PullTestSpecsView } from "./PullTestSpecsView";

// The Specs screen: each row's Duplicate button opens the add form filled from
// that spec, and the Pulls column reads Start / In process / End.

const adminAccess = vi.hoisted(() => ({ isAdmin: true, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));

describe("PullTestSpecsView", () => {
  it("shows each spec's pulls at Start / In process / End", async () => {
    renderWithProviders(<PullTestSpecsView />);
    const row = (await screen.findByText("910330")).closest("tr")!;
    expect(within(row).getByText("5 / 3 / 5")).toBeInTheDocument();
  });

  it("Duplicate opens the add form filled from that spec", async () => {
    renderWithProviders(<PullTestSpecsView />);
    await userEvent.click(await screen.findByRole("button", { name: "Duplicate 910330 · 22 AWG · DEMO-DS-330" }));
    const dialog = screen.getByRole("dialog", { name: "Duplicate pull test spec" });
    expect(within(dialog).getByRole("textbox", { name: "Terminal part # *" })).toHaveValue("910330");
    expect(within(dialog).getByRole("textbox", { name: "Wire gauge (AWG) *" })).toHaveValue("22");
  });

  it("Duplicate is greyed for anyone who isn't an ARC admin", async () => {
    adminAccess.isAdmin = false;
    try {
      renderWithProviders(<PullTestSpecsView />);
      expect(await screen.findByRole("button", { name: "Duplicate 910330 · 22 AWG · DEMO-DS-330" })).toBeDisabled();
    } finally {
      adminAccess.isAdmin = true;
    }
  });
});
