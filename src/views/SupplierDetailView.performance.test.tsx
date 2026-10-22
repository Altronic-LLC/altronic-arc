import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { FabricRequestError } from "@/api/fabric";

// The sidebar's Performance figures: SAP's when SAP scores the supplier,
// otherwise the ones typed into ARC (Tim, 2026-10-22). Mock suppliers 25 and
// 29 have a row in MOCK_SAP_SUPPLIER_PERFORMANCE; 30 deliberately hasn't.

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 }),
}));

const listSap = vi.hoisted(() => vi.fn());
vi.mock("@/api/supplierPerformance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/supplierPerformance")>();
  listSap.mockImplementation(actual.listSapSupplierPerformance);
  return { ...actual, listSapSupplierPerformance: listSap };
});

import { listSapSupplierPerformance } from "@/api/supplierPerformance";
import { SupplierDetailView } from "./SupplierDetailView";

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

function failSap(err: Error) {
  const original = listSap.getMockImplementation();
  listSap.mockRejectedValue(err);
  restore = () => listSap.mockImplementation(original!);
}

async function renderDetail(id: number) {
  renderWithProviders(<SupplierDetailView />, {
    route: `/supply-chain/supplier/${id}`,
    routePattern: "/supply-chain/supplier/:id",
  });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  await waitFor(() => expect(screen.queryByText("Checking SAP…")).not.toBeInTheDocument());
}

describe("SupplierDetailView — performance from SAP", () => {
  it("shows SAP's figures, its year and class, and no Edit scores", async () => {
    await renderDetail(25);
    expect(listSapSupplierPerformance).toHaveBeenCalled();
    expect(screen.getByText("Supplier: 91%")).toBeInTheDocument();
    expect(screen.getByText("Quality: 96%")).toBeInTheDocument();
    expect(screen.getByText("Logistical: 88%")).toBeInTheDocument();
    expect(screen.getByText("All deliveries: 702")).toBeInTheDocument();
    expect(screen.getByTitle("SAP classification A")).toBeInTheDocument();
    expect(screen.getByText("From SAP · 2026")).toBeInTheDocument();
    // The SharePoint figures (97 / 616) are not shown when SAP has its own.
    expect(screen.queryByText("Supplier: 97%")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit scores/i })).not.toBeInTheDocument();
  });

  it("falls back to the scores entered in ARC, editable, when SAP has no row", async () => {
    await renderDetail(30);
    expect(screen.getByText("Supplier: 93%")).toBeInTheDocument();
    expect(screen.getByText("All deliveries: 165")).toBeInTheDocument();
    expect(screen.getByText(/SAP has no figures for this supplier/)).toBeInTheDocument();
    expect(screen.queryByTitle(/SAP classification/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /edit scores/i }));
    expect(screen.getByRole("dialog", { name: /edit performance/i })).toBeInTheDocument();
  });

  it("says why when SAP can't be read, and shows ARC's figures", async () => {
    failSap(new FabricRequestError("refused", "http", { status: 403 }));
    await renderDetail(25);
    expect(screen.getByText("Supplier: 97%")).toBeInTheDocument();
    expect(screen.getByText(/can't read SAP supplier performance/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit scores/i })).toBeInTheDocument();
  });
});
