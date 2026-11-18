import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetLayoutComponentsMockStore, listLayoutComponents } from "@/api/layoutComponents";
import { __resetPlantMapRolesMockStore } from "@/api/plantMapRoles";

// =============================================================================
// Drawing a symbol's collision outline on the Add / Replace symbol form (demo
// mode; the demo user is a Plant Map admin).
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

import { PlantSymbolsView } from "./PlantSymbolsView";

const open = () => renderWithProviders(<PlantSymbolsView />, { route: "/operations/plant-map/symbols" });
const SVG = '<svg viewBox="0 0 400 200"><rect x="10" y="10" width="380" height="180"/></svg>';

beforeEach(() => {
  __resetLayoutComponentsMockStore();
  __resetPlantMapRolesMockStore();
});

async function startAdding(user: ReturnType<typeof userEvent.setup>) {
  open();
  await user.click(await screen.findByRole("button", { name: /add symbol/i }));
  const dialog = screen.getByRole("dialog", { name: "Add a symbol" });
  await user.upload(within(dialog).getByLabelText("Symbol drawing"), new File([SVG], "bench.svg", { type: "image/svg+xml" }));
  await user.type(within(dialog).getByRole("spinbutton", { name: "Width (in) *" }), "120");
  await user.type(within(dialog).getByRole("spinbutton", { name: "Depth (in) *" }), "60");
  return dialog;
}

describe("the collision outline on the symbol form", () => {
  it("saves an outline typed as corners", async () => {
    const user = userEvent.setup();
    const dialog = await startAdding(user);
    await user.click(within(dialog).getByRole("radio", { name: "Only an outline I draw" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Outline corners" }), "0,0 120,0 120,30 60,30 60,60 0,60{Enter}");
    expect(within(dialog).getByTestId("outline-status")).toHaveTextContent("6 corners");
    await user.click(within(dialog).getByRole("button", { name: "Add symbol" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const added = (await listLayoutComponents()).find((c) => c.key === "bench-120x60")!;
    expect(added.collisionPolygon).toEqual([[0, 0], [120, 0], [120, 30], [60, 30], [60, 60], [0, 60]]);
  });

  it("adds a corner where the preview is clicked, snapped to the inch", async () => {
    const user = userEvent.setup();
    const dialog = await startAdding(user);
    await user.click(within(dialog).getByRole("radio", { name: "Only an outline I draw" }));
    const canvas = within(dialog).getByTestId("outline-canvas");
    // 120 x 60 in, plus 4.8 in of padding all round, drawn 259.2 x 139.2 px: 2 px an inch.
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 259.2, height: 139.2, right: 259.2, bottom: 139.2, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(canvas, { clientX: 9.6 + 2 * 30.4, clientY: 9.6 + 2 * 10.6 });
    expect(within(dialog).getByRole("textbox", { name: "Outline corners" })).toHaveValue("30,11");
    expect(within(dialog).getByTestId("outline-status")).toHaveTextContent(/three corners/);
  });

  it("won't save an unfinished outline", async () => {
    const user = userEvent.setup();
    const dialog = await startAdding(user);
    await user.click(within(dialog).getByRole("radio", { name: "Only an outline I draw" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Outline corners" }), "0,0 120,0{Enter}");
    await user.click(within(dialog).getByRole("button", { name: "Add symbol" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("The outline isn't finished");
    expect((await listLayoutComponents()).some((c) => c.key === "bench-120x60")).toBe(false);
  });

  it("clears the outline when the footprint changes", async () => {
    const user = userEvent.setup();
    const dialog = await startAdding(user);
    await user.click(within(dialog).getByRole("radio", { name: "Only an outline I draw" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Outline corners" }), "0,0 120,0 120,60{Enter}");
    await user.type(within(dialog).getByRole("spinbutton", { name: "Depth (in) *" }), "0");
    expect(within(dialog).getByText(/footprint changed, so the outline was cleared/)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Outline corners" })).toHaveValue("");
  });

  it("opens a replacement with the symbol's own outline, and saves a changed one as the next version", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Replace L-Desk 72x72" }));
    const dialog = screen.getByRole("dialog", { name: "Replace a symbol" });
    expect(within(dialog).getByRole("radio", { name: "Only an outline I draw" })).toBeChecked();
    const box = within(dialog).getByRole("textbox", { name: "Outline corners" });
    expect(box).toHaveValue("0,0 72,0 72,30 30,30 30,72 0,72");
    await user.clear(box);
    await user.type(box, "0,0 72,0 72,36 36,36 36,72 0,72{Enter}");
    await user.click(within(dialog).getByRole("button", { name: "Save as v2" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const v2 = (await listLayoutComponents()).find((c) => c.key === "desk-l-72x72" && c.version === 2)!;
    expect(v2.collisionPolygon).toEqual([[0, 0], [72, 0], [72, 36], [36, 36], [36, 72], [0, 72]]);
  });

  it("marks a new symbol as a label, so each item's name is written inside it", async () => {
    const user = userEvent.setup();
    const dialog = await startAdding(user);
    await user.click(within(dialog).getByRole("radio", { name: "A floor marking" }));
    await user.click(within(dialog).getByRole("checkbox", { name: /A label — each item's name is written inside it/ }));
    await user.click(within(dialog).getByRole("button", { name: "Add symbol" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const added = (await listLayoutComponents()).find((c) => c.key === "bench-120x60")!;
    expect(added).toMatchObject({ isLabel: true, textBox: null, collides: false, collisionPolygon: null });
  });
});
