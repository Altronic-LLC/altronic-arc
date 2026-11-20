import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetQuoteMockStores } from "@/data/quoteMockData";

// The Departments menu offers Insourcing Quotes ONLY to someone holding a
// quote role (or who can manage the roles list). No role — no entry at all.

const who = vi.hoisted(() => ({ emails: ["demo.user@altronic-llc.com"] as string[] }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Someone", email: who.emails[0] ?? "", lookupId: 0 }),
  useCurrentUserEmails: () => who.emails,
}));

import { Header } from "./Header";

beforeEach(() => {
  __resetQuoteMockStores();
});

async function openMenu() {
  const user = userEvent.setup();
  renderWithProviders(<Header />, { route: "/" });
  await user.click(screen.getByRole("button", { name: /departments/i }));
  // Wait until the menu is populated (a Sales item is always there).
  await screen.findByRole("menuitem", { name: /Visit Reports/ });
}

describe("Header — Insourcing Quotes menu entry", () => {
  it("is offered to someone with a quote role", async () => {
    who.emails = ["katie.fleming@altronic-llc.com"];
    await openMenu();
    const item = await screen.findByRole("menuitem", { name: /Insourcing Quotes/ });
    expect(item).toHaveAttribute("href", "/sales/quotes");
  });

  it("is listed under Supply Chain, not Customer Service / Sales (Ray, 2026-10-09)", async () => {
    who.emails = ["katie.fleming@altronic-llc.com"];
    await openMenu();
    const item = await screen.findByRole("menuitem", { name: /Insourcing Quotes/ });
    // Each department group is one block whose first line is its name.
    const group = item.closest("div.border-b") as HTMLElement;
    expect(group).not.toBeNull();
    expect(group.textContent).toContain("Supply Chain");
    expect(group.textContent).toContain("SCNs");
    expect(group.textContent).not.toContain("Visit Reports");
  });

  it("is offered to an ARC admin, who can manage the roles list", async () => {
    who.emails = ["ray.white@altronic-llc.com"];
    await openMenu();
    expect(await screen.findByRole("menuitem", { name: /Insourcing Quotes/ })).toBeInTheDocument();
  });

  it("does not appear at all for somebody with no role", async () => {
    who.emails = ["someone.else@altronic-llc.com"];
    await openMenu();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Insourcing Quotes")).not.toBeInTheDocument();
  });
});
