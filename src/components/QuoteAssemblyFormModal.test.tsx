import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";
import { QuoteAssemblyFormModal, rowsToBreaks } from "./QuoteAssemblyFormModal";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo", email: "demo.user@altronic-llc.com", lookupId: 1 }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

beforeEach(() => {
  __resetQuoteMockStores();
});

describe("rowsToBreaks", () => {
  it("drops wholly blank rows and keeps half-filled ones so they fail validation", () => {
    expect(
      rowsToBreaks([
        { qty: "", discountPct: "", note: "" },
        { qty: "10", discountPct: "5", note: " x " },
        { qty: "", discountPct: "3", note: "" },
      ]),
    ).toEqual([
      { qty: 10, discountPct: 5, note: "x" },
      { qty: NaN, discountPct: 3, note: "" },
    ]);
  });
});

const OVERHEAD = /Overhead \(% of material\)/;

describe("QuoteAssemblyFormModal", () => {
  it("previews each tier's price from a manual price and the breaks", async () => {
    renderWithProviders(<QuoteAssemblyFormModal quoteId={4} nextLineNo={2} canSeeCost onClose={vi.fn()} />);
    expect((screen.getByLabelText(/Line #/) as HTMLInputElement).value).toBe("2");
    await userEvent.type(screen.getByLabelText(/Manual price/), "100");
    await userEvent.click(screen.getByRole("button", { name: /Add a break/ }));
    await userEvent.type(screen.getByLabelText("Break 1 quantity"), "10");
    await userEvent.type(screen.getByLabelText("Break 1 percent off"), "10");
    const preview = screen.getByText("Preview").parentElement!;
    expect(within(preview).getByText("1 – 9")).toBeInTheDocument();
    expect(within(preview).getByText("10+")).toBeInTheDocument();
    expect(within(preview).getByText("$90.00")).toBeInTheDocument();
    expect(screen.getAllByText("Manual price").length).toBeGreaterThan(0);
  });

  it("a new line's number follows the lines as they load, until the user types one", async () => {
    // Opened before the quote's lines loaded → nextLineNo 1; then they arrive → 3.
    // A one-shot initialiser froze "1" and produced two "Line 1"s (found driving
    // the app, 2026-10-09).
    const { rerender } = renderWithProviders(
      <QuoteAssemblyFormModal quoteId={4} nextLineNo={1} canSeeCost onClose={vi.fn()} />,
    );
    const field = screen.getByLabelText(/Line #/) as HTMLInputElement;
    expect(field.value).toBe("1");
    rerender(<QuoteAssemblyFormModal quoteId={4} nextLineNo={3} canSeeCost onClose={vi.fn()} />);
    expect(field.value).toBe("3");
    await userEvent.clear(field);
    await userEvent.type(field, "7");
    rerender(<QuoteAssemblyFormModal quoteId={4} nextLineNo={4} canSeeCost onClose={vi.fn()} />);
    expect(field.value).toBe("7");
  });

  it("a NEW line starts at the standard 18% overhead", () => {
    renderWithProviders(<QuoteAssemblyFormModal quoteId={4} nextLineNo={2} canSeeCost onClose={vi.fn()} />);
    expect(screen.getByLabelText(OVERHEAD)).toHaveValue(18);
  });

  it("an edit shows the overhead that is STORED, not the default", () => {
    const asm = quoteMockDb.assemblies.find((a) => a.id === 7)!; // stored at 10%
    renderWithProviders(<QuoteAssemblyFormModal quoteId={3} assembly={asm} nextLineNo={3} canSeeCost onClose={vi.fn()} />);
    expect(screen.getByLabelText(OVERHEAD)).toHaveValue(10);
  });

  it("prices a line from material + overhead + labor at its ONE target GM", async () => {
    const asm = quoteMockDb.assemblies.find((a) => a.id === 5)!;
    renderWithProviders(<QuoteAssemblyFormModal quoteId={3} assembly={asm} nextLineNo={3} canSeeCost onClose={vi.fn()} />);
    const preview = screen.getByText("Preview").parentElement!;
    // 41 + 7.38 overhead + 9.50 labor = 57.88; at 40% → 96.47; 25+ tier at 8% off → 88.75.
    expect(within(preview).getByText("$41.00")).toBeInTheDocument();
    expect(within(preview).getByText("$7.38")).toBeInTheDocument();
    expect(within(preview).getByText("$9.50")).toBeInTheDocument();
    expect(within(preview).getByText("$57.88")).toBeInTheDocument();
    expect(within(preview).getByText("Computed price at 40.0%")).toBeInTheDocument();
    expect(within(preview).getAllByText("$96.47").length).toBeGreaterThan(0);
    expect(within(preview).getByText("$88.75")).toBeInTheDocument();

    const gm = screen.getByLabelText(/Target gross margin %/);
    await userEvent.clear(gm);
    await userEvent.type(gm, "50");
    expect(within(preview).getAllByText("$115.76").length).toBeGreaterThan(0); // 57.88 / 0.5

    // Labor carries no overhead: +10 labor is +10 cost, not +11.80.
    const labor = screen.getByLabelText(/Labor/);
    await userEvent.clear(labor);
    await userEvent.type(labor, "19.5");
    expect(within(preview).getByText("$67.88")).toBeInTheDocument();
  });

  it("shows the computed price beside a manual override", async () => {
    const asm = quoteMockDb.assemblies.find((a) => a.id === 5)!;
    renderWithProviders(<QuoteAssemblyFormModal quoteId={3} assembly={asm} nextLineNo={3} canSeeCost onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/Manual price/), "90");
    const preview = screen.getByText("Preview").parentElement!;
    expect(within(preview).getByText("$96.47")).toBeInTheDocument(); // computed
    expect(within(preview).getByText("Quoted (manual price)")).toBeInTheDocument();
    expect(within(preview).getAllByText("$90.00").length).toBeGreaterThan(0);
  });

  it("requires a target GM unless a manual price is set", async () => {
    const onClose = vi.fn();
    renderWithProviders(<QuoteAssemblyFormModal quoteId={4} nextLineNo={2} canSeeCost onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/Part Number/), "NEW-1");
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a target gross margin, or a manual price.");
    await userEvent.type(screen.getByLabelText(/Target gross margin %/), "100");
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Target gross margin must be between 0 and 100.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses a negative cost", async () => {
    const onClose = vi.fn();
    renderWithProviders(<QuoteAssemblyFormModal quoteId={4} nextLineNo={2} canSeeCost onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/Part Number/), "NEW-1");
    await userEvent.type(screen.getByLabelText(/Labor/), "-3");
    await userEvent.type(screen.getByLabelText(/Target gross margin %/), "35");
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The labor cost can't be negative.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses a break at quantity 1, naming why", async () => {
    const onClose = vi.fn();
    renderWithProviders(<QuoteAssemblyFormModal quoteId={4} nextLineNo={2} canSeeCost onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/Part Number/), "NEW-1");
    await userEvent.type(screen.getByLabelText(/Target gross margin %/), "35");
    await userEvent.click(screen.getByRole("button", { name: /Add a break/ }));
    await userEvent.type(screen.getByLabelText("Break 1 quantity"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/2 or more/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("adds a line with its costs, target GM, stored price and a DASHED SAP #", async () => {
    const onClose = vi.fn();
    renderWithProviders(<QuoteAssemblyFormModal quoteId={4} nextLineNo={2} canSeeCost onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/Part Number/), "NEW-1");
    const sap = screen.getByLabelText(/SAP #/);
    expect(sap).toHaveAttribute("placeholder", "####-####-##");
    await userEvent.type(sap, "1003011440");
    expect(sap).toHaveValue("1003-0114-40");
    await userEvent.type(screen.getByLabelText(/^Description/), "A new thing");
    await userEvent.type(screen.getByLabelText(/Material/), "100");
    await userEvent.type(screen.getByLabelText(/Labor/), "20");
    await userEvent.type(screen.getByLabelText(/Target gross margin %/), "35");
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const created = quoteMockDb.assemblies.find((a) => a.altronicPartNumber === "NEW-1");
    expect(created).toMatchObject({
      quoteId: 4,
      lineNo: 2,
      materialCost: 100,
      laborCost: 20,
      materialOverheadPct: 18,
      sapPartNumber: "1003-0114-40",
      description: "A new thing",
      targetGM: 35,
      priceBreaks: [],
    });
    // 100 × 1.18 + 20 = 138 at 35% → 212.31.
    await waitFor(() =>
      expect(quoteMockDb.assemblies.find((a) => a.altronicPartNumber === "NEW-1")?.customerPrice).toBe(212.31),
    );
  });

  it("refuses an incomplete SAP #", async () => {
    renderWithProviders(<QuoteAssemblyFormModal quoteId={4} nextLineNo={2} canSeeCost onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/Part Number/), "NEW-1");
    await userEvent.type(screen.getByLabelText(/SAP #/), "1003");
    await userEvent.type(screen.getByLabelText(/Target gross margin %/), "35");
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("SAP part number must be 10 digits");
  });

  it("an edit saves the changed cost", async () => {
    const asm = quoteMockDb.assemblies.find((a) => a.id === 5)!;
    const onClose = vi.fn();
    renderWithProviders(<QuoteAssemblyFormModal quoteId={3} assembly={asm} nextLineNo={3} canSeeCost onClose={onClose} />);
    const labor = screen.getByLabelText(/Labor/);
    await userEvent.clear(labor);
    await userEvent.type(labor, "12");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(quoteMockDb.assemblies.find((a) => a.id === 5)).toMatchObject({ materialCost: 41, laborCost: 12 });
  });

  it("Quantity quoted: prefilled 1, required whole number ≥ 1, previews Subtotal at its break", async () => {
    const onClose = vi.fn();
    renderWithProviders(<QuoteAssemblyFormModal quoteId={4} nextLineNo={2} canSeeCost onClose={onClose} />);
    const qty = screen.getByLabelText(/Quantity quoted/) as HTMLInputElement;
    expect(qty.value).toBe("1");
    await userEvent.type(screen.getByLabelText(/Part Number/), "SPARE-Q");
    await userEvent.type(screen.getByLabelText(/Material/), "32");
    const overhead = screen.getByLabelText(OVERHEAD);
    await userEvent.clear(overhead);
    await userEvent.type(overhead, "20");
    await userEvent.type(screen.getByLabelText(/Target gross margin %/), "40");
    await userEvent.click(screen.getByRole("button", { name: /Add a break/ }));
    await userEvent.type(screen.getByLabelText("Break 1 quantity"), "10");
    await userEvent.type(screen.getByLabelText("Break 1 percent off"), "5");
    await userEvent.clear(qty);
    await userEvent.type(qty, "12");
    // $38.40 at 40% = $64.00, less 5% at 10+ = $60.80; × 12 = $729.60.
    expect(screen.getByTestId("line-subtotal")).toHaveTextContent("12 × $60.80 = $729.60");

    await userEvent.clear(qty);
    await userEvent.type(qty, "0");
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Quantity quoted must be a whole number, 1 or more.");
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.clear(qty);
    await userEvent.type(qty, "12");
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(quoteMockDb.assemblies.find((a) => a.altronicPartNumber === "SPARE-Q")?.quotedQty).toBe(12);
  });

  it("hides every cost and margin figure without cost access", () => {
    renderWithProviders(<QuoteAssemblyFormModal quoteId={4} nextLineNo={2} canSeeCost={false} onClose={vi.fn()} />);
    expect(screen.queryByText("GM %")).toBeNull();
    expect(screen.queryByLabelText(/Target gross margin/)).toBeNull();
    expect(screen.queryByLabelText(/Material/)).toBeNull();
    expect(screen.queryByLabelText(/Labor/)).toBeNull();
    expect(screen.queryByTestId("line-cost-inputs")).toBeNull();
    expect(screen.queryByText("Total cost")).toBeNull();
  });
});
