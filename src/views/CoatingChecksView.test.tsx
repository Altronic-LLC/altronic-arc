import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { resetCoatingCheckMockStore } from "@/api/coatingChecks";
import { listCoatingSpecs, resetCoatingSpecMockStore } from "@/api/coatingSpecs";
import { listOperationsAlertRecipients, resetOperationsAlertRecipientMockStore } from "@/api/operationsAlertRecipients";
import { MOCK_COATING_CHECKS } from "@/data/coatingMockData";
import { listOperationsEquipment } from "@/api/operationsEquipment";
import { CoatingChecksView, parseCoatingYear } from "./CoatingChecksView";
import { CoatingSpecsView } from "./CoatingSpecsView";
import { OperationsAlertRecipientsView } from "./OperationsAlertRecipientsView";

const adminAccess = vi.hoisted(() => ({ isAdmin: false, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));
// The real guard awaits the Admins list; make this file's user one when adminAccess says so.
vi.mock("@/hooks/useRequireArcAdmin", () => ({
  useRequireArcAdmin: () => async (action: string) => {
    if (!adminAccess.isAdmin) throw new Error(`Only ARC admins can ${action}.`);
  },
}));

beforeEach(() => {
  resetCoatingCheckMockStore();
  resetCoatingSpecMockStore();
  resetOperationsAlertRecipientMockStore();
  adminAccess.isAdmin = false;
});

describe("parseCoatingYear", () => {
  it("reads ?year=, falling back to this year", () => {
    expect(parseCoatingYear("all", 2026)).toEqual({ kind: "all" });
    expect(parseCoatingYear("1999", 2026)).toEqual({ kind: "year", year: 2026 });
    expect(parseCoatingYear(null, 2026)).toEqual({ kind: "year", year: 2026 });
  });
});

describe("CoatingChecksView", () => {
  it("lists the checks with the thickness in mm and mils, and counts the ones out of spec", async () => {
    renderWithProviders(<CoatingChecksView />, { route: "/operations/coating-checks" });
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(MOCK_COATING_CHECKS.length + 1);
    expect(within(table).getByRole("columnheader", { name: /Coating \(mm\)/ })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /Mils \(ref\)/ })).toBeInTheDocument();
    expect(screen.getByText("1 out of spec")).toBeInTheDocument();
  });

  it("shows the Who's notified button to ARC admins only", async () => {
    renderWithProviders(<CoatingChecksView />, { route: "/operations/coating-checks" });
    await screen.findByRole("table");
    expect(screen.queryByRole("link", { name: /Who's notified/ })).toBeNull();

    cleanup();
    adminAccess.isAdmin = true;
    renderWithProviders(<CoatingChecksView />, { route: "/operations/coating-checks" });
    await screen.findByRole("table");
    expect(screen.getByRole("link", { name: /Who's notified/ })).toHaveAttribute("href", "/operations/alert-recipients");
  });

  it("narrows to out-of-spec checks, and to one machine, from the URL", async () => {
    renderWithProviders(<CoatingChecksView />, { route: "/operations/coating-checks?result=out" });
    expect(within(await screen.findByRole("table")).getAllByRole("row")).toHaveLength(2);

    cleanup();
    renderWithProviders(<CoatingChecksView />, { route: "/operations/coating-checks?machine=DEMO-SPRAY-2" });
    expect(within(await screen.findByRole("table")).getAllByRole("row")).toHaveLength(2);
  });

  it("opens Machine on the machines checks used, and finds the rest of the register when you type", async () => {
    const register = (await listOperationsEquipment()).map((e) => e.title);
    const notUsed = register.find((t) => !t.startsWith("DEMO-SPRAY"))!;
    renderWithProviders(<CoatingChecksView />, { route: "/operations/coating-checks" });
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "New check" }));
    const dialog = screen.getByRole("dialog", { name: "New coating check" });
    const machine = within(dialog).getByRole("textbox", { name: "Machine" });

    // The short list only — not the whole register.
    await userEvent.click(machine);
    expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual(["DEMO-SPRAY-1", "DEMO-SPRAY-2"]);

    // Typing searches the register too, so a new machine can be picked.
    await userEvent.type(machine, notUsed.slice(0, 6));
    await waitFor(() =>
      expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toContain(notUsed),
    );
  });

  it("opens the check an email links to", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/operations/coating-checks/:id" element={<CoatingChecksView />} />
      </Routes>,
      { route: "/operations/coating-checks/3" },
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit coating check" });
    expect(within(dialog).getByRole("textbox", { name: "Coated reading 1" })).toHaveValue("0.07");
    expect(within(dialog).getByRole("radio", { name: "Inches" })).toBeChecked();
  });
});

describe("CoatingSpecsView", () => {
  it("is read-only for somebody who isn't an ARC admin, and shows limits in mm AND inches, with mils", async () => {
    renderWithProviders(<CoatingSpecsView />, { route: "/operations/coating-checks/specs" });
    const table = await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Add spec" })).toBeDisabled();
    expect(screen.getByText(/Only ARC admins can change the coating specs/)).toBeInTheDocument();
    expect(within(table).getAllByText("0.025 – 0.075 mm").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("0.98 – 2.95 mils").length).toBeGreaterThan(0);
    // Inch limits read X.XXX, whatever unit the spec was entered in.
    expect(within(table).getAllByText("0.001 – 0.003 in").length).toBeGreaterThan(0);
    expect(within(table).getByText("0.002 – 0.008 in")).toBeInTheDocument();
    expect(within(table).getByText("0.0508 – 0.2032 mm")).toBeInTheDocument();
  });

  it("only lets an admin delete a spec no check has used", async () => {
    adminAccess.isAdmin = true;
    renderWithProviders(<CoatingSpecsView />, { route: "/operations/coating-checks/specs" });
    await screen.findByRole("table");
    expect(await screen.findByRole("button", { name: "Delete Acrylic — standard" })).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Delete Urethane (old line)" })).toBeEnabled();
  });

  it("lets an admin add a spec in mm", async () => {
    adminAccess.isAdmin = true;
    renderWithProviders(<CoatingSpecsView />, { route: "/operations/coating-checks/specs" });
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "Add spec" }));
    const dialog = screen.getByRole("dialog", { name: "Add coating spec" });
    const [name, min, max] = within(dialog).getAllByRole("textbox");
    await userEvent.type(name, "Parylene");
    await userEvent.type(min, "0.01");
    await userEvent.type(max, "0.03");
    expect(within(dialog).getByText(/0\.39 – 1\.18 mils/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Parylene")).toBeInTheDocument();
  });

  it("lets an admin enter a spec in inches, stored in mm and judged in inches", async () => {
    adminAccess.isAdmin = true;
    renderWithProviders(<CoatingSpecsView />, { route: "/operations/coating-checks/specs" });
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "Add spec" }));
    const dialog = screen.getByRole("dialog", { name: "Add coating spec" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Inches" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Name/ }), "Inch spec");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Minimum (in)" }), "0.001");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Maximum (in)" }), "0.003");
    expect(within(dialog).getByText(/0\.0254 – 0\.0762 mm · 1\.00 – 3\.00 mils/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByText("Inch spec");
    expect(screen.getAllByText("0.001 – 0.003 in").length).toBeGreaterThan(0);
    const saved = (await listCoatingSpecs()).find((s) => s.name === "Inch spec")!;
    expect(saved).toMatchObject({ minMm: 0.0254, maxMm: 0.0762, specUnit: "in" });
  });
});

