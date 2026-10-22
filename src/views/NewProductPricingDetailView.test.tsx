import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPricingMockStores, pricingMockDb } from "@/data/pricingMockData";
import { NewProductPricingDetailView } from "./NewProductPricingDetailView";

// =============================================================================
// One New Product Pricing worksheet, in mock mode. NP-2026-0001 (id 1) is at
// R2: three sub-assemblies, with the bare board adjusted from $210 to $185.
//   demo.user = admin, brandon.mirto = manager, katie.fleming = requester.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

const ADMIN = "demo.user@altronic-llc.com";
const MANAGER = "brandon.mirto@altronic-llc.com";
const REQUESTER = "katie.fleming@altronic-llc.com";

beforeEach(() => {
  __resetPricingMockStores();
  who.email = ADMIN;
});

function renderWorksheet(id = 1) {
  return renderWithProviders(<NewProductPricingDetailView />, {
    route: `/sales/pricing/new-product/${id}`,
    routePattern: "/sales/pricing/new-product/:id",
  });
}

async function waitForWorksheet() {
  await screen.findByRole("heading", { level: 1, name: /NP-2026-0001/ }, { timeout: 10_000 });
}

/** The value printed under one of the Cost and price figures. */
function figure(label: string): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? "";
}

/** A File whose text() resolves — jsdom's File may not implement it. */
function csvFile(name: string, text: string): File {
  const file = new File([text], name, { type: "text/csv" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
  return file;
}

describe("NewProductPricingDetailView", () => {
  it("shows its three sub-assemblies with uploaded beside adjusted cost", async () => {
    who.email = MANAGER;
    renderWorksheet();
    await waitForWorksheet();

    expect(screen.getByRole("region", { name: "Sub-assembly Main board" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sub-assembly Output coil set" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sub-assembly Enclosure" })).toBeInTheDocument();

    const board = screen.getByRole("region", { name: "Sub-assembly Main board" });
    const row = within(board).getByDisplayValue("PCB-24-BARE").closest("tr")!;
    expect(within(row).getByText("$210.00")).toBeInTheDocument();
    expect(within(board).getByLabelText("Adjusted cost for PCB-24-BARE")).toHaveValue(185);
  });

  it("refuses a requester", async () => {
    who.email = REQUESTER;
    renderWorksheet();
    expect(await screen.findByText("This is for pricing managers and admins.")).toBeInTheDocument();
    expect(screen.queryByText("NP-2026-0001")).toBeNull();
  });

  it("adds a new sub-assembly's lines from an uploaded CSV", async () => {
    renderWorksheet();
    await waitForWorksheet();

    await userEvent.click(screen.getByRole("button", { name: /Add sub-assembly/ }));
    const input = screen.getByLabelText("Upload CSV for sub-assembly");
    const csv = "Part Number,Description,Current Cost,Qty\nNEW-001,WIDGET,12.50,4\nNEW-002,GADGET,3,2\n";
    await act(async () => {
      fireEvent.change(input, { target: { files: [csvFile("widgets.csv", csv)] } });
    });

    const card = await screen.findByRole("region", { name: "Sub-assembly widgets" });
    expect(within(card).getByDisplayValue("NEW-001")).toBeInTheDocument();
    expect(within(card).getByDisplayValue("NEW-002")).toBeInTheDocument();
    expect(within(card).getByText("$12.50")).toBeInTheDocument();
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
  });

  it("refuses a CSV with no Qty column, naming it", async () => {
    renderWorksheet();
    await waitForWorksheet();

    await userEvent.click(screen.getByRole("button", { name: /Add sub-assembly/ }));
    const input = screen.getByLabelText("Upload CSV for sub-assembly");
    const csv = "Part Number,Description,Current Cost\nNEW-001,WIDGET,12.50\n";
    await act(async () => {
      fireEvent.change(input, { target: { files: [csvFile("broken.csv", csv)] } });
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent('The file has no "Qty" column.');
    expect(screen.queryByDisplayValue("NEW-001")).toBeNull();
  });

  it("an adjusted cost moves the cost USED, never the cost uploaded", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const uploaded = figure("Unit cost (uploaded)");
    const used = figure("Unit cost (used)");
    expect(uploaded).toBe("$851.22");
    expect(used).toBe("$817.24");

    const input = screen.getByLabelText("Adjusted cost for PCB-24-BARE");
    fireEvent.change(input, { target: { value: "200" } });

    // 15 more on the board, through 22% overhead.
    await waitFor(() => expect(figure("Unit cost (used)")).toBe("$835.54"));
    expect(figure("Unit cost (uploaded)")).toBe(uploaded);
  });

  it("adds a component by hand, marked Manual, and its cost counts", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const board = screen.getByRole("region", { name: "Sub-assembly Main board" });

    await userEvent.click(within(board).getByRole("button", { name: /Add component/ }));
    await userEvent.type(within(board).getByLabelText("New component Altronic part number"), "HAND-01");
    await userEvent.type(within(board).getByLabelText("New component description"), "SHIELD CAN");
    await userEvent.clear(within(board).getByLabelText("New component quantity"));
    await userEvent.type(within(board).getByLabelText("New component quantity"), "2");
    await userEvent.type(within(board).getByLabelText("New component cost"), "5");
    await userEvent.click(within(board).getByRole("button", { name: "Add" }));

    const row = within(board).getByDisplayValue("HAND-01").closest("tr")!;
    expect(within(row).getByText("Manual")).toBeInTheDocument();
    // A hand-added component's base cost stays editable.
    expect(within(row).getByLabelText("Base cost for HAND-01")).toHaveValue(5);
    // 2 × $5 more on the board, through 22% overhead: 817.24 + 12.20.
    await waitFor(() => expect(figure("Unit cost (used)")).toBe("$829.44"));
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
  });

  it("won't add a component without a part number", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const board = screen.getByRole("region", { name: "Sub-assembly Main board" });
    await userEvent.click(within(board).getByRole("button", { name: /Add component/ }));
    expect(within(board).getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("edits a CSV component's quantity and description, but not its uploaded cost", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const board = screen.getByRole("region", { name: "Sub-assembly Main board" });
    const row = within(board).getByDisplayValue("CON-12P").closest("tr")!;

    expect(within(row).queryByLabelText("Base cost for CON-12P")).toBeNull();
    expect(within(row).getByText("$4.85")).toBeInTheDocument();

    fireEvent.change(within(row).getByLabelText("Quantity for CON-12P"), { target: { value: "4" } });
    fireEvent.change(within(row).getByLabelText("Description, line 4"), { target: { value: "CONNECTOR, 12-PIN, GOLD" } });
    // One more connector at $4.85, through 22% overhead.
    await waitFor(() => expect(figure("Unit cost (used)")).toBe("$823.16"));
    expect(within(board).getByDisplayValue("CONNECTOR, 12-PIN, GOLD")).toBeInTheDocument();
  });

  it("removes a component", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const board = screen.getByRole("region", { name: "Sub-assembly Main board" });
    await userEvent.click(within(board).getByRole("button", { name: "Remove CON-12P" }));
    expect(within(board).queryByDisplayValue("CON-12P")).toBeNull();
  });

  it("a re-upload keeps the components added by hand", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const board = screen.getByRole("region", { name: "Sub-assembly Main board" });
    await userEvent.click(within(board).getByRole("button", { name: /Add component/ }));
    await userEvent.type(within(board).getByLabelText("New component Altronic part number"), "HAND-01");
    await userEvent.type(within(board).getByLabelText("New component cost"), "5");
    await userEvent.click(within(board).getByRole("button", { name: "Add" }));

    const csv = "Part Number,Description,Current Cost,Qty\n701230,IC,11.60,2\n";
    await act(async () => {
      fireEvent.change(within(board).getByLabelText("Upload CSV for Main board"), {
        target: { files: [csvFile("main-board-bom.csv", csv)] },
      });
    });

    await waitFor(() => expect(within(board).queryByDisplayValue("PCB-24-BARE")).toBeNull());
    expect(within(board).getByDisplayValue("701230")).toBeInTheDocument();
    expect(within(board).getByDisplayValue("HAND-01")).toBeInTheDocument();
    expect(within(board).getByRole("status")).toHaveTextContent("1 component(s) added by hand kept");
  });
  it("Save as a new revision needs a note, and then the page is on R3", async () => {
    renderWorksheet();
    await waitForWorksheet();

    await userEvent.click(screen.getByRole("button", { name: "Save as R3" }));
    const dialog = screen.getByRole("dialog", { name: "Save as R3" });
    const save = within(dialog).getByRole("button", { name: "Save R3" });
    expect(save).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText("What changed"), "Cheaper coil set.");
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(
      () => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("NP-2026-0001 R3"),
      { timeout: 10_000 },
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Save as R4" })).toBeInTheDocument();
    expect(await screen.findByText("Cheaper coil set.")).toBeInTheDocument();
  });

  it("opens an earlier revision from the history read-only", async () => {
    renderWorksheet();
    await waitForWorksheet();

    await userEvent.click(screen.getByRole("button", { name: /^R1(?!\d)/ }));

    expect(screen.getByText(/You're viewing R1, an earlier revision, read-only\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save R2" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save as R3" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add sub-assembly/ })).toBeNull();
    expect(screen.queryByLabelText("Adjusted cost for PCB-24-BARE")).toBeNull();
    expect(screen.getByText("R1 as saved")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back to R2" }));
    expect(screen.getByRole("button", { name: "Save R2" })).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Standalone parts, both numbers on every row, files per row, and the
// worksheet's discussion and watchers (Ray, 2026-10-13).
// -----------------------------------------------------------------------------

async function waitForNumber(number: string) {
  await screen.findByRole("heading", { level: 1, name: new RegExp(number) }, { timeout: 10_000 });
}

describe("NewProductPricingDetailView — standalone parts", () => {
  it("Add part adds a Part card; a typed base cost and qty / product move the cost used", async () => {
    renderWorksheet();
    await waitForWorksheet();
    expect(figure("Unit cost (used)")).toBe("$817.24");

    await userEvent.click(screen.getByRole("button", { name: /Add part/ }));
    const part = screen.getByRole("region", { name: "Part this part" });
    // A part typed by hand: its base cost is editable and marked Manual.
    expect(within(part).getByText("Manual")).toBeInTheDocument();
    fireEvent.change(within(part).getByLabelText("Base cost for this part"), { target: { value: "10" } });
    fireEvent.change(within(part).getByLabelText("Quantity per product of this part"), { target: { value: "2" } });

    // A new row has no overhead until one is typed: 817.24 + 2 × $10.
    await waitFor(() => expect(figure("Unit cost (used)")).toBe("$837.24"));
    // Its own optional overhead: 2 × $10 × 1.22 = 24.40.
    fireEvent.change(within(part).getByLabelText("Overhead % on this part"), { target: { value: "22" } });
    await waitFor(() => expect(figure("Unit cost (used)")).toBe("$841.64"));
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
  });

  it("a part looked up in SAP takes SAP's numbers, description and cost — and the cost isn't editable", async () => {
    renderWorksheet();
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: /Add part/ }));
    const blank = screen.getByRole("region", { name: "Part this part" });
    // Looked up as it's typed — no button to press (Ray, 2026-10-22).
    await userEvent.type(within(blank).getByLabelText("Altronic part number of this row"), "593027-25");

    const part = await screen.findByRole("region", { name: "Part 593027-25" }, { timeout: 10_000 });
    await waitFor(() => expect(within(part).getByLabelText(/^SAP part number of/)).toHaveValue("2001-0310-25"));
    expect(within(part).getByLabelText("Description of 593027-25")).toHaveValue("HARNESS, CPU-95, 25 FT");
    expect(within(part).getByText("Base cost").parentElement).toHaveTextContent("$142.00");
    expect(within(part).getByText("SAP")).toBeInTheDocument();
    expect(within(part).queryByLabelText("Base cost for 593027-25")).toBeNull();
    // $142, no overhead on a new row: 817.24 + 142.
    await waitFor(() => expect(figure("Unit cost (used)")).toBe("$959.24"));
  });

  it("worksheet 2 shows its standalone hand-typed part", async () => {
    renderWorksheet(2);
    await waitForNumber("NP-2026-0002");
    const part = screen.getByRole("region", { name: "Part BRKT-KIT-SEAL" });
    expect(within(part).getByLabelText("Description of BRKT-KIT-SEAL")).toHaveValue("Mounting bracket kit");
    expect(within(part).getByLabelText("Base cost for BRKT-KIT-SEAL")).toHaveValue(24.5);
    expect(within(part).getByText("Manual")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sub-assembly Display assembly" })).toBeInTheDocument();
  });
});

describe("NewProductPricingDetailView — part numbers on sub-assemblies", () => {
  it("a sub-assembly has both an Altronic # and a SAP #, and so does each component", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const board = screen.getByRole("region", { name: "Sub-assembly Main board" });
    expect(within(board).getByLabelText("Altronic part number of Main board")).toHaveValue("791990-24");
    expect(within(board).getByLabelText("SAP part number of Main board")).toHaveValue("");

    fireEvent.change(within(board).getByLabelText("SAP part number of Main board"), { target: { value: "1003-0199-24" } });
    expect(within(board).getByLabelText("SAP part number of Main board")).toHaveValue("1003-0199-24");

    // Line 1 is the microcontroller, 701230.
    expect(within(board).getByLabelText("Altronic part number, line 1")).toHaveValue("701230");
    const sap = within(board).getByLabelText("SAP part number, line 1");
    fireEvent.change(sap, { target: { value: "5200-0230-00" } });
    expect(within(board).getByLabelText("SAP part number, line 1")).toHaveValue("5200-0230-00");
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
  });
});

describe("NewProductPricingDetailView — files per row", () => {
  it("a SAVED sub-assembly has a Files disclosure with its attachments", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const board = screen.getByRole("region", { name: "Sub-assembly Main board" });
    const summary = within(board).getByText("Files for Main board");
    await userEvent.click(summary);
    expect(await within(board).findByRole("button", { name: /Add file/ }, { timeout: 10_000 })).toBeInTheDocument();
  });

  it("a NEW sub-assembly says to save the worksheet first", async () => {
    renderWorksheet();
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: /Add sub-assembly/ }));
    const card = screen.getByRole("region", { name: "Sub-assembly (unnamed)" });
    expect(within(card).getByText(/Save the worksheet to attach files to sub-assembly\./)).toBeInTheDocument();
    expect(within(card).queryByText(/^Files for/)).toBeNull();
  });

  it("an earlier revision's files are read-only", async () => {
    renderWorksheet();
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: /^R1(?!\d)/ }));
    const board = screen.getByRole("region", { name: "Sub-assembly Main board" });
    await userEvent.click(within(board).getByText("Files for Main board"));
    expect(await within(board).findByText("No attachments.", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(within(board).queryByRole("button", { name: /Add file/ })).toBeNull();
  });
});

