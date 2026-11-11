import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPlantLayoutsMockStore, getPlantLayout } from "@/api/plantLayouts";
import { __resetPlantMapRolesMockStore } from "@/api/plantMapRoles";
import { __resetPlantLayoutFilesForTests } from "@/api/plantLayoutFiles";
import { __resetLayoutComponentsMockStore, listLayoutComponents, replaceLayoutComponent } from "@/api/layoutComponents";
import type { LayoutComponent, ReplaceLayoutComponentInput } from "@/types/plant";

// =============================================================================
// A replaced symbol in the editor (demo mode). Replacing adds a new version;
// the layouts using the old one keep it until they're updated in a draft —
// all at once from the notice, or one item from the inspector — and the
// palette offers only the latest. On the Main Plant draft (layout 2), whose
// two CNC mills (VMC-1, VMC-2) overlap.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

import { PlantLayoutEditView } from "./PlantLayoutEditView";
import { PlantLayoutView } from "./PlantLayoutView";

const MILL_KEY = "cnc-vmc-120x96";

async function replaceMill(changes: Partial<ReplaceLayoutComponentInput> = {}): Promise<{ v1: LayoutComponent; v2: LayoutComponent }> {
  const v1 = (await listLayoutComponents()).find((c) => c.key === MILL_KEY)!;
  const { id: _id, key: _key, version: _v, active: _a, ...rest } = v1;
  const v2 = await replaceLayoutComponent(v1, { ...rest, category: "Machine", title: "Mill, new drawing", ...changes });
  return { v1, v2 };
}

function openEditor(id: number) {
  return renderWithProviders(<PlantLayoutEditView />, {
    route: `/operations/plant-map/${id}/edit`,
    routePattern: "/operations/plant-map/:id/edit",
  });
}

beforeEach(() => {
  who.email = "demo.user@altronic-llc.com";
  __resetPlantLayoutsMockStore();
  __resetPlantMapRolesMockStore();
  __resetPlantLayoutFilesForTests();
  __resetLayoutComponentsMockStore();
});

describe("a replaced symbol in the editor", () => {
  it("offers only the latest version in the palette", async () => {
    await replaceMill();
    openEditor(3);
    const palette = await screen.findByRole("region", { name: "Symbols" });
    expect(within(palette).getAllByRole("button", { name: /^Add / })).toHaveLength(15);
    expect(within(palette).getByRole("button", { name: "Add Mill, new drawing" })).toBeInTheDocument();
    expect(within(palette).queryByRole("button", { name: "Add CNC Vertical Mill (generic)" })).toBeNull();
  });

  it("updates every item on the old version at once, keeping where each stands, and saves it with the draft", async () => {
    const user = userEvent.setup();
    const { v1, v2 } = await replaceMill({ footprintW: 132 });
    const before = (await getPlantLayout(2))!.doc.items.filter((i) => i.componentId === v1.id);
    expect(before.length).toBeGreaterThan(0);

    openEditor(2);
    const notice = await screen.findByText(new RegExp(`${before.length} items? uses? an older version of its symbol`));
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Update symbols" }));
    expect(notice).not.toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => expect(screen.getByText("All changes saved")).toBeInTheDocument());
    const after = (await getPlantLayout(2))!.doc.items.filter((i) => before.some((b) => b.uid === i.uid));
    expect(after.map((i) => [i.componentId, i.componentVersion, i.w])).toEqual(before.map(() => [v2.id, 2, 132]));
    expect(after.map((i) => [i.x, i.y, i.rot, i.label])).toEqual(before.map((i) => [i.x, i.y, i.rot, i.label]));
  });

  it("updates one item from the inspector, and Ctrl+Z puts it back", async () => {
    const user = userEvent.setup();
    const { v1 } = await replaceMill();
    openEditor(2);
    const check = await screen.findByRole("region", { name: "Placement check" });
    await user.click((await within(check).findAllByRole("button", { name: /VMC-1/ }))[0]);
    const inspector = screen.getByRole("region", { name: "Selected item" });
    expect(within(inspector).getByText("CNC Vertical Mill (generic) · v1")).toBeInTheDocument();
    await user.click(within(inspector).getByRole("button", { name: "Use v2" }));
    expect(within(inspector).getByText("Mill, new drawing · v2")).toBeInTheDocument();
    expect(within(inspector).queryByRole("button", { name: "Use v2" })).toBeNull();

    await user.keyboard("{Control>}z{/Control}");
    expect(within(inspector).getByText("CNC Vertical Mill (generic) · v1")).toBeInTheDocument();
    expect((await getPlantLayout(2))!.doc.items.some((i) => i.componentId === v1.id)).toBe(true);
  });
});

describe("a replaced symbol on the layout page", () => {
  it("tells an editor a published layout keeps the old version until a draft updates it", async () => {
    await replaceMill();
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/1", routePattern: "/operations/plant-map/:id" });
    expect(await screen.findByText(/This published version keeps it as it is/)).toBeInTheDocument();
  });

  it("says nothing to a viewer", async () => {
    who.email = "sam.viewer@example.com";
    await replaceMill();
    renderWithProviders(<PlantLayoutView />, { route: "/operations/plant-map/1", routePattern: "/operations/plant-map/:id" });
    await screen.findByRole("region", { name: "Placement check" });
    expect(screen.queryByText(/older version of its symbol/)).toBeNull();
  });
});
