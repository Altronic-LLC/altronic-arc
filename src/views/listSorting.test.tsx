import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// =============================================================================
// Column sorting, exercised through real views.
//
// `lib/tableSort.test.ts` covers the engine's rules exhaustively. This file
// answers the different question: is each list actually WIRED to it — headers
// rendered, clicks reaching the sort, rows reordering?
//
// Seven lists gained sorting on 2026-09-16 (Ray: Visit Reports, ECNs, FAITs,
// Suppliers, CSA Listings, Teradyne Log, Gray Market Requests). A view whose
// columns array is right but whose `<tbody>` still maps the UNSORTED list
// would pass every engine test and do nothing on screen — that is the failure
// this file exists to catch, and it is not hypothetical: wiring the rows is a
// separate edit from wiring the headers in every one of them.
//
// Deliberately shallow per view: one "the buttons are there" and one "the
// order actually changes". The rules themselves are not re-tested here.
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 1,
  }),
  useCurrentUserEmails: () => ["ray.white@altronic-llc.com"],
}));

const adminAccess = vi.hoisted(() => ({ isAdmin: true, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));

/** The data cells of the rendered rows, first column only. */
function firstColumnValues(): string[] {
  const rows = screen.getAllByRole("row").slice(1); // drop the header row
  return rows
    .map((r) => r.querySelector("td")?.textContent?.trim() ?? "")
    .filter(Boolean);
}

/** Click a column's sort button by its label. */
async function sortBy(label: string | RegExp) {
  const button = screen.getByRole("button", {
    name: typeof label === "string" ? `Sort by ${label}` : label,
  });
  await userEvent.click(button);
}

async function waitForTable() {
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument(), {
    timeout: 10_000,
  });
}

describe("every sortable list renders its sort buttons", () => {
  it("Visit Reports", async () => {
    const { VisitReportsView } = await import("./VisitReportsView");
    renderWithProviders(<VisitReportsView />, { route: "/sales/visit-reports" });
    await waitForTable();
    expect(screen.getByRole("button", { name: "Sort by Visit Date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort by Customer" })).toBeInTheDocument();
  });

  it("ECNs", async () => {
    const { EcnsView } = await import("./EcnsView");
    renderWithProviders(<EcnsView />, { route: "/engineering/ecns" });
    await waitForTable();
    expect(screen.getByRole("button", { name: "Sort by Log#" })).toBeInTheDocument();
  });

  it("FAITs", async () => {
    const { FaitsView } = await import("./FaitsView");
    renderWithProviders(<FaitsView />, { route: "/supply-chain/faits" });
    await waitForTable();
    expect(screen.getByRole("button", { name: "Sort by Part" })).toBeInTheDocument();
  });

  it("Suppliers", async () => {
    const { SuppliersView } = await import("./SuppliersView");
    renderWithProviders(<SuppliersView />, { route: "/supply-chain/suppliers" });
    await waitForTable();
    expect(screen.getByRole("button", { name: "Sort by Supplier" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort by Performance" })).toBeInTheDocument();
  });

  it("CSA Listings", async () => {
    const { CsaListingsView } = await import("./CsaListingsView");
    renderWithProviders(<CsaListingsView />, { route: "/csa-listings" });
    await waitForTable();
    expect(screen.getByRole("button", { name: "Sort by File Number" })).toBeInTheDocument();
  });

  it("Teradyne Log", async () => {
    const { TeradyneLogView } = await import("./TeradyneLogView");
    renderWithProviders(<TeradyneLogView />, { route: "/operations/teradyne-log" });
    await waitForTable();
    expect(screen.getByRole("button", { name: "Sort by Date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort by Boards" })).toBeInTheDocument();
  });

  it("Gray Market Requests", async () => {
    const { GrayMarketRequestsView } = await import("./GrayMarketRequestsView");
    renderWithProviders(<GrayMarketRequestsView />, {
      route: "/supply-chain/gray-market-requests",
    });
    await waitForTable();
    expect(screen.getByRole("button", { name: "Sort by Log No." })).toBeInTheDocument();
  });
});

describe("the rows are actually re-ordered", () => {
  // Each case clicks a column and asserts the FIRST cell changed or the order
  // reversed. This is what catches a view whose <tbody> still maps the
  // unsorted list — the engine tests can't see that.

  it("CSA Listings sorts by File Number, then reverses", async () => {
    const { CsaListingsView } = await import("./CsaListingsView");
    renderWithProviders(<CsaListingsView />, { route: "/csa-listings" });
    await waitForTable();

    await sortBy("File Number");
    const ascending = firstColumnValues();
    expect(ascending.length).toBeGreaterThan(1);

    await sortBy("File Number");
    const descending = firstColumnValues();
    expect(descending).toEqual([...ascending].reverse());
  });

  it("Suppliers sorts by Supplier, then reverses", async () => {
    const { SuppliersView } = await import("./SuppliersView");
    renderWithProviders(<SuppliersView />, { route: "/supply-chain/suppliers" });
    await waitForTable();

    await sortBy("Supplier");
    const ascending = firstColumnValues();
    expect(ascending.length).toBeGreaterThan(1);

    await sortBy("Supplier");
    expect(firstColumnValues()).toEqual([...ascending].reverse());
  });

  it("Gray Market sorts by Log No., then reverses", async () => {
    const { GrayMarketRequestsView } = await import("./GrayMarketRequestsView");
    renderWithProviders(<GrayMarketRequestsView />, {
      route: "/supply-chain/gray-market-requests",
    });
    await waitForTable();

    await sortBy("Log No.");
    const ascending = firstColumnValues();
    expect(ascending.length).toBeGreaterThan(1);

    await sortBy("Log No.");
    expect(firstColumnValues()).toEqual([...ascending].reverse());
  });

  it("FAITs sorts by Supplier — a column that is NOT the default", async () => {
    // Sorting on a non-default column proves the key is actually switching,
    // not just the direction flipping on whatever it started with.
    const { FaitsView } = await import("./FaitsView");
    renderWithProviders(<FaitsView />, { route: "/supply-chain/faits" });
    await waitForTable();

    await sortBy("Supplier");
    const ascending = firstColumnValues();

    await sortBy("Supplier");
    expect(firstColumnValues()).toEqual([...ascending].reverse());
  });
});

describe("the sort indicator says what is happening", () => {
  it("marks the active column with aria-sort, and only that one", async () => {
    const { CsaListingsView } = await import("./CsaListingsView");
    renderWithProviders(<CsaListingsView />, { route: "/csa-listings" });
    await waitForTable();

    await sortBy("Product");

    const headers = screen.getAllByRole("columnheader");
    const sorted = headers.filter((h) => {
      const v = h.getAttribute("aria-sort");
      return v === "ascending" || v === "descending";
    });
    expect(sorted).toHaveLength(1);
    // Each header holds TWO buttons — the label opens the value filter, the
    // icon sorts — so match the sort one specifically.
    expect(within(sorted[0]).getByRole("button", { name: "Sort by Product" })).toBeInTheDocument();
    expect(sorted[0].getAttribute("aria-sort")).toBe("ascending");

    await sortBy("Product");
    expect(
      screen
        .getAllByRole("columnheader")
        .find((h) => h.getAttribute("aria-sort") !== "none")
        ?.getAttribute("aria-sort"),
    ).toBe("descending");
  });
});