describe("NewProductPricingDetailView — discussion and watchers", () => {
  it("lists the worksheet's watchers", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const watchers = screen.getByText("Watchers").parentElement!;
    expect(within(watchers).getByText("Brandon Mirto")).toBeInTheDocument();
    expect(within(watchers).getByText("Ray White")).toBeInTheDocument();
  });

  it("posting a comment shows it in the discussion", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const discussion = screen.getByRole("heading", { name: "Discussion" }).closest("section")!;
    expect(within(discussion).getByText(/R2 uses the lower board quote/)).toBeInTheDocument();

    await userEvent.type(within(discussion).getByPlaceholderText(/Write a comment/), "Coil price holds at 60 a year.");
    await userEvent.click(within(discussion).getByRole("button", { name: "Send" }));

    // The page re-renders around the saved worksheet, so look the thread up afresh.
    await waitFor(
      () => {
        const thread = screen.getByRole("heading", { name: "Discussion" }).closest("section")!;
        expect(within(thread).getByText("Coil price holds at 60 a year.")).toBeInTheDocument();
      },
      { timeout: 10_000 },
    );
    expect(pricingMockDb.worksheets.find((w) => w.id === 1)?.comments.some((c) => c.bodyHtml.includes("Coil price holds"))).toBe(true);
  });
});

