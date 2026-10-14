import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPricingMockStores } from "@/data/pricingMockData";
import type { CustomerQuoteLine, QuoteCustomerInfo } from "@/types/pricing";
import { QuoteLineModal } from "./QuoteLineModal";

// =============================================================================
// Adding a line to a customer quote, in mock mode. The customer is Power
// Solutions Supply, customer group DI — whose IGN discount is 34%. A New
// product line must start from the WORKSHEET's distributor discount (36% on
// NP-2026-0001), never the customer group's.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

const CUSTOMER: QuoteCustomerInfo = {
  soldTo: "0004410",
  name: "Power Solutions Supply",
  customerGroup: "DI",
  contactName: "",
  contactEmail: "",
};

beforeEach(() => {
  __resetPricingMockStores();
});

function renderModal() {
  const onAdd = vi.fn<(line: CustomerQuoteLine) => void>();
  const onClose = vi.fn();
  renderWithProviders(<QuoteLineModal customer={CUSTOMER} onAdd={onAdd} onClose={onClose} />);
  return { onAdd, onClose, dialog: screen.getByRole("dialog", { name: "Add a quote line" }) };
}

describe("QuoteLineModal", () => {
  it("adds ONE separately priced sub-assembly as its own line, at its own price and breaks", async () => {
    const { onAdd, dialog } = renderModal();
    const worksheet = within(dialog).getByLabelText("Worksheet");
    await waitFor(() => expect(within(worksheet).getAllByRole("option").length).toBeGreaterThan(1));
    await userEvent.selectOptions(worksheet, within(worksheet).getByRole("option", { name: /NP-2026-0001/ }));
    // NP-2026-0001 R2 prices its Main board on its own, at $779 list.
    await userEvent.selectOptions(within(dialog).getByLabelText("What to quote"), "Main board");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add line" }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      kind: "worksheet",
      partNumber: "791990-24",
      description: "Main board",
      listPrice: 779,
      customerDiscountPct: 36,
      unitPrice: 498.56,
      worksheetRev: 2,
      worksheetRow: "Main board",
    });
  });

  it("an Other line carries its customer part number (and SAP #) onto the line", async () => {
    const { onAdd, dialog } = renderModal();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Other line" }));
    await userEvent.type(within(dialog).getByLabelText("SAP part number"), "2001-0310-25");
    await userEvent.type(within(dialog).getByLabelText("Description"), "Spare harness");
    await userEvent.type(within(dialog).getByLabelText("Price each"), "50");
    await userEvent.type(within(dialog).getByLabelText("Customer part number"), "PSS-HRN-25");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add line" }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      kind: "free",
      description: "Spare harness",
      unitPrice: 50,
      sapPartNumber: "2001-0310-25",
      customerPartNumber: "PSS-HRN-25",
    });
  });

  it("a New product line defaults to the WORKSHEET's distributor discount, not the customer group's", async () => {
    const { onAdd, dialog } = renderModal();
    const select = within(dialog).getByLabelText("Worksheet");
    await within(select).findByRole("option", { name: /NP-2026-0001/ }, { timeout: 10_000 });
    await userEvent.selectOptions(select, "1");

    // NP-2026-0001's 36%, where the DI group's IGN discount would be 34%.
    await waitFor(() => expect(within(dialog).getByLabelText("Customer discount")).toHaveValue(36));
    expect(within(dialog).getByText("NP-2026-0001's distributor discount")).toBeInTheDocument();
    // $2,322 list × 0.64.
    expect(within(dialog).getByText("$1,486.08")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Add line" }));
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      kind: "worksheet",
      worksheetId: 1,
      worksheetRev: 2,
      listPrice: 2322,
      customerDiscountPct: 36,
      unitPrice: 1486.08,
    });
  });
});
