import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// Panel Project Dashboard (BusinessIT#42), demo mode, real hooks: the project
// list and one project's page — read-only, with links down to the order and
// task pages.

vi.mock("@/hooks/usePanelRoles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/usePanelRoles")>()),
  usePanelTeamAccess: () => ({ canOpen: false, canOpenBom: false, canBuildBom: false, resolving: false, hint: "" }),
}));

import { createPanelOrder, resetPanelOrdersMockStore } from "@/api/panelOrders";
import { resetPanelTasksMockStore } from "@/api/panelTasks";
import { PanelProjectsView } from "./PanelProjectsView";
import { PanelProjectDashboardView } from "./PanelProjectDashboardView";

beforeEach(() => {
  resetPanelOrdersMockStore();
  resetPanelTasksMockStore();
});

describe("Panel Project Dashboard — the project list", () => {
  it("lists every project with its counts, each linking to its dashboard", async () => {
    renderWithProviders(<PanelProjectsView />, { route: "/panels/projects" });
    const link = await screen.findByRole("link", { name: "P-0001" });
    expect(link).toHaveAttribute("href", "/panels/projects/1");
    expect(screen.getByRole("link", { name: "P-0005" })).toBeInTheDocument();
    expect(screen.getByText(/5 projects/)).toBeInTheDocument();
  });

  it("narrows by search", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PanelProjectsView />, { route: "/panels/projects" });
    await screen.findByRole("link", { name: "P-0001" });
    await user.type(screen.getByPlaceholderText("Search projects…"), "Archrock");
    await waitFor(() => expect(screen.queryByRole("link", { name: "P-0002" })).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "P-0001" })).toBeInTheDocument();
  });

  it("sorts by a column header", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PanelProjectsView />, { route: "/panels/projects" });
    await screen.findByRole("link", { name: "P-0001" });
    await user.click(screen.getByRole("button", { name: /sort by project/i }));
    const firstLinks = () =>
      screen.getAllByRole("link").filter((a) => /^P-\d+$/.test(a.textContent ?? "")).map((a) => a.textContent);
    expect(firstLinks()).toEqual(["P-0001", "P-0002", "P-0003", "P-0004", "P-0005"]);
  });
});

