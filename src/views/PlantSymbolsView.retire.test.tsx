import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetLayoutComponentsMockStore, listLayoutComponents } from "@/api/layoutComponents";
import { __resetPlantMapRolesMockStore } from "@/api/plantMapRoles";
import { __resetPlantLayoutsMockStore } from "@/api/plantLayouts";

// =============================================================================
// Retiring a symbol from Plant Map → Symbols (demo mode). The demo user is a
// Plant Map admin; Morgan is an editor.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

import { PlantSymbolsView } from "./PlantSymbolsView";

const MILL = "CNC Vertical Mill (generic)";
const open = () => renderWithProviders(<PlantSymbolsView />, { route: "/operations/plant-map/symbols" });

beforeEach(() => {
  who.email = "demo.user@altronic-llc.com";
  __resetLayoutComponentsMockStore();
  __resetPlantMapRolesMockStore();
  __resetPlantLayoutsMockStore();
});

describe("retiring a symbol", () => {
  it("asks first, naming the layouts that keep it, then takes it off the list until Show retired; Restore brings it back", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: `Retire ${MILL}` }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(`Retire ${MILL}?`);
    await waitFor(() => expect(dialog).toHaveTextContent(/It's on \d+ layouts? \(.*Main Plant.*\).*They keep it/));
    await user.click(within(dialog).getByRole("button", { name: "Retire" }));

    await waitFor(() => expect(screen.queryByText(MILL)).toBeNull());
    expect((await listLayoutComponents()).find((c) => c.title === MILL)?.active).toBe(false);

    await user.click(screen.getByRole("checkbox", { name: /show 1 retired/i }));
    expect(screen.getByText("Retired")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `Restore ${MILL}` }));
    await waitFor(async () => expect((await listLayoutComponents()).find((c) => c.title === MILL)?.active).toBe(true));
  });

  it("changes nothing when Keep it is pressed", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: `Retire ${MILL}` }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Keep it" }));
    expect(screen.getByText(MILL)).toBeInTheDocument();
    expect((await listLayoutComponents()).every((c) => c.active)).toBe(true);
  });

  it("isn't offered to an editor", async () => {
    who.email = "morgan.example@example.com";
    open();
    await screen.findByRole("region", { name: "Machine" });
    expect(screen.queryByRole("button", { name: `Retire ${MILL}` })).toBeNull();
  });
});
