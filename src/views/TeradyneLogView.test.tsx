import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { TeradyneLogView } from "./TeradyneLogView";

// USE_MOCK is true under Vitest, so the view renders against the mock log.

beforeEach(() => {
  vi.restoreAllMocks();
});

async function renderView(route = "/operations/teradyne") {
  const result = renderWithProviders(<TeradyneLogView />, { route });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return result;
}

describe("TeradyneLogView", () => {
  it("lists log entries with their resolved product and remark names", async () => {
    await renderView();
    expect(screen.getByRole("heading", { name: /teradyne log/i })).toBeInTheDocument();
    expect(screen.getByText("Moris Power Supply")).toBeInTheDocument();
    expect(screen.getByText("Component out of tolerance")).toBeInTheDocument();
  });

  it("shows the employee's clock number alongside their name", async () => {
    await renderView();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Melissa Fuentes")).toBeInTheDocument();
    expect(within(table).getByText("#88")).toBeInTheDocument();
  });

  it("shows how many entries are displayed and their board totals", async () => {
    await renderView();
    expect(screen.getByText(/showing 5 of 5 entries/i)).toBeInTheDocument();
    expect(screen.getByText(/defective boards/i)).toBeInTheDocument();
  });

  it("narrows the table with the search box, and says so when nothing matches", async () => {
    await renderView();
    const search = screen.getByPlaceholderText(/search anything/i);

    await userEvent.type(search, "Moris");
    await waitFor(() => expect(screen.getByText(/showing 1 of 5 entries/i)).toBeInTheDocument());

    await userEvent.clear(search);
    await userEvent.type(search, "zzzznotathing");
    await waitFor(() =>
      expect(screen.getByText(/no entries match the current filters/i)).toBeInTheDocument(),
    );
  });

  it("reads its filters from the URL so a filtered view is shareable", async () => {
    await renderView("/operations/teradyne?q=TEM");
    expect(screen.getByText(/showing 1 of 5 entries/i)).toBeInTheDocument();
    expect(screen.getByText("TEM Power Board")).toBeInTheDocument();
  });

  it("filters to one product via the product param", async () => {
    await renderView("/operations/teradyne?product=201");
    expect(screen.getByText(/showing 1 of 5 entries/i)).toBeInTheDocument();
  });

  it("opens the new-entry form from the toolbar", async () => {
    await renderView();
    await userEvent.click(screen.getByRole("button", { name: /new/i }));
    expect(await screen.findByText(/new log entry/i)).toBeInTheDocument();
    // The derived-name preview is what tells the user why Product matters.
    expect(screen.getByText(/built automatically/i)).toBeInTheDocument();
  });

  it("opens the edit form pre-filled from the row's pencil", async () => {
    await renderView();
    await userEvent.click(screen.getByRole("button", { name: /^edit moris power supply - u1$/i }));
    expect(await screen.findByText(/edit log entry/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("U1")).toBeInTheDocument();
  });

  it("offers the three reference lists behind 'Manage lists'", async () => {
    await renderView();
    await userEvent.click(screen.getByRole("button", { name: /manage lists/i }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Employees" })).toHaveAttribute(
      "href",
      "/operations/teradyne/employees",
    );
    expect(within(menu).getByRole("menuitem", { name: "Products" })).toHaveAttribute(
      "href",
      "/operations/teradyne/products",
    );
    expect(within(menu).getByRole("menuitem", { name: "Remarks" })).toHaveAttribute(
      "href",
      "/operations/teradyne/remarks",
    );
  });

  it("closes the Manage lists menu on Escape", async () => {
    await renderView();
    await userEvent.click(screen.getByRole("button", { name: /manage lists/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("asks for confirmation before deleting, and does nothing if declined", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderView();
    await userEvent.click(screen.getByRole("button", { name: /^delete moris power supply - u1$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    // Still there — the decline was honoured.
    expect(screen.getByText(/showing 5 of 5 entries/i)).toBeInTheDocument();
  });

  it("removes the row once the delete is confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderView();
    await userEvent.click(screen.getByRole("button", { name: /^delete moris power supply - u1$/i }));
    await waitFor(() => expect(screen.getByText(/showing 4 of 4 entries/i)).toBeInTheDocument());
  });
});
