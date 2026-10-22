import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { FabricRequestError } from "@/api/fabric";

// The list's Performance and Class columns: SAP's figures, falling back to
// the score typed into ARC (marked *). Mock suppliers 25 (Arrow) and 29 (TTI)
// have SAP rows; 30 (Avnet) hasn't.

const listSap = vi.hoisted(() => vi.fn());
vi.mock("@/api/supplierPerformance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/supplierPerformance")>();
  listSap.mockImplementation(actual.listSapSupplierPerformance);
  return { ...actual, listSapSupplierPerformance: listSap };
});

import { SuppliersView } from "./SuppliersView";

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

async function renderList() {
  renderWithProviders(<SuppliersView />, { route: "/supply-chain/suppliers" });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  await waitFor(() => expect(screen.queryByTitle("Checking SAP…")).not.toBeInTheDocument());
}

function rowFor(name: RegExp) {
  return screen.getByText(name).closest("tr")!;
}

describe("SuppliersView — performance from SAP", () => {
  it("shows SAP's score and class, and ARC's score with a * where SAP has none", async () => {
    await renderList();

    const arrow = rowFor(/Arrow Electronics/);
    expect(within(arrow).getByText("91%")).toBeInTheDocument();
    expect(within(arrow).getByTitle("SAP classification A")).toBeInTheDocument();
    expect(within(arrow).queryByText("*")).not.toBeInTheDocument();

    const avnet = rowFor(/Avnet/);
    expect(within(avnet).getByText(/93%/)).toBeInTheDocument();
    expect(within(avnet).getByTitle(/Entered in ARC/)).toBeInTheDocument();
    expect(within(avnet).queryByTitle(/SAP classification/)).not.toBeInTheDocument();

    expect(screen.getByText(/Performance entered in ARC/)).toBeInTheDocument();
  });

  it("offers a sortable Class column", async () => {
    await renderList();
    expect(screen.getByRole("button", { name: "Sort by Class" })).toBeInTheDocument();
  });

  it("says once, above the table, when SAP can't be read", async () => {
    const original = listSap.getMockImplementation();
    // A refusal, not a network blip — a blip is retried, which only slows this down.
    listSap.mockRejectedValue(new FabricRequestError("refused", "http", { status: 403 }));
    restore = () => listSap.mockImplementation(original!);

    await renderList();

    expect(screen.getByText(/can't read SAP supplier performance/)).toBeInTheDocument();
    const arrow = rowFor(/Arrow Electronics/);
    expect(within(arrow).getByText(/97%/)).toBeInTheDocument();
    // No per-row * — every score is ARC's, and the line above says so.
    expect(within(arrow).queryByTitle(/Entered in ARC/)).not.toBeInTheDocument();
  });
});
