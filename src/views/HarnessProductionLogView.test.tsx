import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { resetHarnessLogMockStore } from "@/api/harnessProductionLog";
import { harnessYears, parseHarnessYear, HarnessProductionLogView } from "./HarnessProductionLogView";

// USE_MOCK is true under Vitest, so the view renders the mock log. The cards
// (phone) and the table (desktop) both render in jsdom, so queries scope to
// the table.

const adminAccess = vi.hoisted(() => ({ isAdmin: true, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));

const thisYear = new Date().getFullYear();

beforeEach(() => {
  resetHarnessLogMockStore();
  adminAccess.isAdmin = true;
  adminAccess.isResolving = false;
});

async function renderView(route = "/operations/harness-log") {
  renderWithProviders(<HarnessProductionLogView />, { route });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return screen.getByRole("table");
}

describe("pure helpers", () => {
  it("offers every year back to 2018", () => {
    expect(harnessYears(2020)).toEqual([2020, 2019, 2018]);
  });

  it("reads ?year=, refusing anything out of range", () => {
    expect(parseHarnessYear(null, 2026)).toEqual({ kind: "year", year: 2026 });
    expect(parseHarnessYear("all", 2026)).toEqual({ kind: "all" });
    expect(parseHarnessYear("2019", 2026)).toEqual({ kind: "year", year: 2019 });
    expect(parseHarnessYear("2017", 2026)).toEqual({ kind: "year", year: 2026 });
    expect(parseHarnessYear("2030", 2026)).toEqual({ kind: "year", year: 2026 });
  });
});

describe("HarnessProductionLogView", () => {
  it("shows this year's entries with their part numbers and totals", async () => {
    const table = await renderView();
    expect(screen.getByRole("heading", { name: /harness production log/i })).toBeInTheDocument();
    expect(within(table).getByText("1002089401")).toBeInTheDocument();
    expect(within(table).getAllByText("593075-1").length).toBeGreaterThan(0);
    // Last year's rows aren't in this year's view.
    expect(within(table).queryByText("1001932269")).not.toBeInTheDocument();
    expect(screen.getByText(/built · .* reworked/)).toBeInTheDocument();
  });

  it("opens any year for anyone, including All years", async () => {
    adminAccess.isAdmin = false;
    const table = await renderView("/operations/harness-log?year=all");
    expect(within(table).getByText("1001932269")).toBeInTheDocument();
    expect(within(table).getByText("1002089401")).toBeInTheDocument();
  });

  it("marks a row the import changed", async () => {
    const table = await renderView();
    expect(within(table).getByLabelText("Changed on import")).toBeInTheDocument();
  });

  it("narrows by search across work order, part and comments", async () => {
    const table = await renderView("/operations/harness-log?q=strands");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it("gives an admin the delete bin, and nobody else", async () => {
    let table = await renderView();
    expect(within(table).getAllByRole("button", { name: /^Delete / }).length).toBeGreaterThan(0);

    adminAccess.isAdmin = false;
    document.body.innerHTML = "";
    table = await renderView();
    expect(within(table).queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
    expect(within(table).getAllByRole("button", { name: /^Edit / }).length).toBeGreaterThan(0);
    expect(screen.getByText(/limited to ARC admins/)).toBeInTheDocument();
  });

  it("deletes after a confirm", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const table = await renderView();
    const before = within(table).getAllByRole("row").length;
    await userEvent.click(within(table).getByRole("button", { name: "Delete 593075-1 / WO 1002089401" }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row").length).toBe(before - 1));
  });

  it("links to the part numbers", async () => {
    await renderView();
    expect(screen.getByRole("link", { name: /part numbers/i })).toHaveAttribute(
      "href",
      "/operations/harness-log/part-numbers",
    );
  });

  it("opens the New entry form", async () => {
    await renderView();
    await userEvent.click(screen.getByRole("button", { name: /new entry/i }));
    expect(screen.getByRole("dialog", { name: "New harness entry" })).toBeInTheDocument();
  });

  it(`says when a year has nothing logged`, async () => {
    renderWithProviders(<HarnessProductionLogView />, { route: `/operations/harness-log?year=${thisYear - 3}` });
    expect(await screen.findByText(/Nothing logged in/)).toBeInTheDocument();
  });
});