describe("NewProductPricingDetailView — a sub-assembly's own selling price", () => {
  it("shows the Main board's own price, priced from its own cost at the worksheet's discount", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const panel = within(screen.getByRole("region", { name: "Main board — own selling price" }));
    expect(panel.getByRole("spinbutton", { name: "Target base GM for Main board" })).toHaveValue(45);
    expect(panel.getByText("The worksheet's (36%).")).toBeInTheDocument();
    const figures = within(panel.getByLabelText("Main board — own price"));
    expect(figures.getByText("List price").nextElementSibling?.textContent).toMatch(/^\$[\d,]+\.00$/);
    expect(panel.getByRole("spinbutton", { name: "Main board break 1 quantity" })).toHaveValue(10);
  });

  it("Sell separately adds a price — Save waits for one, then writes it to the row", async () => {
    renderWorksheet();
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: "Sell Output coil set separately" }));
    const save = screen.getByRole("button", { name: "Save R2" });
    expect(save).toBeDisabled();
    expect(screen.getByText("Output coil set's own price: Enter a target GM.")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("spinbutton", { name: "Target base GM for Output coil set" }), "40");
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() =>
      expect(pricingMockDb.subAssemblies.find((s) => s.worksheetId === 1 && s.rev === 2 && s.name === "Output coil set")?.pricing).toEqual({
        input: { kind: "gm", value: 40 },
        distributorDiscountPct: null,
        priceBreaks: [],
      }),
    );
  });

  it("Stop selling separately takes the price off", async () => {
    renderWorksheet();
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: "Stop selling separately" }));
    expect(screen.queryByRole("region", { name: "Main board — own selling price" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sell Main board separately" })).toBeInTheDocument();
  });

  it("an earlier revision's rows show no Sell separately button", async () => {
    renderWorksheet();
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: /^R1(?!d)/ }));
    await waitFor(() => expect(screen.getByText(/You're viewing R1/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /separately/ })).toBeNull();
  });
});

