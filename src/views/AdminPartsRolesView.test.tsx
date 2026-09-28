import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPartsRolesMockStore, listPartsRoles } from "@/api/partsRoles";

// The real hooks against the mock store, so a tick on this screen is proven to
// reach the list — only who's an admin and who's in the directory are stubbed.
const admin = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => admin.isAdmin }));
vi.mock("@/hooks/useDirectory", () => ({
  useDirectoryPeople: () => [
    { displayName: "Alexandra Russell", email: "alexandra.russell@altronic-llc.com" },
    { displayName: "Glenn Terry", email: "glenn.terry@altronic-llc.com" },
  ],
}));
vi.mock("@/hooks/useAdmins", () => ({ useAdmins: () => ({ data: [] }) }));

import { AdminPartsRolesView } from "./AdminPartsRolesView";

beforeEach(() => {
  admin.isAdmin = true;
  __resetPartsRolesMockStore();
});

function renderView() {
  return renderWithProviders(<AdminPartsRolesView />, { route: "/admin/parts-roles" });
}

describe("AdminPartsRolesView", () => {
  it("is for ARC admins only", () => {
    admin.isAdmin = false;
    renderView();
    expect(screen.getByText("Admin access required")).toBeInTheDocument();
  });

  it("lists everyone with their tags, and says what each role allows", async () => {
    renderView();
    const row = (await screen.findByText("Sheila Horn")).closest("tr")!;
    expect(within(row).getByRole("checkbox", { name: "SAP admin (Reviewing Admin)" })).toBeChecked();
    expect(within(row).getByRole("checkbox", { name: "Editor" })).not.toBeChecked();
    expect(screen.getByText(/Approves new HCO components at the Engineering Review step/)).toBeInTheDocument();
  });

  it("names who gets which emails, from the list as it stands", async () => {
    renderView();
    expect(await screen.findByText(/email the reviewing engineers \(Demo User, Glenn Terry, Brandon Mirto\)/)).toBeInTheDocument();
    expect(screen.getByText(/email the SAP admins \(Demo User, Sheila Horn\)/)).toBeInTheDocument();
  });

  it("changes somebody's roles with a tick", async () => {
    renderView();
    const row = (await screen.findByText("Sheila Horn")).closest("tr")!;
    await userEvent.click(within(row).getByRole("checkbox", { name: "HCO editor" }));
    await waitFor(async () =>
      expect((await listPartsRoles()).find((e) => e.displayName === "Sheila Horn")?.roles).toEqual([
        "hco editor",
        "sap admin",
      ]),
    );
  });

  it("adds a person, not offering anyone already on the list", async () => {
    renderView();
    await userEvent.click(await screen.findByRole("button", { name: /Add person/ }));
    const dialog = screen.getByRole("dialog", { name: "Add person to Parts Roles" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Search for a person/ }));
    // Glenn is already on the list.
    expect(screen.queryByRole("option", { name: /Glenn Terry/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /Alexandra Russell/ }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^Editor/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Add person" }));
    await waitFor(async () =>
      expect((await listPartsRoles()).find((e) => e.email === "alexandra.russell@altronic-llc.com")?.roles).toEqual([
        "editor",
      ]),
    );
  });

  it("won't add somebody with no role — they'd be nobody to this list", async () => {
    renderView();
    await userEvent.click(await screen.findByRole("button", { name: /Add person/ }));
    const dialog = screen.getByRole("dialog", { name: "Add person to Parts Roles" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Search for a person/ }));
    await userEvent.click(screen.getByRole("option", { name: /Alexandra Russell/ }));
    expect(within(dialog).getByRole("button", { name: "Add person" })).toBeDisabled();
  });

  it("removes a person after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderView();
    const row = (await screen.findByText("Brandon Mirto")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: /Remove/ }));
    await waitFor(async () => expect((await listPartsRoles()).some((e) => e.displayName === "Brandon Mirto")).toBe(false));
  });
});
