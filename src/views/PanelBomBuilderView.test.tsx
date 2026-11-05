import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// The Panel SAP BOM Builder screen (BusinessIT#59), in demo mode on the
// invented demo parts and kits. The rules themselves are in
// lib/panelBom.test.ts; this pins the wiring: picks → the SAP BOM, the
// hand-entry box, the paste blocks, cost shown or hidden, and saving.

const costs = vi.hoisted(() => ({ fail: null as Error | null }));
vi.mock("@/api/panelBomCosts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/panelBomCosts")>();
  return {
    ...actual,
    listPanelBomCosts: (saps: string[]) => (costs.fail ? Promise.reject(costs.fail) : actual.listPanelBomCosts(saps)),
  };
});

import { PanelBomBuilderView } from "./PanelBomBuilderView";
import { listPanelBoms, resetPanelBomsMockStore } from "@/api/panelBoms";
import { resetPanelBomPartsMockStore } from "@/api/panelBomParts";
import { FabricRequestError } from "@/api/fabric";

beforeEach(() => {
  costs.fail = null;
  resetPanelBomsMockStore();
  resetPanelBomPartsMockStore();
  localStorage.clear();
});
afterEach(() => localStorage.clear());

function render() {
  return renderWithProviders(<PanelBomBuilderView />, { route: "/panels/bom-builder", routePattern: "/panels/bom-builder" });
}
const bom = () => within(screen.getByRole("complementary", { name: "SAP BOM" }));

describe("PanelBomBuilderView", () => {
  it("turns a kit and a part into numbered SAP lines, and lists the kit's non-SAP parts to enter by hand", async () => {
    const user = userEvent.setup();
    render();
    await screen.findAllByText("KIT-DEMO-PURGE");
    await user.click(screen.getByRole("button", { name: "More KIT-DEMO-PURGE" }));
    const qty = screen.getByRole("spinbutton", { name: "Quantity of 9002-0200-00" });
    await user.type(qty, "2");

    expect(bom().getByText("9002-0200-00")).toBeInTheDocument();
    expect(bom().getByText("1000")).toBeInTheDocument(); // cluster 1 starts at 1000
    expect(bom().getByText("3000")).toBeInTheDocument(); // the regulator, cluster 3
    expect(bom().getByText(/Enter in SAP by hand/)).toBeInTheDocument();
    expect(bom().getByText("DEMO-PURGE-CTRL")).toBeInTheDocument();
    expect(bom().getByText("DEMO-VENT")).toBeInTheDocument();
  });

  it("copies Item, L, Qty, SAP # for SAP", async () => {
    const user = userEvent.setup();
    render();
    await screen.findAllByText("KIT-DEMO-PURGE");
    await user.type(screen.getByRole("spinbutton", { name: "Quantity of 9002-0200-00" }), "2");
    await user.click(bom().getByRole("button", { name: /Copy for SAP \(1\)/ }));
    // user-event puts its own clipboard in place; read what landed on it.
    expect(await navigator.clipboard.readText()).toBe("1000\tL\t2\t9002-0200-00");
  });

  it("hides Do Not Quote parts until asked", async () => {
    const user = userEvent.setup();
    render();
    await screen.findAllByText("KIT-DEMO-PURGE");
    expect(screen.queryByText("Relay, 24 VDC, 2 pole (superseded)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide Do-Not-Quote" }));
    expect(screen.getByText("Relay, 24 VDC, 2 pole (superseded)")).toBeInTheDocument();
  });

  it("shows SAP's cost, and the estimate", async () => {
    const user = userEvent.setup();
    render();
    expect(await screen.findAllByText("$2,450.00")).not.toHaveLength(0);
    await user.type(screen.getByRole("spinbutton", { name: "Quantity of 9002-0200-00" }), "2");
    expect(bom().getByText(/est\. \$4,900/)).toBeInTheDocument();
  });

  it("hides cost, saying why, when the account can't read it", async () => {
    costs.fail = new FabricRequestError("refused", "http", { status: 403 });
    render();
    expect(await screen.findByText(/Costs are hidden/)).toBeInTheDocument();
    expect(screen.queryByText("$2,450.00")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("saves the picks and the lines, and needs a Panel System # to do it", async () => {
    const user = userEvent.setup();
    render();
    await screen.findAllByText("KIT-DEMO-PURGE");
    await user.click(screen.getByRole("button", { name: "More KIT-DEMO-ENC-36" }));
    await user.click(screen.getByRole("button", { name: "Save BOM" }));
    expect((await listPanelBoms()).map((b) => b.panelSystemNumber)).toEqual(["DEMO-PS-1001"]);

    await user.type(screen.getByRole("textbox", { name: /Panel System #/ }), "PS-2002");
    await user.click(screen.getByRole("button", { name: "Save BOM" }));
    await waitFor(async () => expect((await listPanelBoms()).map((b) => b.panelSystemNumber)).toContain("PS-2002"));
    const saved = (await listPanelBoms()).find((b) => b.panelSystemNumber === "PS-2002")!;
    expect(saved.picks).toEqual({ parts: {}, kits: { "KIT-DEMO-ENC-36": 1 } });
    expect(saved.savedLines.map((l) => [l.item, l.sapPartNumber, l.qty])).toEqual([
      [10, "9001-0110-00", 1],
      [20, "9001-0121-00", 2],
      [30, "9001-0100-00", 1],
      [40, "9001-0120-00", 4],
    ]);
  });

  it("keeps unsaved picks in this browser and says so when they come back", async () => {
    const user = userEvent.setup();
    const first = render();
    await screen.findAllByText("KIT-DEMO-PURGE");
    await user.type(screen.getByRole("spinbutton", { name: "Quantity of 9002-0200-00" }), "3");
    await waitFor(() => expect(localStorage.getItem("arc:panel-bom:new")).toContain("9002-0200-00"));
    first.unmount();

    render();
    expect(await screen.findByText(/Draft restored/)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Quantity of 9002-0200-00" })).toHaveValue(3);
  });
});