describe("Panel Project Dashboard — one project", () => {
  function renderProject(id = 1) {
    return renderWithProviders(<PanelProjectDashboardView />, {
      route: `/panels/projects/${id}`,
      routePattern: "/panels/projects/:id",
    });
  }

  it("shows the project's orders and tasks, linked down to their pages", async () => {
    renderProject();
    expect(await screen.findByRole("heading", { name: "P-0001", level: 1 })).toBeInTheDocument();
    const orders = screen.getByText(/^Orders \(/).closest("section")!;
    expect(within(orders).getByRole("link", { name: "Archrock skid panel build — June release" })).toHaveAttribute(
      "href",
      "/panels/order/1",
    );
    const tasks = screen.getByText(/^Tasks \(/).closest("section")!;
    expect(within(tasks).getByRole("link", { name: "Draw up enclosure layout for Archrock skids" })).toHaveAttribute(
      "href",
      "/panels/task/1",
    );
    // No other project's work.
    expect(screen.queryByText("UE Compression PLC reprogram")).not.toBeInTheDocument();
  });

  it("merges the comments from its orders and tasks, newest first, naming where each was posted", async () => {
    renderProject();
    const discussion = (await screen.findByText(/^Discussion \(/)).closest("section")!;
    const items = within(discussion).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Sarah Shaffer");
    expect(within(items[0]).getByRole("link", { name: "Draw up enclosure layout for Archrock skids" })).toHaveAttribute(
      "href",
      "/panels/task/1",
    );
    expect(items[1]).toHaveTextContent("Enclosures are on a 2-week lead");
    expect(within(items[1]).getByRole("link")).toHaveAttribute("href", "/panels/order/1");
  });

  it("is read-only — no inputs, no edit buttons", async () => {
    renderProject();
    await screen.findByRole("heading", { name: "P-0001", level: 1 });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit/i })).not.toBeInTheDocument();
  });

  it("links to Panel Orders and Panel Tasks filtered to the project", async () => {
    renderProject();
    await screen.findByRole("heading", { name: "P-0001", level: 1 });
    expect(screen.getByRole("link", { name: /open in panel orders/i })).toHaveAttribute(
      "href",
      "/panels/orders?project=1&archived=all",
    );
    expect(screen.getByRole("link", { name: /open in panel tasks/i })).toHaveAttribute(
      "href",
      "/panels/tasks?project=1",
    );
  });

  it("offers a pill per customer, and a pill narrows orders, tasks and discussion to that customer", async () => {
    // A second customer on demo project P-0001 (order 1 is Archrock's).
    await createPanelOrder({ title: "Odessa repeat build", customer: "Kodiak Gas", projectLookupId: 1 });
    const user = userEvent.setup();
    renderProject();
    const pills = await screen.findByRole("region", { name: "Customers" });
    expect(within(pills).getByRole("button", { name: /All customers 2/ })).toHaveAttribute("aria-pressed", "true");
    const kodiak = within(pills).getByRole("button", { name: /Kodiak Gas 1/ });

    await user.click(kodiak);
    expect(kodiak).toHaveAttribute("aria-pressed", "true");
    const orders = screen.getByText(/^Orders \(/).closest("section")!;
    expect(within(orders).getByRole("link", { name: "Odessa repeat build" })).toBeInTheDocument();
    expect(within(orders).queryByRole("link", { name: /Archrock skid panel build/ })).not.toBeInTheDocument();
    // Archrock's task and comments go with it.
    expect(screen.queryByRole("link", { name: "Draw up enclosure layout for Archrock skids" })).not.toBeInTheDocument();
    expect(screen.getByText(/^Discussion \(0\)/)).toBeInTheDocument();
    expect(screen.getByText(/For/)).toHaveTextContent("For Kodiak Gas:");

    // Clicking it again shows everything.
    await user.click(kodiak);
    expect(within(screen.getByText(/^Orders \(/).closest("section")!).getByRole("link", { name: /Archrock skid panel build/ })).toBeInTheDocument();
  });

  it("opens on the customer named in the URL", async () => {
    await createPanelOrder({ title: "Odessa repeat build", customer: "Kodiak Gas", projectLookupId: 1 });
    renderWithProviders(<PanelProjectDashboardView />, {
      route: "/panels/projects/1?customer=archrock",
      routePattern: "/panels/projects/:id",
    });
    const pills = await screen.findByRole("region", { name: "Customers" });
    expect(within(pills).getByRole("button", { name: /Archrock 1/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("link", { name: "Odessa repeat build" })).not.toBeInTheDocument();
  });

  it("shows no customer pills when every order is for one customer", async () => {
    renderProject();
    await screen.findByRole("heading", { name: "P-0001", level: 1 });
    expect(screen.queryByRole("region", { name: "Customers" })).not.toBeInTheDocument();
  });

  it("says so for a project that doesn't exist", async () => {
    renderProject(999);
    expect(await screen.findByText("Panel project not found.")).toBeInTheDocument();
  });
});

describe("Panel Project Dashboard — on a phone", () => {
  const desktopWidth = window.innerWidth;
  afterEach(() => {
    window.innerWidth = desktopWidth;
  });

  it("shows the project list as cards with a Sort by picker, not a table", async () => {
    window.innerWidth = 375;
    renderWithProviders(<PanelProjectsView />, { route: "/panels/projects" });
    expect(await screen.findByRole("link", { name: /P-0001/ })).toHaveAttribute("href", "/panels/projects/1");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Sort by")).toBeInTheDocument();
  });

  it("shows a project's orders and tasks as cards", async () => {
    window.innerWidth = 375;
    renderWithProviders(<PanelProjectDashboardView />, {
      route: "/panels/projects/1",
      routePattern: "/panels/projects/:id",
    });
    await screen.findByRole("heading", { name: "P-0001", level: 1 });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const orders = screen.getByText(/^Orders \(/).closest("section")!;
    expect(within(orders).getByRole("link", { name: /Archrock skid panel build — June release/ })).toHaveAttribute(
      "href",
      "/panels/order/1",
    );
    expect(screen.getAllByText("Sort by")).toHaveLength(2);
  });
});
