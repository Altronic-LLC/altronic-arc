import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { ADMIN_GROUPS, AdminHomeView } from "./AdminHomeView";
import appSource from "../App.tsx?raw";

const open = () => renderWithProviders(<AdminHomeView />, { route: "/admin" });

describe("AdminHomeView", () => {
  it("groups the admin pages by department", () => {
    open();
    for (const g of ADMIN_GROUPS) {
      const section = screen.getByRole("region", { name: g.title });
      for (const t of g.tools) {
        expect(within(section).getByRole("link", { name: new RegExp(t.title) })).toHaveAttribute("href", t.to);
      }
    }
    const harness = screen.getByRole("region", { name: "Harness" });
    expect(within(harness).getByRole("link", { name: /Crimp Specs/ })).toHaveAttribute(
      "href",
      "/harness/crimp-checks/specs",
    );
  });

  it("keeps every page the old Admins-page link list offered", () => {
    const offered = new Set(ADMIN_GROUPS.flatMap((g) => g.tools.map((t) => t.to)));
    for (const to of [
      "/admin/admins",
      "/admin/projects",
      "/admin/notification-recipients",
      "/admin/eir-roles",
      "/admin/parts-roles",
      "/admin/maintenance-roles",
      "/admin/operations-projects",
      "/admin/panel-projects",
      "/admin/panel-roles",
      "/admin/quick-links",
      "/harness/alert-recipients",
      "/harness/crimp-checks/specs",
      "/harness/pull-tests/specs",
      "/operations/alert-recipients",
      "/operations/plant-map/roles",
      "/quality/fixtures/roles",
      "/operations/coating-checks/specs",
      "/harness/production-log/part-numbers",
    ]) {
      expect(offered, to).toContain(to);
    }
  });

  it("every button goes to a real route", () => {
    for (const g of ADMIN_GROUPS) {
      for (const t of g.tools) expect(appSource, t.to).toContain(`path="${t.to}"`);
    }
  });

  it("every admin screen's Admin link goes back to this page, not to the Admins list", () => {
    // The screens used to link "Admins →" to /admin/admins, which was the hub
    // before /admin existed (2026-11-23).
    const screens = import.meta.glob<string>("./Admin*View.tsx", { query: "?raw", import: "default", eager: true });
    expect(Object.keys(screens).length).toBeGreaterThan(8);
    for (const [file, source] of Object.entries(screens)) {
      expect(source, file).not.toContain('to="/admin/admins"');
      expect(source, file).not.toContain("Admins →");
    }
  });

  it("search narrows the buttons, across departments", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText("Search admin pages"), "notified");
    // The search box debounces.
    expect(await screen.findByRole("region", { name: "Harness" })).toBeInTheDocument();
    await expect.poll(() => screen.queryByRole("region", { name: "Engineering" })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(2);

    await user.clear(screen.getByLabelText("Search admin pages"));
    await user.type(screen.getByLabelText("Search admin pages"), "zzz");
    expect(await screen.findByText(/No admin page matches/)).toBeInTheDocument();
  });
});
