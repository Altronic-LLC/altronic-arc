import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPricingMockStores } from "@/data/pricingMockData";
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
    const row = within(board).getByText("PCB-24-BARE").closest("tr")!;
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
    expect(within(card).getByText("NEW-001")).toBeInTheDocument();
    expect(within(card).getByText("NEW-002")).toBeInTheDocument();
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
    expect(screen.queryByText("NEW-001")).toBeNull();
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
