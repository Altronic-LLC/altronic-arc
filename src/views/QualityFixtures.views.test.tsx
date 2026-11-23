import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetQualityFixturesMockStore } from "@/api/qualityFixtures";
import { __resetQualityFixtureRolesMockStore } from "@/api/qualityFixtureRoles";

// The Quality Fixture Log's screens, in mock mode. demo.user@altronic-llc.com
// is an editor + admin on the mock roles list; somebody@example.com is on no
// list at all and must be able to read everything and change nothing.

const me = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Me", email: me.email, lookupId: 1 }),
  useCurrentUserEmails: () => [me.email],
}));

import { QualityFixturesView } from "./QualityFixturesView";
import { QualityFixtureDetailView } from "./QualityFixtureDetailView";
import { QualityFixtureRolesView } from "./QualityFixtureRolesView";

beforeEach(() => {
  me.email = "demo.user@altronic-llc.com";
  __resetQualityFixturesMockStore();
  __resetQualityFixtureRolesMockStore();
});

async function renderList(route = "/quality/fixtures") {
  renderWithProviders(<QualityFixturesView />, { route });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
}

describe("QualityFixturesView", () => {
  it("opens on active fixtures in log order, with retired ones a pill away", async () => {
    await renderList();
    expect(screen.getByRole("heading", { name: "Quality Fixture Log" })).toBeInTheDocument();
    expect(screen.getByText("QF4A")).toBeInTheDocument();
    expect(screen.queryByText("QF5")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retired 1/ })).toBeInTheDocument();
  });

  it("shows retired fixtures on ?show=retired", async () => {
    await renderList("/quality/fixtures?show=retired");
    expect(screen.getByText("QF5")).toBeInTheDocument();
    expect(screen.queryByText("QF1")).not.toBeInTheDocument();
  });

  it("searches every field, part numbers included", async () => {
    await renderList();
    await userEvent.type(screen.getByPlaceholderText(/Fixture #, description/), "900100");
    await waitFor(() => expect(screen.queryByText("QF1")).not.toBeInTheDocument());
    expect(screen.getByText("QF200")).toBeInTheDocument();
  });

  it("offers Add fixture to an editor, with the next free number filled in", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /Add fixture/ }));
    const dialog = await screen.findByRole("dialog", { name: "Add a fixture" });
    expect(within(dialog).getByDisplayValue("QF204")).toBeInTheDocument();
  });

  it("refuses a number already on the log before anything is written", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /Add fixture/ }));
    const dialog = await screen.findByRole("dialog", { name: "Add a fixture" });
    const number = within(dialog).getByDisplayValue("QF204");
    await userEvent.clear(number);
    await userEvent.type(number, "qf5");
    expect(within(dialog).getByText("QF5 is already on the log.")).toBeInTheDocument();
  });

  it("hides Add from somebody not on the roles list, and says why", async () => {
    me.email = "somebody@example.com";
    await renderList();
    expect(screen.queryByRole("button", { name: /Add fixture/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Only a Fixture Log editor/)).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Roles" })).not.toBeInTheDocument();
  });
});

describe("QualityFixtureDetailView", () => {
  function renderDetail(id: number) {
    renderWithProviders(<QualityFixtureDetailView />, {
      route: `/quality/fixtures/${id}`,
      routePattern: "/quality/fixtures/:id",
    });
  }

  it("shows the fixture to anyone, with no way to change it", async () => {
    me.email = "somebody@example.com";
    renderDetail(7);
    expect(await screen.findByRole("heading", { name: "QF200" })).toBeInTheDocument();
    expect(screen.getByText("Coil firing adapter")).toBeInTheDocument();
    expect(screen.getByText("Coil test room")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Only a Fixture Log editor/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retire/ })).not.toBeInTheDocument();
  });

  it("lets an editor retire a fixture, and put it back", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDetail(1);
    await userEvent.click(await screen.findByRole("button", { name: /Retire/ }));
    expect(await screen.findByRole("button", { name: /Put back in service/ })).toBeInTheDocument();
    expect(screen.getByText("Retired")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Put back in service/ }));
    expect(await screen.findByRole("button", { name: /Retire/ })).toBeInTheDocument();
  });

  it("saves an edit", async () => {
    renderDetail(2);
    await userEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit QF2" });
    await userEvent.type(within(dialog).getByLabelText("Location"), "Bench 9");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Bench 9")).toBeInTheDocument();
  });

  it("says so when the fixture isn't on the log", async () => {
    renderDetail(999);
    expect(await screen.findByText("That fixture isn't on the log.")).toBeInTheDocument();
  });
});

describe("QualityFixtureRolesView", () => {
  it("lists the people for a Fixture Log admin", async () => {
    renderWithProviders(<QualityFixtureRolesView />, { route: "/quality/fixtures/roles" });
    expect(await screen.findByText("quality.lead@example.com")).toBeInTheDocument();
  });

  it("refuses somebody who isn't an admin", async () => {
    me.email = "somebody@example.com";
    renderWithProviders(<QualityFixtureRolesView />, { route: "/quality/fixtures/roles" });
    expect(await screen.findByText(/Only a Fixture Log admin or an ARC admin/)).toBeInTheDocument();
    expect(screen.queryByText("quality.lead@example.com")).not.toBeInTheDocument();
  });
});
