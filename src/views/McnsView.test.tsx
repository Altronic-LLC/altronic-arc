import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetMcnMockStore } from "@/api/mcns";
import { __resetMcnRoleMockStores } from "@/api/mcnRoles";

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Someone", email: who.email }),
  useCurrentUserEmails: () => [who.email],
}));

import { McnsView } from "./McnsView";

beforeEach(() => {
  __resetMcnMockStore();
  __resetMcnRoleMockStores();
  who.email = "demo.user@altronic-llc.com";
});

/** The desktop table — jsdom renders the phone cards too. */
async function table() {
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return screen.getByRole("table");
}

describe("the MCN register", () => {
  it("opens on OPEN MCNs — Draft, Submitted and Approved", async () => {
    renderWithProviders(<McnsView />, { route: "/operations/mcns" });
    const t = await table();
    expect(within(t).getByText("Label printer ink")).toBeInTheDocument(); // Draft
    expect(within(t).getByText("Machining coolant supplier change")).toBeInTheDocument(); // Submitted
    expect(within(t).queryByText("Wave solder flux change")).not.toBeInTheDocument(); // Implemented
    expect(within(t).queryByText("Lead-free paste evaluation")).not.toBeInTheDocument(); // Rejected
  });

  it("shows everything under All", async () => {
    renderWithProviders(<McnsView />, { route: "/operations/mcns?status=All" });
    const t = await table();
    expect(within(t).getByText("Wave solder flux change")).toBeInTheDocument();
    expect(within(t).getByText("Lead-free paste evaluation")).toBeInTheDocument();
  });

  it("shows an approver what's waiting for them, and filters to it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<McnsView />, { route: "/operations/mcns" });
    await table();
    await user.click(screen.getByRole("button", { name: "Waiting for your approval: 1" }));
    const t = screen.getByRole("table");
    expect(within(t).getAllByRole("row")).toHaveLength(2); // header + the one Submitted
  });

  it("offers New MCN to a team member only", async () => {
    renderWithProviders(<McnsView />, { route: "/operations/mcns" });
    await table();
    expect(screen.getByRole("button", { name: /New MCN/ })).toBeInTheDocument();
  });

  it("lets a reader read, with no New MCN and no approval queue", async () => {
    who.email = "reader@example.com";
    renderWithProviders(<McnsView />, { route: "/operations/mcns" });
    await table();
    expect(screen.queryByRole("button", { name: /New MCN/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting for your approval/)).not.toBeInTheDocument();
  });

  it("searches the scope and the references too", async () => {
    renderWithProviders(<McnsView />, { route: "/operations/mcns?status=All&q=MWI-0001" });
    const t = await table();
    expect(within(t).getAllByRole("row")).toHaveLength(2);
    expect(within(t).getByText("Robotic soldering replaces selective solder")).toBeInTheDocument();
  });
});
