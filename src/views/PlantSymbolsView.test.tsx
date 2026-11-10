import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetLayoutComponentsMockStore, listLayoutComponents } from "@/api/layoutComponents";
import { __resetPlantMapRolesMockStore } from "@/api/plantMapRoles";

// =============================================================================
// Plant Map → Symbols in demo mode: the library by category, and adding a
// symbol from an SVG or a DXF. The demo user is a Plant Map admin; Morgan is
// an editor. Tracing a picture needs a canvas, which jsdom hasn't got — the
// tracing itself is tested in lib/plantSymbolImport.test.ts.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

import { PlantSymbolsView } from "./PlantSymbolsView";

const open = () => renderWithProviders(<PlantSymbolsView />, { route: "/operations/plant-map/symbols" });

beforeEach(() => {
  who.email = "demo.user@altronic-llc.com";
  __resetLayoutComponentsMockStore();
  __resetPlantMapRolesMockStore();
});

const DXF = [
  [0, "SECTION"], [2, "HEADER"], [9, "$INSUNITS"], [70, 4], [0, "ENDSEC"],
  [0, "SECTION"], [2, "ENTITIES"],
  [0, "LWPOLYLINE"], [90, 4], [70, 1], [10, 0], [20, 0], [10, 2438.4], [20, 0], [10, 2438.4], [20, 1219.2], [10, 0], [20, 1219.2],
  [0, "ENDSEC"], [0, "EOF"],
]
  .map(([c, v]) => `${c}\n${v}`)
  .join("\n");

describe("PlantSymbolsView", () => {
  it("shows the library by category, each symbol with its size", async () => {
    open();
    const machines = await screen.findByRole("region", { name: "Machine" });
    expect(within(machines).getByText("CNC Vertical Mill (generic)")).toBeInTheDocument();
    expect(within(machines).getByText("10 ft × 8 ft")).toBeInTheDocument();
    expect(screen.getAllByRole("img").filter((i) => i.tagName === "IMG").length).toBeGreaterThanOrEqual(12);
    expect(within(screen.getByRole("region", { name: "Other" })).getByText("Floor marking")).toBeInTheDocument();
    // The demo's safety symbols never collide either.
    expect(within(screen.getByRole("region", { name: "Safety" })).getAllByText("Floor marking")).toHaveLength(3);
  });

  it("offers Add symbol to a Plant Map admin only", async () => {
    who.email = "morgan.example@example.com";
    open();
    await screen.findByRole("region", { name: "Machine" });
    expect(screen.queryByRole("button", { name: /add symbol/i })).toBeNull();
  });

  it("adds a symbol from an SVG — the footprint asked for, the library's metadata added", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /add symbol/i }));
    const dialog = screen.getByRole("dialog", { name: "Add a symbol" });
    await user.upload(
      within(dialog).getByLabelText("Symbol drawing"),
      new File(['<svg viewBox="0 0 400 200"><rect x="10" y="10" width="380" height="180"/></svg>'], "laser-cutter.svg", {
        type: "image/svg+xml",
      }),
    );
    // The name comes from the file; the size has to be typed — the drawing doesn't say.
    expect(within(dialog).getByPlaceholderText("e.g. CNC Router 5x10")).toHaveValue("laser cutter");
    expect(await within(dialog).findByText(/enter its real width and depth/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add symbol" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Enter the footprint");

    await user.type(within(dialog).getByRole("spinbutton", { name: "Width (in) *" }), "120");
    await user.type(within(dialog).getByRole("spinbutton", { name: "Depth (in) *" }), "60");
    expect(within(dialog).getByTestId("symbol-preview")).toHaveAttribute("src", expect.stringMatching(/^data:image\/svg\+xml/));
    expect(within(dialog).getByText(/laser-cutter-120x60/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add symbol" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const added = (await listLayoutComponents()).find((c) => c.key === "laser-cutter-120x60")!;
    expect(added).toMatchObject({ title: "laser cutter", category: "Machine", footprintW: 120, footprintD: 60, collides: true, version: 1, active: true });
    expect(added.svgMarkup).toMatch(/viewBox="0 0 120 60" data-component="laser-cutter-120x60" data-units="in"/);
    expect(await screen.findByText("laser cutter")).toBeInTheDocument();
  });

  it("reads a DXF's real size from its units, and refuses a DWG with what to do instead", async () => {
    // The file dialog lists only the accepted types, but "All files" lets anything through.
    const user = userEvent.setup({ applyAccept: false });
    open();
    await user.click(await screen.findByRole("button", { name: /add symbol/i }));
    const dialog = screen.getByRole("dialog", { name: "Add a symbol" });
    const input = within(dialog).getByLabelText("Symbol drawing");
    await user.upload(input, new File(["binary"], "router.dwg"));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/Save it from CAD as a DXF/);

    await user.upload(input, new File([DXF], "router-table.dxf"));
    // 2438.4 × 1219.2 mm = 96 × 48 in.
    expect(await within(dialog).findByRole("spinbutton", { name: "Width (in) *" })).toHaveValue(96);
    expect(within(dialog).getByRole("spinbutton", { name: "Depth (in) *" })).toHaveValue(48);
    expect(within(dialog).getByText(/router-table-96x48/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add symbol" }));
    await waitFor(async () => expect((await listLayoutComponents()).some((c) => c.key === "router-table-96x48")).toBe(true));
  });

  it("says when a picture can't be read here", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /add symbol/i }));
    const dialog = screen.getByRole("dialog", { name: "Add a symbol" });
    await user.upload(within(dialog).getByLabelText("Symbol drawing"), new File(["x"], "photo.png", { type: "image/png" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/couldn't read that picture/);
  });
});