describe("CoatingSpecsView on a phone", () => {
  const desktopWidth = window.innerWidth;
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: desktopWidth });
  });

  it("shows cards, not a table you scroll sideways, with every unit and the admin buttons", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    adminAccess.isAdmin = true;
    renderWithProviders(<CoatingSpecsView />, { route: "/operations/coating-checks/specs" });
    expect(await screen.findByText("Silicone — one side")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("0.002 – 0.008 in")).toBeInTheDocument();
    expect(screen.getByText("0.0508 – 0.2032 mm")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Silicone — one side" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete Acrylic — standard" })).toBeDisabled();
  });
});

describe("inch limits are X.XXX", () => {
  it("refuses an inch limit typed to more than three decimals", async () => {
    adminAccess.isAdmin = true;
    renderWithProviders(<CoatingSpecsView />, { route: "/operations/coating-checks/specs" });
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "Add spec" }));
    const dialog = screen.getByRole("dialog", { name: "Add coating spec" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Inches" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Name/ }), "Too precise");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Minimum (in)" }), "0.0015");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Maximum (in)" }), "0.003");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText(/three decimal places/)).toBeInTheDocument();
    expect((await listCoatingSpecs()).some((s) => s.name === "Too precise")).toBe(false);
  });
});

describe("OperationsAlertRecipientsView", () => {
  it("shows who is told about out-of-spec coating, read-only for a non-admin", async () => {
    renderWithProviders(<OperationsAlertRecipientsView />, { route: "/operations/alert-recipients" });
    const region = await screen.findByRole("region", { name: "Coating out of spec" });
    expect(within(region).getByText("Demo Supervisor")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: /Remove Demo Quality/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("lets an ARC admin remove somebody", async () => {
    adminAccess.isAdmin = true;
    renderWithProviders(<OperationsAlertRecipientsView />, { route: "/operations/alert-recipients" });
    const region = await screen.findByRole("region", { name: "Coating out of spec" });
    await userEvent.click(within(region).getByRole("button", { name: /Remove Demo Supervisor/ }));
    await waitFor(async () => {
      expect((await listOperationsAlertRecipients()).map((r) => r.name)).toEqual(["Demo Quality"]);
    });
  });
});
