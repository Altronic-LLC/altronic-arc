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

describe("QuoteAssemblyFormModal", () => {
  const sensorItems = () => quoteMockDb.items.filter((i) => i.assemblyId === 5);

  it("previews each tier's price from a manual price and the breaks", async () => {
    renderWithProviders(
      <QuoteAssemblyFormModal quoteId={4} items={[]} nextLineNo={2} canSeeCost onClose={vi.fn()} />,
    );
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
      <QuoteAssemblyFormModal quoteId={4} items={[]} nextLineNo={1} canSeeCost onClose={vi.fn()} />,
    );
    const field = screen.getByLabelText(/Line #/) as HTMLInputElement;
    expect(field.value).toBe("1");
    rerender(<QuoteAssemblyFormModal quoteId={4} items={[]} nextLineNo={3} canSeeCost onClose={vi.fn()} />);
    expect(field.value).toBe("3");
    await userEvent.clear(field);
    await userEvent.type(field, "7");
    rerender(<QuoteAssemblyFormModal quoteId={4} items={[]} nextLineNo={4} canSeeCost onClose={vi.fn()} />);
    expect(field.value).toBe("7");
  });

  it("prices an assembly at its ONE target GM: total component cost, computed price, tiers", async () => {
    const asm = quoteMockDb.assemblies.find((a) => a.id === 5)!;
    renderWithProviders(
      <QuoteAssemblyFormModal quoteId={3} assembly={asm} items={sensorItems()} nextLineNo={3} canSeeCost onClose={vi.fn()} />,
    );
    const preview = screen.getByText("Preview").parentElement!;
    // 38.40 + 17.90 × 1.05 = 57.195 → $57.20 shown; at 40% → 95.33; 25+ tier at 8% off → 87.70.
    expect(within(preview).getByText("Total component cost")).toBeInTheDocument();
    expect(within(preview).getByText("$57.20")).toBeInTheDocument();
    expect(within(preview).getByText("Computed price at 40.0%")).toBeInTheDocument();
    expect(within(preview).getAllByText("$95.33").length).toBeGreaterThan(0);
    expect(within(preview).getByText("$87.70")).toBeInTheDocument();

    const gm = screen.getByLabelText(/Target gross margin %/);
    await userEvent.clear(gm);
    await userEvent.type(gm, "50");
    expect(within(preview).getAllByText("$114.39").length).toBeGreaterThan(0); // 57.195 / 0.5
  });

  it("shows the computed price beside a manual override", async () => {
    const asm = quoteMockDb.assemblies.find((a) => a.id === 5)!;
    renderWithProviders(
      <QuoteAssemblyFormModal quoteId={3} assembly={asm} items={sensorItems()} nextLineNo={3} canSeeCost onClose={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText(/Manual price/), "90");
    const preview = screen.getByText("Preview").parentElement!;
    expect(within(preview).getByText("$95.33")).toBeInTheDocument(); // computed
    expect(within(preview).getByText("Quoted (manual price)")).toBeInTheDocument();
    expect(within(preview).getAllByText("$90.00").length).toBeGreaterThan(0);
  });

  it("requires a target GM unless a manual price is set", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <QuoteAssemblyFormModal quoteId={4} items={[]} nextLineNo={2} canSeeCost onClose={onClose} />,
    );
    await userEvent.type(screen.getByLabelText(/Altronic part #/), "NEW-1");
    await userEvent.click(screen.getByRole("button", { name: "Add final assembly" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a target gross margin, or a manual price.");
    await userEvent.type(screen.getByLabelText(/Target gross margin %/), "100");
    await userEvent.click(screen.getByRole("button", { name: "Add final assembly" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Target gross margin must be between 0 and 100.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses a break at quantity 1, naming why", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <QuoteAssemblyFormModal quoteId={4} items={[]} nextLineNo={2} canSeeCost onClose={onClose} />,
    );
    await userEvent.type(screen.getByLabelText(/Altronic part #/), "NEW-1");
    await userEvent.type(screen.getByLabelText(/Target gross margin %/), "35");
    await userEvent.click(screen.getByRole("button", { name: /Add a break/ }));
    await userEvent.type(screen.getByLabelText("Break 1 quantity"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Add final assembly" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/2 or more/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("adds a final assembly with its target GM and a DASHED SAP #", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <QuoteAssemblyFormModal quoteId={4} items={[]} nextLineNo={2} canSeeCost onClose={onClose} />,
    );
    await userEvent.type(screen.getByLabelText(/Altronic part #/), "NEW-1");
    const sap = screen.getByLabelText(/SAP #/);
    expect(sap).toHaveAttribute("placeholder", "####-####-##");
    await userEvent.type(sap, "1003011440");
    expect(sap).toHaveValue("1003-0114-40");
    await userEvent.type(screen.getByLabelText(/^Description/), "A new thing");
    await userEvent.type(screen.getByLabelText(/Target gross margin %/), "35");
    await userEvent.click(screen.getByRole("button", { name: "Add final assembly" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const created = quoteMockDb.assemblies.find((a) => a.altronicPartNumber === "NEW-1");
    expect(created).toMatchObject({
      quoteId: 4,
      lineNo: 2,
      lineType: "Assembly",
      cost: null,
      sapPartNumber: "1003-0114-40",
      description: "A new thing",
      targetGM: 35,
      priceBreaks: [],
    });
  });

  it("refuses an incomplete SAP #", async () => {
    renderWithProviders(
      <QuoteAssemblyFormModal quoteId={4} items={[]} nextLineNo={2} canSeeCost onClose={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText(/Altronic part #/), "NEW-1");
    await userEvent.type(screen.getByLabelText(/SAP #/), "1003");
    await userEvent.type(screen.getByLabelText(/Target gross margin %/), "35");
    await userEvent.click(screen.getByRole("button", { name: "Add final assembly" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("SAP part number must be 10 digits");
  });

  it("adds a standalone PART: its own cost and overhead, previewed loaded cost → price", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <QuoteAssemblyFormModal quoteId={4} items={[]} initialLineType="Part" nextLineNo={2} canSeeCost onClose={onClose} />,
    );
    expect(screen.getByRole("dialog", { name: "Add part" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Altronic part #/), "SPARE-9");
    await userEvent.type(screen.getByLabelText(/Unit cost/), "32");
    await userEvent.type(screen.getByLabelText(/Material overhead/), "20");
    await userEvent.type(screen.getByLabelText(/Target gross margin %/), "40");
    const preview = screen.getByText("Preview").parentElement!;
    expect(within(preview).getByText("Loaded unit cost")).toBeInTheDocument();
    expect(within(preview).getByText("$38.40")).toBeInTheDocument();
    expect(within(preview).getAllByText("$64.00").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(quoteMockDb.assemblies.find((a) => a.altronicPartNumber === "SPARE-9")).toMatchObject({
      lineType: "Part",
      cost: 32,
      materialOverheadPct: 20,
      targetGM: 40,
      customerPrice: 64,
    });
  });

  it("an assembly offers no cost box of its own", () => {
    renderWithProviders(
      <QuoteAssemblyFormModal quoteId={4} items={[]} nextLineNo={2} canSeeCost onClose={vi.fn()} />,
    );
    expect(screen.queryByLabelText(/Unit cost/)).toBeNull();
  });

  it("refuses switching an assembly WITH components to a Part", async () => {
    const asm = quoteMockDb.assemblies.find((a) => a.id === 5)!;
    const onClose = vi.fn();
    renderWithProviders(
      <QuoteAssemblyFormModal quoteId={3} assembly={asm} items={sensorItems()} nextLineNo={3} canSeeCost onClose={onClose} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Part" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/2 components\. Delete them before changing it to a Part/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Quantity quoted: prefilled 1, required whole number ≥ 1, previews Subtotal at its break", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <QuoteAssemblyFormModal quoteId={4} items={[]} initialLineType="Part" nextLineNo={2} canSeeCost onClose={onClose} />,
    );
    const qty = screen.getByLabelText(/Quantity quoted/) as HTMLInputElement;
    expect(qty.value).toBe("1");
    await userEvent.type(screen.getByLabelText(/Altronic part #/), "SPARE-Q");
    await userEvent.type(screen.getByLabelText(/Unit cost/), "32");
    await userEvent.type(screen.getByLabelText(/Material overhead/), "20");
    await userEvent.type(screen.getByLabelText(/Target gross margin %/), "40");
    await userEvent.click(screen.getByRole("button", { name: /Add a break/ }));
    await userEvent.type(screen.getByLabelText("Break 1 quantity"), "10");
    await userEvent.type(screen.getByLabelText("Break 1 percent off"), "5");
    await userEvent.clear(qty);
    await userEvent.type(qty, "12");
    // $64.00 less 5% at 10+ = $60.80; × 12 = $729.60.
    expect(screen.getByTestId("line-subtotal")).toHaveTextContent("12 × $60.80 = $729.60");

    await userEvent.clear(qty);
    await userEvent.type(qty, "0");
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Quantity quoted must be a whole number, 1 or more.");
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.clear(qty);
    await userEvent.type(qty, "12");
    await userEvent.click(screen.getByRole("button", { name: "Add part" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(quoteMockDb.assemblies.find((a) => a.altronicPartNumber === "SPARE-Q")?.quotedQty).toBe(12);
  });

  it("hides every cost and margin figure without cost access", () => {
    renderWithProviders(
      <QuoteAssemblyFormModal quoteId={4} items={[]} initialLineType="Part" nextLineNo={2} canSeeCost={false} onClose={vi.fn()} />,
    );
    expect(screen.queryByText("GM %")).toBeNull();
    expect(screen.queryByLabelText(/Target gross margin/)).toBeNull();
    expect(screen.queryByLabelText(/Unit cost/)).toBeNull();
    expect(screen.queryByText("Loaded unit cost")).toBeNull();
  });
});
