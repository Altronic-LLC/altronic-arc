import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPlantLayoutsMockStore, getPlantLayout, listPlantLayouts } from "@/api/plantLayouts";
import { __resetPlantMapRolesMockStore } from "@/api/plantMapRoles";
import { __resetPlantLayoutFilesForTests } from "@/api/plantLayoutFiles";

// =============================================================================
// The layout editor in demo mode — on the made-up Panel Plant draft (layout 3,
// empty) and the Main Plant draft (layout 2). The demo user is an editor.
// Dragging on the plan itself is covered in components/PlantCanvas.test.tsx;
// here: the palette, the keyboard, undo, Save draft, and who gets in.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

import { PlantLayoutEditView } from "./PlantLayoutEditView";
import { PlantLayoutView } from "./PlantLayoutView";

function openEditor(id: number) {
  return renderWithProviders(<PlantLayoutEditView />, {
    route: `/operations/plant-map/${id}/edit`,
    routePattern: "/operations/plant-map/:id/edit",
  });
}

const itemCount = () => document.querySelectorAll('[data-layer="items"] > g').length;

beforeEach(() => {
  who.email = "demo.user@altronic-llc.com";
  __resetPlantLayoutsMockStore();
  __resetPlantMapRolesMockStore();
  __resetPlantLayoutFilesForTests();
});