describe("NewProductPricingDetailView — SAP comparison", () => {
  const card = () => within(screen.getByTestId("sap-comparison"));

  it("shows the worksheet's reference parts with list, cost and base GM from SAP", async () => {
    renderWorksheet();
    await waitForWorksheet();
    await waitFor(() => expect(card().getByText("1003-0114-16")).toBeInTheDocument());
    await waitFor(() => expect(card().getAllByText(/^\d+\.\d%$/).length).toBe(3));
    expect(card().getByText(/^Average base GM/)).toBeInTheDocument();
  });

  it("adds pasted part numbers, kept on the worksheet — and says so for one SAP doesn't have", async () => {
    renderWorksheet();
    await waitForWorksheet();
    await userEvent.type(card().getByLabelText("SAP part numbers to compare"), "2001-0310-15, 9999-0000-00");
    await userEvent.click(card().getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(pricingMockDb.worksheets.find((w) => w.id === 1)?.comparisonParts).toEqual([
        "1003-0114-16",
        "1003-0114-18",
        "1003-0114-20",
        "2001-0310-15",
        "9999-0000-00",
      ]),
    );
    expect(await card().findByText("Not in SAP — check the number.")).toBeInTheDocument();
  });

  it("removes a part from the list", async () => {
    renderWorksheet();
    await waitForWorksheet();
    await userEvent.click(await card().findByRole("button", { name: "Remove 1003-0114-18" }));
    await waitFor(() => expect(pricingMockDb.worksheets.find((w) => w.id === 1)?.comparisonParts).toEqual(["1003-0114-16", "1003-0114-20"]));
  });
});

