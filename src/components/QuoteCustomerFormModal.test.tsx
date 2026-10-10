import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

import { QuoteCustomerFormModal } from "./QuoteCustomerFormModal";

beforeEach(() => {
  __resetQuoteMockStores();
});

function codeBox() {
  return screen.getByLabelText("Customer code") as HTMLInputElement;
}

async function renderCreate(onClose = vi.fn()) {
  renderWithProviders(<QuoteCustomerFormModal customer={null} onClose={onClose} />);
  // The clash check needs the loaded list.
  await waitFor(() => expect(quoteMockDb.customers.length).toBeGreaterThan(0));
  return onClose;
}

describe("QuoteCustomerFormModal — the code", () => {
  it("is proposed from the name as it is typed", async () => {
    const user = userEvent.setup();
    await renderCreate();
    await user.type(screen.getByLabelText("Customer name"), "Acme Compression");
    expect(codeBox().value).toBe("ACM");
  });

  it("stops following the name once the code is edited by hand", async () => {
    const user = userEvent.setup();
    await renderCreate();
    const name = screen.getByLabelText("Customer name");
    await user.type(name, "Acme");
    await user.clear(codeBox());
    await user.type(codeBox(), "xyz");
    expect(codeBox().value).toBe("XYZ");
    await user.type(name, " Compression");
    expect(codeBox().value).toBe("XYZ");
  });

  it("shows a clash and offers alternatives as one-click chips", async () => {
    const user = userEvent.setup();
    await renderCreate();
    // "Cooper …" proposes COO, which the seed customer already holds.
    await user.type(screen.getByLabelText("Customer name"), "Cooper Energy");
    await screen.findByText(/is already used by\s+another customer/);
    const chip = screen.getAllByRole("button", { name: /^Use code / })[0];
    const offered = chip.getAttribute("aria-label")!.replace("Use code ", "");
    expect(offered).not.toBe("COO");
    await user.click(chip);
    expect(codeBox().value).toBe(offered);
    expect(screen.queryByText(/is already used by\s+another customer/)).not.toBeInTheDocument();
  });

  it("warns about a similar existing name — a warning, not a block", async () => {
    const user = userEvent.setup();
    const onClose = await renderCreate();
    await user.type(screen.getByLabelText("Customer name"), "INNIO Waukesha Inc.");
    expect(await screen.findByText(/INNIO Waukesha \(INN\)/)).toBeInTheDocument();
    // The proposed INN clashes; take an alternative and save anyway.
    await user.click(screen.getAllByRole("button", { name: /^Use code / })[0]);
    await user.click(screen.getByRole("button", { name: "Add customer" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(quoteMockDb.customers.filter((c) => c.name.startsWith("INNIO")).length).toBe(2);
  });

  it("saves the code upper-cased, keeping the customer number's leading zeros", async () => {
    const user = userEvent.setup();
    const onClose = await renderCreate();
    await user.type(screen.getByLabelText("Customer name"), "Acme Compression");
    await user.type(screen.getByLabelText("Customer number (SAP sold-to)"), "0009001");
    await user.click(screen.getByRole("button", { name: "Add customer" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const row = quoteMockDb.customers.find((c) => c.name === "Acme Compression")!;
    expect(row.code).toBe("ACM");
    expect(row.customerNumber).toBe("0009001");
  });

  it("on a code taken since the list loaded, says so and re-proposes — never appends a digit itself", async () => {
    const user = userEvent.setup();
    const onClose = await renderCreate();
    await user.type(screen.getByLabelText("Customer name"), "Acme Compression");
    expect(codeBox().value).toBe("ACM");
    // Somebody else takes ACM after the form loaded its list.
    act(() => {
      quoteMockDb.customers.push({
        id: 99,
        name: "Acme Other",
        code: "ACM",
        customerNumber: "",
        active: true,
        note: "",
      });
    });
    await user.click(screen.getByRole("button", { name: "Add customer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/"ACM" is already taken/);
    expect(onClose).not.toHaveBeenCalled();
    expect(codeBox().value).toBe("ACM");
    expect(screen.getAllByRole("button", { name: /^Use code / }).length).toBeGreaterThan(0);
  });
});

describe("QuoteCustomerFormModal — editing", () => {
  it("shows the code read-only, and saves the other fields", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const customer = { ...quoteMockDb.customers.find((c) => c.code === "WAB")! };
    renderWithProviders(<QuoteCustomerFormModal customer={customer} onClose={onClose} />);
    expect(screen.queryByRole("textbox", { name: "Customer code" })).not.toBeInTheDocument();
    expect(screen.getByText("WAB")).toBeInTheDocument();
    expect(screen.getByText(/fixed once a customer is created/)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "No" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const row = quoteMockDb.customers.find((c) => c.id === customer.id)!;
    expect(row.active).toBe(false);
    expect(row.code).toBe("WAB");
  });
});
