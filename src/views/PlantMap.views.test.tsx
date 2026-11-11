import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import panelPlantWalls from "@/data/plantMock/walls-panel-plant.svg?raw";
import { __resetPlantLayoutsMockStore, listPlantLayouts } from "@/api/plantLayouts";
import { __resetPlantMapRolesMockStore } from "@/api/plantMapRoles";
import { __resetPlantLayoutFilesForTests, readWallsFile } from "@/api/plantLayoutFiles";

// =============================================================================
// The Plant Map screens in demo mode: the layouts list (sortable), one layout
// drawn with its placement check, and starting a new layout from a walls
// drawing. The demo user holds editor + admin on the mock roles list.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

import { PlantLayoutsView } from "./PlantLayoutsView";
import { PlantLayoutView } from "./PlantLayoutView";
import { PlantMapRolesView } from "./PlantMapRolesView";

beforeEach(() => {
  who.email = "demo.user@altronic-llc.com";
  __resetPlantLayoutsMockStore();
  __resetPlantMapRolesMockStore();
  __resetPlantLayoutFilesForTests();
});
afterEach(() => vi.restoreAllMocks());

describe("PlantLayoutsView", () => {
  it("lists every layout version, and sorts when a header is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantLayoutsView />, { route: "/operations/plant-map" });
    const table = await screen.findByRole("table");
    const firstColumn = () =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(firstColumn()).toEqual(["Engineering & Sales", "Main Plant", "Main Plant", "Panel Plant"]);
    expect(screen.getByText("4 layout versions · 1 published")).toBeInTheDocument();

    await user.click(within(table).getByRole("button", { name: /sort by layout/i }));
    expect(firstColumn()).toEqual(["Panel Plant", "Main Plant", "Main Plant", "Engineering & Sales"]);
  });

  it("has a tab per building, with All, and each tab shows only its own layouts", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantLayoutsView />, { route: "/operations/plant-map" });
    const tabs = await screen.findByRole("tablist", { name: "Buildings" });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "All buildings4",
      "Engineering & Sales1",
      "Main Plant2",
      "Panel Plant1",
    ]);
    await user.click(within(tabs).getByRole("tab", { name: /Main Plant/ }));
    expect(within(tabs).getByRole("tab", { name: /Main Plant/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("2 layout versions · 1 published")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3);
  });

  it("offers New layout to an editor only", async () => {
    renderWithProviders(<PlantLayoutsView />, { route: "/operations/plant-map" });
    expect(await screen.findByRole("button", { name: /new layout/i })).toBeInTheDocument();
  });

  it("starts a layout from a walls drawing, refusing a file that isn't one first", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantLayoutsView />, { route: "/operations/plant-map" });
    await user.click(await screen.findByRole("button", { name: /new layout/i }));
    const dialog = screen.getByRole("dialog", { name: "New plant layout" });
    const input = within(dialog).getByLabelText("Walls drawing");

    await user.upload(input, new File(['<svg viewBox="0 0 10 10" data-units="mm"/>'], "bad.svg", { type: "image/svg+xml" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/"mm".*inches/);

    await user.upload(input, new File([panelPlantWalls], "panel.svg", { type: "image/svg+xml" }));
    expect(await within(dialog).findByTestId("walls-summary")).toHaveTextContent("160 ft × 100 ft");
    // The drawing names its building, so the name is filled in.
    expect(within(dialog).getByPlaceholderText("e.g. Main Plant")).toHaveValue("Panel Plant");

    // The drawing names its building too, and Panel Plant already exists — no "new building" note.
    expect(within(dialog).getByRole("textbox", { name: "Building" })).toHaveValue("Panel Plant");
    expect(within(dialog).queryByTestId("new-building")).toBeNull();
    // Typing a new name says it starts a new building.
    await user.clear(within(dialog).getByRole("textbox", { name: "Building" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Building" }), "Warehouse 2");
    expect(within(dialog).getByTestId("new-building")).toHaveTextContent(/new building/i);

    // The size has to be confirmed first.
    await user.click(within(dialog).getByRole("button", { name: "Start layout" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/tick "The building is 160 ft × 100 ft"/);
    expect((await listPlantLayouts()).length).toBe(4);
    await user.click(within(dialog).getByRole("checkbox", { name: /The building is 160 ft × 100 ft/ }));
    await user.click(within(dialog).getByRole("button", { name: "Start layout" }));
    await waitFor(async () => expect((await listPlantLayouts()).length).toBe(5));
    const created = (await listPlantLayouts()).at(-1)!;
    expect(created).toMatchObject({
      building: "Warehouse 2",
      title: "Panel Plant",
      status: "Draft",
      version: 1,
      doc: { extent: { w: 1920, h: 1200 }, items: [], areas: [] },
    });
  });

  it("reviews an uploaded drawing: the ticked keep-outs leave the saved drawing and start as editable areas", async () => {
    const user = userEvent.setup();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600">
      <g id="walls"><rect id="w1" x="0" y="0" width="1200" height="8"/></g>
      <g id="keepout">
        <rect id="k-aisle" data-kind="aisle" x="100" y="300" width="1000" height="96"/>
        <rect id="k-dock" data-kind="dock" x="1000" y="100" width="144" height="144"/>
        <rect id="k-door" data-kind="door-swing" x="500" y="8" width="36" height="36"/>
      </g>
    </svg>`;
    renderWithProviders(<PlantLayoutsView />, { route: "/operations/plant-map" });
    await user.click(await screen.findByRole("button", { name: /new layout/i }));
    const dialog = screen.getByRole("dialog", { name: "New plant layout" });
    await user.upload(within(dialog).getByLabelText("Walls drawing"), new File([svg], "shop.svg", { type: "image/svg+xml" }));
    const review = await within(dialog).findByRole("region", { name: "Review the drawing" });
    expect(within(review).getByTestId("walls-summary")).toHaveTextContent("100 ft × 50 ft · 1 wall, 0 columns, 3 keep-out areas");
    // The preview highlights the wall and the keep-out staying behind, and shows the two made editable.
    expect(review.querySelectorAll('[data-found="wall"]')).toHaveLength(1);
    expect(review.querySelectorAll('[data-found="keepout"]')).toHaveLength(1);
    expect(review.querySelectorAll('[data-layer="areas"] > g')).toHaveLength(2);
    // Door swings stay by default; the aisle and the dock are offered as areas.
    expect(within(review).getByRole("checkbox", { name: "Make Door swing editable" })).not.toBeChecked();
    expect(within(review).getByRole("checkbox", { name: "Make Aisle editable" })).toBeChecked();
    // Rename the dock and keep it as a no-go area.
    const dockLabel = within(review).getByRole("textbox", { name: "Label for k-dock" });
    await user.clear(dockLabel);
    await user.type(dockLabel, "Shipping dock");
    expect(within(within(review).getByRole("group", { name: "Kind for k-dock" })).getByRole("button", { name: "No-go area" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.type(within(dialog).getByPlaceholderText("e.g. Main Plant"), "Shop");
    await user.type(within(dialog).getByRole("textbox", { name: "Building" }), "Shop");
    await user.click(within(review).getByRole("checkbox", { name: /The building is 100 ft × 50 ft/ }));
    await user.click(within(dialog).getByRole("button", { name: "Start layout" }));
    await waitFor(async () => expect((await listPlantLayouts()).length).toBe(5));
    const created = (await listPlantLayouts()).at(-1)!;
    expect(created.doc.areas.map((a) => [a.kind, a.label, a.x, a.y, a.w, a.d])).toEqual([
      ["aisle", "Aisle", 600, 348, 1000, 96],
      ["no-go", "Shipping dock", 1072, 172, 144, 144],
    ]);
    const saved = await readWallsFile(created.wallsFileId);
    expect(saved).not.toContain("k-aisle");
    expect(saved).not.toContain("k-dock");
    expect(saved).toContain("k-door");
  });

  it("warns about a drawing with no walls, or one that's suspiciously small", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantLayoutsView />, { route: "/operations/plant-map" });
    await user.click(await screen.findByRole("button", { name: /new layout/i }));
    const dialog = screen.getByRole("dialog", { name: "New plant layout" });
    await user.upload(
      within(dialog).getByLabelText("Walls drawing"),
      new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><g id="walls"><path d="M0 0"/></g></svg>'], "mm.svg", {
        type: "image/svg+xml",
      }),
    );
    const warnings = await within(dialog).findByRole("list", { name: "Drawing warnings" });
    expect(warnings).toHaveTextContent(/very small building \(8 ft 4 in × 5 ft\)/);
    expect(warnings).toHaveTextContent(/found no walls/);
    expect(warnings).toHaveTextContent(/1 shape .* isn't a plain rectangle/);
  });

  it("starts a layout in an EXISTING building on its drawing — no file needed — with its aisles and no-go areas", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantLayoutsView />, { route: "/operations/plant-map?building=Main+Plant" });
    await user.click(await screen.findByRole("button", { name: /new layout/i }));
    const dialog = screen.getByRole("dialog", { name: "New plant layout" });
    expect(within(dialog).getByRole("textbox", { name: "Building" })).toHaveValue("Main Plant");
    expect(within(dialog).getByTestId("existing-walls")).toHaveTextContent(/Main Plant’s drawing, from Main Plant v1 — 240 ft × 140 ft/);
    expect(within(dialog).queryByLabelText("Walls drawing")).toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: /Start with its 11 aisles and no-go areas/ })).toBeChecked();

    await user.type(within(dialog).getByPlaceholderText("e.g. Main Plant"), "Main Plant — option B");
    await user.click(within(dialog).getByRole("button", { name: "Start layout" }));
    await waitFor(async () => expect((await listPlantLayouts()).length).toBe(5));
    const created = (await listPlantLayouts()).at(-1)!;
    expect(created).toMatchObject({ building: "Main Plant", wallsFileId: "mock-walls-main", doc: { extent: { w: 2880, h: 1680 }, items: [] } });
    expect(created.doc.areas).toHaveLength(11);
  });

  it("can leave the areas behind, or upload a different drawing for an existing building", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantLayoutsView />, { route: "/operations/plant-map?building=Panel+Plant" });
    await user.click(await screen.findByRole("button", { name: /new layout/i }));
    const dialog = screen.getByRole("dialog", { name: "New plant layout" });
    await user.click(within(dialog).getByRole("button", { name: "Upload a different drawing" }));
    expect(within(dialog).getByLabelText("Walls drawing")).toBeInTheDocument();
    // Not picking one is refused rather than quietly falling back.
    await user.type(within(dialog).getByPlaceholderText("e.g. Main Plant"), "Panel Plant B");
    await user.click(within(dialog).getByRole("button", { name: "Start layout" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Pick the building's walls drawing.");

    await user.click(within(dialog).getByRole("button", { name: "Use Panel Plant’s drawing instead" }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Start with its 5 aisles/ }));
    await user.click(within(dialog).getByRole("button", { name: "Start layout" }));
    await waitFor(async () => expect((await listPlantLayouts()).length).toBe(5));
    expect((await listPlantLayouts()).at(-1)).toMatchObject({ wallsFileId: "mock-walls-panel", doc: { areas: [] } });
  });

  it("keeps out somebody not on the roles list — no coming soon, just who to ask", async () => {
    who.email = "someone.else@example.com";
    renderWithProviders(<PlantLayoutsView />, { route: "/operations/plant-map" });
    expect(await screen.findByText("The Plant Map is limited")).toBeInTheDocument();
    expect(screen.getByText(/Ask a Plant Map admin to add you/)).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it("lets an ARC admin who isn't on the list manage the roles — and nothing else", async () => {
    // A bootstrap ARC admin, not on the demo's Plant Map Roles list.
    who.email = "ray.white@altronic-llc.com";
    renderWithProviders(<PlantMapRolesView />, { route: "/operations/plant-map/roles" });
    expect(await screen.findByRole("checkbox", { name: "Morgan Example: Plant Map admin" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Plant Map sections" });
    expect(within(nav).queryByRole("link", { name: /Layouts/ })).toBeNull();
    expect(within(nav).getByRole("link", { name: /Roles/ })).toBeInTheDocument();
  });

  it("lets a viewer look, without New layout", async () => {
    who.email = "sam.viewer@example.com";
    renderWithProviders(<PlantLayoutsView />, { route: "/operations/plant-map" });
    expect(await screen.findByRole("tablist", { name: "Buildings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new layout/i })).toBeNull();
  });
});

describe("PlantLayoutView", () => {
  it("draws a published layout and finds nothing wrong with it", async () => {
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/1", routePattern: "/operations/plant-map/:id" });
    expect(await screen.findByText("Nothing overlaps, and everything is inside the building.")).toBeInTheDocument();
    const map = screen.getByRole("img", { name: "Main Plant plant layout" });
    expect(map.getAttribute("data-extent")).toBe("2880 1680");
    expect(map.querySelectorAll('[data-layer="items"] > g')).toHaveLength(27);
    expect(map.querySelector('[data-outline="problem"]')).toBeNull();
  });

  it("outlines and lists the problems on a draft, and selecting one shows its details", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/2", routePattern: "/operations/plant-map/:id" });
    const check = await screen.findByRole("region", { name: "Placement check" });
    await waitFor(() => expect(within(check).getByText(/problems/)).toBeInTheDocument());
    expect(within(check).getByText(/can't be published until they're fixed/)).toBeInTheDocument();
    expect(within(check).getByRole("button", { name: "Sits in N-S aisle sits in an aisle (N-S aisle north)." })).toBeInTheDocument();

    const map = screen.getByRole("img", { name: "Main Plant plant layout" });
    const outlined = [...map.querySelectorAll('[data-outline="problem"]')].map((el) => el.parentElement!.getAttribute("data-uid"));
    expect(outlined.sort()).toEqual(["i_0001", "i_0002", "i_bad1", "i_bad2", "i_bad3"]);

    await user.click(within(check).getByRole("button", { name: "Sits in N-S aisle sits in an aisle (N-S aisle north)." }));
    const selected = screen.getByRole("region", { name: "Selected item" });
    expect(within(selected).getByText("Sits in N-S aisle")).toBeInTheDocument();
    expect(within(selected).getByText("CNC Vertical Mill (generic)")).toBeInTheDocument();
  });

  it("draws the Engineering & Sales demo, its walkway included, with nothing wrong", async () => {
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/4", routePattern: "/operations/plant-map/:id" });
    expect(await screen.findByText("Nothing overlaps, and everything is inside the building.")).toBeInTheDocument();
    const map = screen.getByRole("img", { name: "Engineering & Sales plant layout" });
    expect(map.getAttribute("data-extent")).toBe("1440 960");
    expect(map.querySelectorAll('[data-layer="items"] > g')).toHaveLength(17);
    expect(map.querySelector('[data-layer="areas"] [data-kind="aisle"] title')).toHaveTextContent("Main walkway");
  });

  it("starts the safety layer hidden, and shows it — or one group of it — when ticked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/4", routePattern: "/operations/plant-map/:id" });
    await screen.findByText("Nothing overlaps, and everything is inside the building.");
    const layers = screen.getByRole("region", { name: "Layers" });
    const map = screen.getByRole("img", { name: "Engineering & Sales plant layout" });
    const drawn = () => map.querySelectorAll('[data-layer="items"] > g').length;
    expect(drawn()).toBe(17);

    const safety = within(layers).getByRole("checkbox", { name: /^Safety/ });
    expect(safety).not.toBeChecked();
    await user.click(safety);
    expect(drawn()).toBe(21);

    await user.click(within(layers).getByRole("checkbox", { name: /^Extinguishers/ }));
    expect(drawn()).toBe(19);
    // Hiding is display only: the check still reads every item.
    expect(screen.getByText("Nothing overlaps, and everything is inside the building.")).toBeInTheDocument();
  });

  it("lists layer items in the table, and picking a hidden one shows its layer", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/4", routePattern: "/operations/plant-map/:id" });
    await screen.findByText("Nothing overlaps, and everything is inside the building.");
    const table = screen.getByRole("region", { name: "Items on this layout" });
    const exitRow = within(table).getByRole("cell", { name: "Safety · Fire exits" }).closest("tr")!;
    const map = screen.getByRole("img", { name: "Engineering & Sales plant layout" });
    expect(map.querySelector('[data-uid="i_es03"]')).toBeNull();

    await user.click(exitRow);
    expect(map.querySelector('[data-uid="i_es03"]')).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "Layers" })).getByRole("checkbox", { name: /^Safety/ })).toBeChecked();
    expect(within(screen.getByRole("region", { name: "Selected item" })).getByText("Safety · Fire exits")).toBeInTheDocument();
  });

  it("shows no Layers panel on a layout without any", async () => {
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/1", routePattern: "/operations/plant-map/:id" });
    await screen.findByText("Nothing overlaps, and everything is inside the building.");
    expect(screen.queryByRole("region", { name: "Layers" })).toBeNull();
  });

  it("says when a layout doesn't exist", async () => {
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/99", routePattern: "/operations/plant-map/:id" });
    expect(await screen.findByText("That layout doesn't exist.")).toBeInTheDocument();
  });
});

describe("publishing", () => {
  it("won't publish a draft with problems — the button says why", async () => {
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/2", routePattern: "/operations/plant-map/:id" });
    await screen.findByRole("region", { name: "Placement check" });
    const button = await screen.findByRole("button", { name: "Publish" });
    await waitFor(() => expect(button).toHaveAttribute("title", "Fix the 4 placement problems first."));
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.setup().click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("publishes a clean draft after asking, and it becomes Published", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/4", routePattern: "/operations/plant-map/:id" });
    await screen.findByText("Nothing overlaps, and everything is inside the building.");
    await user.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Publish Engineering & Sales v1?");
    expect(dialog).toHaveTextContent("It's the first published version of this layout.");
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));
    await waitFor(async () => expect((await listPlantLayouts()).find((l) => l.id === 4)?.status).toBe("Published"));
    // A published layout offers a new draft, not Publish.
    expect(await screen.findByRole("button", { name: "Edit as a new draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("isn't offered to an editor", async () => {
    who.email = "riley.sample@example.com";
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/4", routePattern: "/operations/plant-map/:id" });
    expect(await screen.findByRole("button", { name: "Edit layout" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });
});

describe("deleting a layout", () => {
  it("deletes a draft and KEEPS the walls drawing the published version still uses", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/2", routePattern: "/operations/plant-map/:id" });
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete Main Plant v2?");
    await waitFor(() => expect(dialog).toHaveTextContent("Its walls drawing is kept, because Main Plant v1 (Published) still uses it."));
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(async () => expect((await listPlantLayouts()).some((l) => l.id === 2)).toBe(false));
    expect(await readWallsFile("mock-walls-main")).toContain("<svg");
  });

  it("deletes the walls drawing too when no other layout uses it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/3", routePattern: "/operations/plant-map/:id" });
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog).toHaveTextContent("Its walls drawing is deleted too — no other layout uses it."));
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(async () => expect((await listPlantLayouts()).some((l) => l.id === 3)).toBe(false));
    await expect(readWallsFile("mock-walls-panel")).rejects.toThrow(/isn't in the Plant Layout Files library/);
  });

  it("can be cancelled, and nothing changes", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/3", routePattern: "/operations/plant-map/:id" });
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep it" }));
    expect((await listPlantLayouts()).some((l) => l.id === 3)).toBe(true);
  });

  it("isn't offered on the published layout", async () => {
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/1", routePattern: "/operations/plant-map/:id" });
    expect(await screen.findByRole("button", { name: "Edit the draft (v2)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("isn't offered to an editor", async () => {
    who.email = "riley.sample@example.com";
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/3", routePattern: "/operations/plant-map/:id" });
    expect(await screen.findByRole("button", { name: "Edit layout" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

describe("PlantMapRolesView", () => {
  it("lets a Plant Map admin tick a role", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PlantMapRolesView />, { route: "/operations/plant-map/roles" });
    const box = await screen.findByRole("checkbox", { name: "Morgan Example: Plant Map admin" });
    expect(box).not.toBeChecked();
    await user.click(box);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Morgan Example: Plant Map admin" })).toBeChecked());
  });

  it("tells an editor they can't manage it", async () => {
    who.email = "riley.sample@example.com";
    renderWithProviders(<PlantMapRolesView />, { route: "/operations/plant-map/roles" });
    expect(await screen.findByText(/Only a Plant Map admin or an ARC admin/)).toBeInTheDocument();
  });
});