describe("NewProductPricingDetailView — customer price and Compare to SAP", () => {
  it("works the list price back from a typed customer price", async () => {
    renderWorksheet();
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("radio", { name: "Customer price" }));
    const box = screen.getByRole("spinbutton", { name: /^Customer price/ });
    await userEvent.type(box, "1280");
    // NP-2026-0001's distributor discount is 36%: 1280 / 0.64 = 2000.
    const figures = within(screen.getByLabelText("Cost and price"));
    await waitFor(() => expect(figures.getByText("List price").nextElementSibling?.textContent).toBe("$2,000.00"));
    expect(figures.getByText("Customer price").nextElementSibling?.textContent).toBe("$1,280.00");
  });

  it("compares by the SAP part number typed, remembered on the worksheet", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const box = screen.getByLabelText("SAP part number", { selector: "input[placeholder='SAP part #']" });
    await userEvent.clear(box);
    await userEvent.type(box, "1003-0114-16");
    await userEvent.click(screen.getByRole("button", { name: /Remember|Change/ }));
    await waitFor(() => expect(pricingMockDb.worksheets.find((w) => w.id === 1)?.sapPartNumber).toBe("1003-0114-16"));
    expect(await screen.findByRole("table", { name: "Intended versus SAP" })).toBeInTheDocument();
  });
});

