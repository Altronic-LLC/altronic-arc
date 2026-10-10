import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";
import { QuoteItemFormModal } from "./QuoteItemFormModal";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo", email: "demo.user@altronic-llc.com", lookupId: 1 }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

beforeEach(() => {
  __resetQuoteMockStores();
});

function renderForm(props: Partial<React.ComponentProps<typeof QuoteItemFormModal>> = {}) {
  const onClose = vi.fn();
  renderWithProviders(
    <QuoteItemFormModal quoteId={4} assemblyId={6} nextLineNo={4} canSeeCost onClose={onClose} {...props} />,
  );
  return { onClose };
}

describe("QuoteItemFormModal", () => {
  it("previews loaded and extended COST only — at 2 decimals", async () => {
    renderForm();
    await userEvent.clear(screen.getByLabelText(/Quantity per assembly/));
    await userEvent.type(screen.getByLabelText(/Quantity per assembly/), "3");
    await userEvent.type(screen.getByLabelText(/Unit cost/), "6.265");
    await userEvent.type(screen.getByLabelText(/Material overhead/), "10");
    // Loaded = 6.265 × 1.10 = 6.8915 → $6.89; extended = × 3 = 20.6745 → $20.67.
    expect(screen.getByText("$6.89")).toBeInTheDocument();
    expect(screen.getByText("$20.67")).toBeInTheDocument();
  });

  it("has NO target GM, sell or GM anywhere — the margin is the assembly's", () => {
    renderForm();
    expect(screen.queryByLabelText(/Target GM|gross margin/i)).toBeNull();
    expect(screen.queryByText(/Unit sell|Ext\. sell|^GM$/)).toBeNull();
    expect(screen.getByText(/margin is set once, on the final assembly/)).toBeInTheDocument();
  });

  it("refuses a cost of 0", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText(/Altronic part #/), "X-1");
    await userEvent.type(screen.getByLabelText(/Unit cost/), "0");
    await userEvent.click(screen.getByRole("button", { name: "Add component" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cost must be more than 0.");
  });

  it("formats the SAP # as it is typed, and refuses an incomplete one", async () => {
    const { onClose } = renderForm();
    await userEvent.type(screen.getByLabelText(/Altronic part #/), "X-1");
    const sap = screen.getByLabelText(/SAP #/);
    expect(sap).toHaveAttribute("placeholder", "####-####-##");
    expect(sap).toHaveAttribute("inputmode", "numeric");
    await userEvent.type(sap, "10030");
    expect(sap).toHaveValue("1003-0");
    await userEvent.click(screen.getByRole("button", { name: "Add component" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "SAP part number must be 10 digits, like 1234-5678-90",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("adds the component at the next line number, storing the DASHED SAP #", async () => {
    const { onClose } = renderForm();
    await userEvent.type(screen.getByLabelText(/Altronic part #/), "X-1");
    await userEvent.type(screen.getByLabelText(/SAP #/), "1003011440");
    await userEvent.type(screen.getByLabelText(/Unit cost/), "12.5");
    await userEvent.click(screen.getByRole("button", { name: "Add component" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const added = quoteMockDb.items.find((i) => i.altronicPartNumber === "X-1")!;
    expect(added).toMatchObject({
      quoteId: 4,
      assemblyId: 6,
      lineNo: 4,
      sapPartNumber: "1003-0114-40",
      cost: 12.5,
      materialOverheadPct: null,
    });
    expect(added).not.toHaveProperty("targetGM");
  });

  it("offers no cost inputs without cost access", () => {
    renderForm({ canSeeCost: false });
    expect(screen.queryByLabelText(/Unit cost/)).toBeNull();
    expect(screen.queryByText("Loaded unit cost")).toBeNull();
  });
});
