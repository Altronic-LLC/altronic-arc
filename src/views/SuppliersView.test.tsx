import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { SuppliersView } from "./SuppliersView";

async function renderList(search = "") {
  const result = renderWithProviders(<SuppliersView />, {
    route: `/supply-chain/suppliers${search}`,
    routePattern: "/supply-chain/suppliers",
  });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return result;
}

function filterTrigger(label: string): HTMLElement {
  const bar = screen.getByRole("search", { name: /supplier filters/i });
  const field = within(bar).getByText(label).closest("label") as HTMLElement;
  return field.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
}

describe("SuppliersView", () => {
  it("lists suppliers alphabetically", async () => {
    await renderList();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("103832-Arrow Electronics")).toBeInTheDocument();
  });

  it("searches by company name and BP number", async () => {
    await renderList();
    await userEvent.type(screen.getByPlaceholderText(/company name, bp number/i), "103836");
    await waitFor(() =>
      expect(screen.queryByText("103832-Arrow Electronics")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("103836-Avnet Inc")).toBeInTheDocument();
  });

  it("filters by Status", async () => {
    await renderList();
    await userEvent.click(filterTrigger("Status"));
    await userEvent.click(await screen.findByRole("option", { name: "Phase Out" }));
    await waitFor(() =>
      expect(screen.queryByText("103832-Arrow Electronics")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("103836-Avnet Inc")).toBeInTheDocument();
  });

  it("keeps the status filter in the URL so a view can be shared", async () => {
    await renderList("?status=Phase+Out");
    expect(screen.getByText("103836-Avnet Inc")).toBeInTheDocument();
    expect(screen.queryByText("103832-Arrow Electronics")).not.toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    await renderList();
    await userEvent.type(screen.getByPlaceholderText(/company name, bp number/i), "zzzznothing");
    await waitFor(() =>
      expect(screen.getByText(/no suppliers match these filters/i)).toBeInTheDocument(),
    );
  });

  it("opens the new-supplier form", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /new supplier/i }));
    expect(await screen.findByRole("dialog", { name: /new supplier/i })).toBeInTheDocument();
  });
});