describe("NewProductPricingDetailView — choosing what goes in, and adding several (2026-10-22)", () => {
  function emptyWorksheet() {
    pricingMockDb.subAssemblies = pricingMockDb.subAssemblies.filter((r) => r.worksheetId !== 1);
  }

  it("a worksheet with nothing in it asks what goes in — no empty sub-assembly or part section", async () => {
    emptyWorksheet();
    renderWorksheet();
    await waitForWorksheet();
    expect(screen.getByRole("region", { name: "What goes into this product" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sub-assemblies" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Parts" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Add a sub-assembly" }));
    expect(screen.getByRole("region", { name: "Sub-assemblies" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Parts" })).toBeNull();
    expect(screen.queryByRole("region", { name: "What goes into this product" })).toBeNull();
  });

  it("Add parts pastes several numbers, each a part looked up in SAP — one not found is kept to fill in", async () => {
    emptyWorksheet();
    renderWorksheet();
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: "Add parts" }));
    const box = screen.getByLabelText("Part numbers to add as parts");
    await userEvent.type(box, "2001-0310-25, 593027-15 NOPE-1{Enter}");

    const found = await screen.findByRole("region", { name: "Part 593027-25" }, { timeout: 10_000 });
    expect(within(found).getByLabelText("Description of 593027-25")).toHaveValue("HARNESS, CPU-95, 25 FT");
    expect(within(found).getByText("Base cost").parentElement).toHaveTextContent("$142.00");
    expect(screen.getByRole("region", { name: "Part 593027-15" })).toBeInTheDocument();
    const missing = screen.getByRole("region", { name: "Part NOPE-1" });
    expect(within(missing).getByLabelText("Base cost for NOPE-1")).toHaveValue(null);
    expect(screen.getByText(/Added 3 parts\. 1 not found in SAP/)).toBeInTheDocument();

    // Pasting one already there adds nothing.
    await userEvent.type(screen.getByLabelText("Part numbers to add as parts"), "593027-25{Enter}");
    expect(await screen.findByText(/Nothing new to add\. 1 already here\./)).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: /^Part / })).toHaveLength(3);
  });

  it("Add several on a sub-assembly adds components from SAP and skips one already on it", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const board = screen.getByRole("region", { name: "Sub-assembly Main board" });
    const before = within(board).getAllByRole("row").length;
    await userEvent.click(within(board).getByRole("button", { name: /Add several/ }));
    await userEvent.type(within(board).getByLabelText("Component part numbers to add to Main board"), "2001-0310-40 PCB-24-BARE{Enter}");

    expect(await within(board).findByText(/Added 1 component\. 1 already here\./, undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(within(board).getAllByRole("row")).toHaveLength(before + 1);
    const row = within(board).getByDisplayValue("593027-40").closest("tr")!;
    expect(within(row).getByDisplayValue("2001-0310-40")).toBeInTheDocument();
    expect(within(row).getByDisplayValue("HARNESS, CPU-95, 40 FT")).toBeInTheDocument();
    expect(within(row).getAllByText("$170.00")).toHaveLength(2); // base and extended, qty 1
    expect(within(row).getByText("SAP")).toBeInTheDocument();
  });

  it("Add component looks the SAP # up as it's typed and fills the Altronic #, description and cost", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const board = screen.getByRole("region", { name: "Sub-assembly Main board" });
    await userEvent.click(within(board).getByRole("button", { name: /Add component/ }));
    await userEvent.type(within(board).getByLabelText("New component SAP part number"), "2001-0322-10");
    await waitFor(() => expect(within(board).getByLabelText("New component Altronic part number")).toHaveValue("593050-10"), {
      timeout: 10_000,
    });
    expect(within(board).getByLabelText("New component description")).toHaveValue("HARNESS, DE-3000 I/O, 10 FT");
    expect(within(board).getByLabelText("New component cost")).toHaveValue(98);
  });

  it("a sub-assembly or part folds to one line and opens again as it was", async () => {
    renderWorksheet();
    await waitForWorksheet();
    const board = screen.getByRole("region", { name: "Sub-assembly Main board" });
    await userEvent.click(within(board).getByRole("button", { name: "Collapse Main board" }));
    expect(within(board).queryByRole("table")).toBeNull();
    expect(within(board).getByText("4 components · ×1")).toBeInTheDocument();
    await userEvent.click(within(board).getByRole("button", { name: "Expand Main board" }));
    expect(within(board).getByLabelText("Adjusted cost for PCB-24-BARE")).toHaveValue(185);
  });
});
