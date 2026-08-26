import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CustomerNotesView } from "./CustomerNotesView";

async function renderList(search = "") {
  const result = renderWithProviders(<CustomerNotesView />, {
    route: `/sales/customers${search}`,
    routePattern: "/sales/customers",
  });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return result;
}

function filterTrigger(label: string): HTMLElement {
  const bar = screen.getByRole("search", { name: /customer filters/i });
  const field = within(bar).getByText(label).closest("label") as HTMLElement;
  return field.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
}

describe("CustomerNotesView", () => {
  it("lists customers alphabetically", async () => {
    await renderList();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("7 Compression")).toBeInTheDocument();
  });

  it("searches by name and SAP number", async () => {
    await renderList();
    await userEvent.type(screen.getByPlaceholderText(/customer name, sap number/i), "105224");
    await waitFor(() => expect(screen.queryByText("7 Compression")).not.toBeInTheDocument());
    expect(screen.getByText("Caterpillar (NI) Limited")).toBeInTheDocument();
  });

  it("filters by Group", async () => {
    await renderList();
    await userEvent.click(filterTrigger("Group"));
    await userEvent.click(await screen.findByRole("option", { name: "CAT" }));
    await waitFor(() => expect(screen.queryByText("7 Compression")).not.toBeInTheDocument());
    expect(screen.getByText("Caterpillar (NI) Limited")).toBeInTheDocument();
  });

  it("keeps the group filter in the URL so a view can be shared", async () => {
    await renderList("?group=Arrow");
    expect(screen.getByText("Arrow Engine Company")).toBeInTheDocument();
    expect(screen.queryByText("7 Compression")).not.toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    await renderList();
    await userEvent.type(screen.getByPlaceholderText(/customer name, sap number/i), "zzzznothing");
    await waitFor(() =>
      expect(screen.getByText(/no customers match these filters/i)).toBeInTheDocument(),
    );
  });

  it("opens the new-customer form", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /new customer/i }));
    expect(await screen.findByRole("dialog", { name: /new customer/i })).toBeInTheDocument();
  });
});
