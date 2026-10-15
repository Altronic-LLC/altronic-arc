import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetPricingMockStores } from "@/data/pricingMockData";
import { PriceCalculatorButton, __resetPriceCalculatorSession } from "./PriceCalculator";

// =============================================================================
// The header's quick price calculator (Ray, 2026-10-15). Mock mode: the
// Pricing Roles list decides who gets the button — every role does
// (katie.fleming is a requester), somebody with none doesn't.
// =============================================================================

const who = vi.hoisted(() => ({ email: "katie.fleming@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

beforeEach(() => {
  __resetPricingMockStores();
  __resetPriceCalculatorSession();
  who.email = "katie.fleming@altronic-llc.com";
});

async function open() {
  renderWithProviders(<PriceCalculatorButton />);
  await userEvent.click(await screen.findByRole("button", { name: "Price calculator" }));
  return within(screen.getByRole("dialog", { name: "Price calculator" }));
}

describe("PriceCalculatorButton", () => {
  it("is offered to a requester — every pricing role gets it", async () => {
    renderWithProviders(<PriceCalculatorButton />);
    expect(await screen.findByRole("button", { name: "Price calculator" })).toBeInTheDocument();
  });

  it("is not offered to somebody with no pricing role", async () => {
    who.email = "someone.else@altronic-llc.com";
    renderWithProviders(<PriceCalculatorButton />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: "Price calculator" })).toBeNull();
  });
});

describe("PriceCalculatorDialog", () => {
  it("prices from COGS and the GM wanted, with prices from 10 points below to 20 above", async () => {
    const dialog = await open();
    await userEvent.type(dialog.getByLabelText("COGS"), "12");
    await userEvent.type(dialog.getByLabelText("GM wanted"), "40");

    const result = within(dialog.getByLabelText("Result"));
    expect(result.getByText("Customer price").nextElementSibling?.textContent).toBe("$20.00");
    expect(result.getByText("Profit").nextElementSibling?.textContent).toBe("$8.00");
    expect(dialog.queryByText(/list price/i)).toBeNull();

    const rows = within(dialog.getByRole("table", { name: "Prices by GM" })).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.querySelectorAll("td")[1].textContent)).toEqual([
      "$17.15",
      "$18.47",
      "$20.00",
      "$21.82",
      "$24.00",
      "$26.67",
      "$30.00",
    ]);
    expect(rows[2]).toHaveAttribute("aria-current", "true");
  });

  it("shows the GM a manual price earns", async () => {
    const dialog = await open();
    await userEvent.type(dialog.getByLabelText("COGS"), "15");
    await userEvent.click(dialog.getByRole("radio", { name: "Manual price" }));
    await userEvent.type(dialog.getByLabelText("Manual price"), "25");
    const result = within(dialog.getByLabelText("Result"));
    expect(result.getByText("GM").nextElementSibling?.textContent).toBe("40.0%");
  });

  it("says what's missing instead of a price", async () => {
    const dialog = await open();
    await userEvent.type(dialog.getByLabelText("COGS"), "12");
    expect(dialog.getByText("Enter the GM you want.")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: /Copy results/ })).toBeDisabled();
  });

  it("copies the results as text with tab-separated columns", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const dialog = await open();
    await userEvent.type(dialog.getByLabelText("Description"), "Spare coil");
    await userEvent.type(dialog.getByLabelText("COGS"), "12");
    await userEvent.type(dialog.getByLabelText("GM wanted"), "40");
    await userEvent.click(dialog.getByRole("button", { name: /Copy results/ }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("Price calculator — Spare coil");
    expect(text).toContain("Customer price: $20.00 (GM 40.0%, profit $8.00)");
    expect(text).toContain("40.0% (this price)\t$20.00\t$8.00");
    expect(await dialog.findByRole("button", { name: /Copied/ })).toBeInTheDocument();
  });

  it("keeps what was typed when it's closed and opened again", async () => {
    let dialog = await open();
    await userEvent.type(dialog.getByLabelText("COGS"), "12");
    await userEvent.click(dialog.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Price calculator" }));
    dialog = within(screen.getByRole("dialog", { name: "Price calculator" }));
    expect(dialog.getByLabelText("COGS")).toHaveValue(12);
  });

  it("brings in SAP's current cost and description for an SAP part number, plant by plant", async () => {
    const dialog = await open();
    // Dashed as typed, and Look up waits for all 10 digits.
    await userEvent.type(dialog.getByLabelText("SAP part number"), "200103101");
    expect(dialog.getByLabelText("SAP part number")).toHaveValue("2001-0310-1");
    expect(dialog.getByRole("button", { name: "Look up" })).toBeDisabled();
    expect(dialog.getByText("All 10 digits, like 1000-4869-00.")).toBeInTheDocument();
    await userEvent.type(dialog.getByLabelText("SAP part number"), "5");
    await userEvent.click(dialog.getByRole("button", { name: "Look up" }));

    // The first plant's cost comes in; the other plant is offered.
    await waitFor(() => expect(dialog.getByLabelText("COGS")).toHaveValue(120));
    expect(dialog.getByLabelText("Description")).toHaveValue("HARNESS, CPU-95, 15 FT");
    expect(dialog.getByText("From SAP — plant 4222's current cost.")).toBeInTheDocument();
    const plants = within(dialog.getByRole("radiogroup", { name: "Plant" }));
    expect(plants.getByRole("radio", { name: /4222/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(plants.getByRole("radio", { name: /4230/ }));
    expect(dialog.getByLabelText("COGS")).toHaveValue(126.5);
    expect(dialog.getByText("From SAP — plant 4230's current cost.")).toBeInTheDocument();

    // Typing over it is the user's call — the hint stops claiming SAP.
    await userEvent.clear(dialog.getByLabelText("COGS"));
    await userEvent.type(dialog.getByLabelText("COGS"), "125");
    expect(dialog.getByText("Cost of one.")).toBeInTheDocument();
  });

  it("replaces the description with SAP's on every new SAP part number", async () => {
    const dialog = await open();
    await userEvent.type(dialog.getByLabelText("Description"), "my own note");
    await userEvent.type(dialog.getByLabelText("SAP part number"), "2001031015{Enter}");
    await waitFor(() => expect(dialog.getByLabelText("Description")).toHaveValue("HARNESS, CPU-95, 15 FT"));

    await userEvent.clear(dialog.getByLabelText("SAP part number"));
    await userEvent.type(dialog.getByLabelText("SAP part number"), "2001031025{Enter}");
    await waitFor(() => expect(dialog.getByLabelText("Description")).toHaveValue("HARNESS, CPU-95, 25 FT"));
    expect(dialog.getByLabelText("COGS")).toHaveValue(142);
    expect(dialog.queryByRole("radiogroup", { name: "Plant" })).toBeNull();
  });

  it("clears SAP's description when the next part isn't in SAP — but keeps one that was typed", async () => {
    const dialog = await open();
    await userEvent.type(dialog.getByLabelText("SAP part number"), "2001031015{Enter}");
    await waitFor(() => expect(dialog.getByLabelText("Description")).toHaveValue("HARNESS, CPU-95, 15 FT"));
    await userEvent.clear(dialog.getByLabelText("SAP part number"));
    await userEvent.type(dialog.getByLabelText("SAP part number"), "9999000000{Enter}");
    expect(await dialog.findByText("SAP doesn't have 9999-0000-00.")).toBeInTheDocument();
    expect(dialog.getByLabelText("Description")).toHaveValue("");

    await userEvent.type(dialog.getByLabelText("Description"), "typed by hand");
    await userEvent.clear(dialog.getByLabelText("SAP part number"));
    await userEvent.type(dialog.getByLabelText("SAP part number"), "9999000001{Enter}");
    expect(await dialog.findByText("SAP doesn't have 9999-0000-01.")).toBeInTheDocument();
    expect(dialog.getByLabelText("Description")).toHaveValue("typed by hand");
  });

  it("says when SAP hasn't got the part, or has no cost for it — and leaves the cost alone", async () => {
    const dialog = await open();
    await userEvent.type(dialog.getByLabelText("COGS"), "50");
    await userEvent.type(dialog.getByLabelText("SAP part number"), "9999000000{Enter}");
    expect(await dialog.findByText("SAP doesn't have 9999-0000-00.")).toBeInTheDocument();
    expect(dialog.getByLabelText("COGS")).toHaveValue(50);

    await userEvent.clear(dialog.getByLabelText("SAP part number"));
    await userEvent.type(dialog.getByLabelText("SAP part number"), "1003011518{Enter}");
    expect(await dialog.findByText("SAP has no cost for 1003-0115-18 at plant 4222 — type it.")).toBeInTheDocument();
    expect(dialog.getByLabelText("COGS")).toHaveValue(50);
  });

  it("names the SAP part and its plant in the copied results", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const dialog = await open();
    await userEvent.type(dialog.getByLabelText("SAP part number"), "2001031015{Enter}");
    await waitFor(() => expect(dialog.getByLabelText("COGS")).toHaveValue(120));
    await userEvent.type(dialog.getByLabelText("GM wanted"), "50");
    await userEvent.click(dialog.getByRole("button", { name: /Copy results/ }));
    expect(writeText.mock.calls[0][0]).toContain("SAP part #: 2001-0310-15, plant 4222");
  });

  it("closes on Escape", async () => {
    await open();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Price calculator" })).toBeNull());
  });
});