describe("PlantLayoutEditView", () => {
  it("offers every sample symbol in the palette", async () => {
    openEditor(3);
    const palette = await screen.findByRole("region", { name: "Symbols" });
    expect(within(palette).getAllByRole("button", { name: /^Add / })).toHaveLength(15);
    expect(within(palette).getByRole("button", { name: "Add CNC Vertical Mill (generic)" })).toBeInTheDocument();
  });

  it("adds a symbol from the palette, removes it with Delete, brings it back with Ctrl+Z, and saves the draft", async () => {
    const user = userEvent.setup();
    openEditor(3);
    const add = await screen.findByRole("button", { name: "Add Workbench 72x30" });
    expect(itemCount()).toBe(0);

    // A click (press and release in place) drops one in the middle of the view.
    fireEvent.pointerDown(add, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(itemCount()).toBe(1));
    const inspector = screen.getByRole("region", { name: "Selected item" });
    expect(within(inspector).getByDisplayValue("Workbench 72x30")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Delete" });
    expect(itemCount()).toBe(0);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(itemCount()).toBe(1);

    await user.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => expect(screen.getByText("All changes saved")).toBeInTheDocument());
    const saved = await getPlantLayout(3);
    expect(saved?.doc.items).toHaveLength(1);
    expect(saved?.doc.items[0]).toMatchObject({ label: "Workbench 72x30", w: 72, d: 30, rot: 0 });
  });

  it("puts a new extinguisher on the safety layer with the others, shows that layer, and saves it there", async () => {
    const user = userEvent.setup();
    openEditor(4);
    const layers = await screen.findByRole("region", { name: "Layers" });
    const safety = within(layers).getByRole("checkbox", { name: /^Safety/ });
    expect(safety).not.toBeChecked();
    const before = itemCount();

    const add = await screen.findByRole("button", { name: "Add Fire extinguisher" });
    fireEvent.keyDown(add, { key: "Enter" });
    // The new one AND the four already on the layer are now drawn.
    await waitFor(() => expect(itemCount()).toBe(before + 5));
    expect(safety).toBeChecked();
    const inspector = screen.getByRole("region", { name: "Selected item" });
    expect(within(inspector).getByRole("button", { name: /^Layer/ })).toHaveTextContent("Safety");
    expect(within(inspector).getByRole("button", { name: /^Group/ })).toHaveTextContent("Extinguishers");

    await user.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => expect(screen.getByText("All changes saved")).toBeInTheDocument());
    const saved = await getPlantLayout(4);
    expect(saved?.doc.items.filter((i) => i.group === "extinguishers")).toHaveLength(3);
    expect(saved?.doc.layers?.map((l) => l.key)).toEqual(["safety"]);
  });

  it("nudges, turns and duplicates the selected item from the keyboard", async () => {
    openEditor(3);
    const add = await screen.findByRole("button", { name: "Add Press (generic)" });
    fireEvent.keyDown(add, { key: "Enter" });
    await waitFor(() => expect(itemCount()).toBe(1));
    const inspector = screen.getByRole("region", { name: "Selected item" });
    const x = Number((within(inspector).getByRole("spinbutton", { name: /from west/i }) as HTMLInputElement).value);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(within(inspector).getByRole("spinbutton", { name: /from west/i })).toHaveValue(x + 6);
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    expect(within(inspector).getByRole("spinbutton", { name: /from west/i })).toHaveValue(x + 7);
    fireEvent.keyDown(window, { key: "r" });
    expect(within(inspector).getByRole("spinbutton", { name: /rotation/i })).toHaveValue(90);
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(itemCount()).toBe(2);
    expect(within(inspector).getByDisplayValue("Press (generic)")).toBeInTheDocument();
  });

  it("shows the live placement check — a press dropped in the Main Plant's aisle is flagged", async () => {
    openEditor(2);
    const check = await screen.findByRole("region", { name: "Placement check" });
    await waitFor(() => expect(within(check).getByText("Sits in N-S aisle sits in an aisle (N-S aisle north).")).toBeInTheDocument());
    expect(screen.getByText("4 problems")).toBeInTheDocument();
  });

  it("draws an aisle by dragging on the plan, then edits it in its own panel", async () => {
    const user = userEvent.setup();
    openEditor(3);
    const svg = await screen.findByRole("img", { name: /editing/ });
    await user.click(screen.getByRole("button", { name: "Draw an aisle (A)" }));
    expect(screen.getByText(/Drag on the plan to draw an aisle/)).toBeInTheDocument();

    const areaGroups = () => [...document.querySelectorAll('[data-layer="areas"] > g')];
    expect(areaGroups()).toHaveLength(5); // the Panel Plant's own aisles, docks and clearance
    fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 400, clientY: 160 });
    fireEvent.pointerUp(svg, { clientX: 400, clientY: 160 });

    expect(areaGroups()).toHaveLength(6);
    expect(areaGroups()[5].getAttribute("data-kind")).toBe("aisle");
    // One area per pick of the tool — back to selecting.
    expect(screen.getByRole("button", { name: "Select and move (V)" })).toHaveAttribute("aria-pressed", "true");
    const panel = screen.getByRole("region", { name: "Selected area" });
    expect(within(panel).getByDisplayValue("Aisle 3")).toBeInTheDocument();

    await user.click(within(panel).getByRole("radio", { name: "No-go area" }));
    expect(areaGroups()[5].getAttribute("data-kind")).toBe("no-go");
    const label = within(panel).getByDisplayValue("Aisle 3");
    await user.clear(label);
    await user.type(label, "Wash bay{Enter}");
    expect(within(panel).getByDisplayValue("Wash bay")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => expect(screen.getByText("All changes saved")).toBeInTheDocument());
    const saved = (await getPlantLayout(3))?.doc.areas ?? [];
    expect(saved).toHaveLength(6);
    expect(saved[5]).toMatchObject({ kind: "no-go", label: "Wash bay" });
  });

  it("flags an item standing in a drawn no-go area, by the area's name", async () => {
    openEditor(3);
    fireEvent.keyDown(await screen.findByRole("button", { name: "Add Workbench 72x30" }), { key: "Enter" });
    await waitFor(() => expect(itemCount()).toBe(1));
    // N picks the no-go tool; draw a box over the middle of the view, where the bench landed.
    fireEvent.keyDown(window, { key: "n" });
    const svg = screen.getByRole("img", { name: /editing/ });
    fireEvent.pointerDown(svg, { button: 0, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(svg, { clientX: 500, clientY: 350 });
    fireEvent.pointerUp(svg, { clientX: 500, clientY: 350 });
    const check = screen.getByRole("region", { name: "Placement check" });
    // Numbered after the Panel Plant's three no-go areas. The bench landed in its main aisle too.
    expect(within(check).getByText("Workbench 72x30 sits in a no-go area (No-go area 4).")).toBeInTheDocument();
    expect(within(check).getByText("Workbench 72x30 sits in an aisle (Main aisle).")).toBeInTheDocument();
  });

  it("ignores a stray click with an area tool — too small to be meant", async () => {
    openEditor(3);
    const svg = await screen.findByRole("img", { name: /editing/ });
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    expect(document.querySelectorAll('[data-layer="areas"] > g')).toHaveLength(5);
  });

  it("refuses a published layout, pointing at Edit", async () => {
    openEditor(1);
    expect(await screen.findByText(/This layout is Published, so it can't be changed here/)).toBeInTheDocument();
  });

  it("refuses a viewer — on the list, but not an editor", async () => {
    who.email = "sam.viewer@example.com";
    openEditor(3);
    expect(await screen.findByText(/Only a Plant Map editor can start or change a layout/)).toBeInTheDocument();
  });
});

describe("Edit from the layout page", () => {
  it("opens a draft straight in the editor", async () => {
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/3", routePattern: "/operations/plant-map/:id" });
    expect(await screen.findByRole("button", { name: "Edit layout" })).toBeInTheDocument();
  });

  it("sends a published layout to the draft that already exists, rather than making a second", async () => {
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/1", routePattern: "/operations/plant-map/:id" });
    expect(await screen.findByRole("button", { name: "Edit the draft (v2)" })).toBeInTheDocument();
    expect((await listPlantLayouts()).filter((l) => l.layoutKey === "main-plant")).toHaveLength(2);
  });

  it("is not offered to a viewer", async () => {
    who.email = "sam.viewer@example.com";
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/3", routePattern: "/operations/plant-map/:id" });
    await screen.findByRole("region", { name: "Placement check" });
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
  });
});
