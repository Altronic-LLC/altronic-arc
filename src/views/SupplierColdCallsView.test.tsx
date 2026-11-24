import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetSupplierColdCallsMockStore, listSupplierColdCalls } from "@/api/supplierColdCalls";
import SupplierColdCallsView from "./SupplierColdCallsView";

// The Cold Call Log screen, in mock mode: anyone signed in reads, searches,
// sorts, adds, edits and removes an entry.

beforeEach(() => {
  __resetSupplierColdCallsMockStore();
});

async function renderLog(route = "/supply-chain/cold-call-log") {
  renderWithProviders(<SupplierColdCallsView />, { route });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
}

function companyOrder(): string[] {
  const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
  return rows.map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");
}

describe("SupplierColdCallsView", () => {
  it("lists every entry, company A–Z", async () => {
    await renderLog();
    expect(screen.getByRole("heading", { name: "Cold Call Log" })).toBeInTheDocument();
    expect(companyOrder()).toEqual(["Brightline Castings", "Kestrel Circuit Works", "Northgate Wire & Cable"]);
  });

  it("sorts the ROWS when a header is pressed, not just the header", async () => {
    await renderLog();
    await userEvent.click(screen.getByRole("button", { name: /Sort by Company/i }));
    expect(companyOrder()).toEqual(["Northgate Wire & Cable", "Kestrel Circuit Works", "Brightline Castings"]);
  });

  it("searches notes as well as names", async () => {
    await renderLog();
    await userEvent.type(screen.getByPlaceholderText(/Company, commodity/), "harness capacity");
    await waitFor(() => expect(companyOrder()).toEqual(["Northgate Wire & Cable"]));
  });

  it("links a bare domain as https, in a new tab", async () => {
    await renderLog();
    const link = screen.getByRole("link", { name: /brightline-castings\.example/ });
    expect(link).toHaveAttribute("href", "https://brightline-castings.example/");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("adds an entry from the form", async () => {
    await renderLog();
    await userEvent.click(screen.getByRole("button", { name: "New entry" }));
    const dialog = screen.getByRole("dialog", { name: "New cold call entry" });
    await userEvent.type(within(dialog).getByPlaceholderText("Supplier name"), "Acme Springs");
    await userEvent.type(within(dialog).getByPlaceholderText(/What they make or sell/), "Springs");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add entry" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(companyOrder()[0]).toBe("Acme Springs");
    expect((await listSupplierColdCalls()).find((c) => c.company === "Acme Springs")?.commodity).toBe("Springs");
  });

  it("refuses an entry with no company", async () => {
    await renderLog();
    await userEvent.click(screen.getByRole("button", { name: "New entry" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add entry" }));
    expect(within(dialog).getByText("Company is required.")).toBeInTheDocument();
  });

  it("opens a row to edit it, and removes it after a confirm", async () => {
    await renderLog();
    await userEvent.click(screen.getByRole("button", { name: "Kestrel Circuit Works" }));
    const dialog = screen.getByRole("dialog", { name: "Edit cold call entry" });
    const notes = within(dialog).getByPlaceholderText(/How you heard of them/);
    await userEvent.type(notes, "Quoted 4 weeks");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect((await listSupplierColdCalls()).find((c) => c.id === 3)?.notes).toBe("Quoted 4 weeks");

    const confirm = window.confirm;
    window.confirm = () => true;
    try {
      await userEvent.click(screen.getByRole("button", { name: "Kestrel Circuit Works" }));
      await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Remove/ }));
      await waitFor(() => expect(companyOrder()).not.toContain("Kestrel Circuit Works"));
    } finally {
      window.confirm = confirm;
    }
  });
});
