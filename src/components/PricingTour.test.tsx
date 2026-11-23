import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { PricingTour } from "./PricingTour";

// The Pricing tour (Ray, 2026-11-23) — a guided walk through requesting and
// pricing, on demo screens. Its emails are built by the REAL builders, so the
// subjects asserted here are the workflow's own wording.

function open() {
  const onClose = vi.fn();
  renderWithProviders(<PricingTour onClose={onClose} />);
  return { dialog: screen.getByRole("dialog", { name: "Pricing tour" }), onClose };
}

describe("PricingTour", () => {
  it("opens on the requester's track and walks forward and back", async () => {
    const { dialog } = open();
    expect(within(dialog).getByRole("tab", { name: "Requesting a price" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByRole("heading", { name: "Welcome to Pricing" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Back/ })).toBeDisabled();

    await userEvent.click(within(dialog).getByRole("button", { name: /Next/ }));
    expect(within(dialog).getByRole("heading", { name: "1. Press New request" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /Back/ }));
    expect(within(dialog).getByRole("heading", { name: "Welcome to Pricing" })).toBeInTheDocument();
  });

  it("shows the real submit emails — the receipt and the managers' — on the Submit step", async () => {
    const { dialog } = open();
    await userEvent.click(within(dialog).getByRole("button", { name: /step 5: 4\. Submit/ }));
    expect(within(dialog).getByLabelText("Email: Pricing request received: PR-2026-0042 — 799999-08")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email: New pricing request: PR-2026-0042 — 799999-08")).toBeInTheDocument();
    expect(within(dialog).getByText(/Your pricing request was received and sent to the pricing managers/)).toBeInTheDocument();
  });

  it("says only the customer NAME is required", async () => {
    const { dialog } = open();
    await userEvent.click(within(dialog).getByRole("button", { name: /step 4: 3\. Who it's for/ }));
    expect(within(dialog).getByText(/Leave the sold-to number blank/)).toBeInTheDocument();
  });

  it("leads from the last requester step into the pricing side, which ends in Finish", async () => {
    const { dialog, onClose } = open();
    const dots = within(dialog).getAllByRole("button", { name: /^Go to step/ });
    await userEvent.click(dots[dots.length - 1]);
    await userEvent.click(within(dialog).getByRole("button", { name: /See the pricing side/ }));
    expect(within(dialog).getByRole("tab", { name: "Pricing a request" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByRole("heading", { name: "The pricing side" })).toBeInTheDocument();

    const priceDots = within(dialog).getAllByRole("button", { name: /^Go to step/ });
    await userEvent.click(priceDots[priceDots.length - 1]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Finish" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("lists every email in one place, priced emails included", async () => {
    const { dialog } = open();
    await userEvent.click(within(dialog).getByRole("tab", { name: "Pricing a request" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /Every email, in one place/ }));
    expect(within(dialog).getByText("Raised, part not in SAP")).toBeInTheDocument();
    expect(within(dialog).getByText("Priced / Re-priced")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email: Ready to price: PR-2026-0042 — 799999-08")).toBeInTheDocument();
  });

  it("closes on Escape and moves with the arrow keys", async () => {
    const { dialog, onClose } = open();
    await userEvent.keyboard("{ArrowRight}");
    expect(within(dialog).getByRole("heading", { name: "1. Press New request" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
