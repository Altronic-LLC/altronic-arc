import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { teradyneLogKey } from "@/hooks/useTeradyne";
import type { TeradyneLogEntry } from "@/types/task";
import { TeradyneLogView } from "./TeradyneLogView";

// USE_MOCK is true under Vitest, so the view renders against the mock log.
// The mock signed-in user (demo.user@) is a bootstrap admin, so the default is
// the admin experience; the non-admin suite at the bottom overrides the hook.

beforeEach(() => {
  vi.restoreAllMocks();
  adminAccess.isAdmin = true;
  adminAccess.isResolving = false;
});

const adminAccess = vi.hoisted(() => ({ isAdmin: true, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));

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

  it("gives the SAP number and the Altronic part number their own columns", async () => {
    await renderView();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("SAP No.");
    expect(headers).toContain("Altronic Part No.");
    // Entry 4800 has SAP 672337 and Altronic part number 672337-1 — the two
    // must land in different cells rather than one falling back to the other.
    const row = screen.getByText("EX-4000 DA").closest("tr")!;
    expect(within(row).getByText("672337")).toBeInTheDocument();
    expect(within(row).getByText("672337-1")).toBeInTheDocument();
  });

  it("no longer offers the old 'Old SAP Number' label anywhere", async () => {
    await renderView();
    expect(screen.queryByText(/old sap/i)).not.toBeInTheDocument();
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

describe("TeradyneLogView — year scope", () => {
  const thisYear = new Date().getFullYear();

  it("defaults to the current year and says so in the count line", async () => {
    await renderView();
    expect(screen.getByText(new RegExp(`entries in ${thisYear}`))).toBeInTheDocument();
  });

  it("offers previous years and an all-years option", async () => {
    await renderView();
    const yearField = screen.getByText(/^year$/i).closest("label")!;
    await userEvent.click(within(yearField).getAllByRole("button")[0]);

    expect(
      await screen.findByRole("option", { name: `${thisYear} (this year)` }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: String(thisYear - 1) })).toBeInTheDocument();
    // Labelled slow on purpose — it pulls the whole 16k-row archive.
    expect(screen.getByRole("option", { name: /all years \(slow\)/i })).toBeInTheDocument();
  });

  it("reads the year from the URL, so a year's view is shareable", async () => {
    // 2019 has nothing in the fixture — the empty state should name the year
    // rather than implying the whole log is empty.
    renderWithProviders(<TeradyneLogView />, { route: "/operations/teradyne?year=2019" });
    expect(await screen.findByText(/nothing logged in 2019/i)).toBeInTheDocument();
  });

  it("falls back to the current year for a nonsense year param", async () => {
    await renderView("/operations/teradyne?year=banana");
    expect(screen.getByText(new RegExp(`entries in ${thisYear}`))).toBeInTheDocument();
  });

  it("loads every year when the scope is all", async () => {
    await renderView("/operations/teradyne?year=all");
    expect(screen.getByText(/entries in all years/i)).toBeInTheDocument();
  });

  it("warns when SharePoint couldn't filter by year, naming the fix", async () => {
    const entries = [] as TeradyneLogEntry[];
    renderWithProviders(<TeradyneLogView />, {
      route: "/operations/teradyne",
      seedQueryData: [
        {
          key: teradyneLogKey({ kind: "year", year: thisYear }),
          // What the API returns when the EnterDate filter was rejected and it
          // had to download the whole list instead.
          data: { entries, filteredServerSide: false, fetchedRows: 16234 },
        },
      ],
    });

    expect(await screen.findByText(/loading the slow way/i)).toBeInTheDocument();
    expect(screen.getByText(/16,234 rows/)).toBeInTheDocument();
    expect(screen.getByText(/index the/i)).toBeInTheDocument();
  });

  it("says nothing about slowness when the filter worked", async () => {
    await renderView();
    expect(screen.queryByText(/loading the slow way/i)).not.toBeInTheDocument();
  });
});

describe("TeradyneLogView — edit/delete gated to admins", () => {
  it("hides the row actions and the Actions column from a non-admin", async () => {
    adminAccess.isAdmin = false;
    await renderView();

    expect(screen.queryByRole("button", { name: /^edit /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete /i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).not.toContain("Actions");
  });

  it("still lets a non-admin add an entry — only changing one is restricted", async () => {
    adminAccess.isAdmin = false;
    await renderView();

    await userEvent.click(screen.getByRole("button", { name: /new/i }));
    expect(await screen.findByText(/new log entry/i)).toBeInTheDocument();
  });

  it("explains the restriction to a non-admin", async () => {
    adminAccess.isAdmin = false;
    await renderView();
    expect(screen.getByText(/changing or deleting one is limited to admins/i)).toBeInTheDocument();
  });

  it("holds the explanation back while admin status is still resolving", async () => {
    // Otherwise a real admin whose access comes from the Admins list sees
    // "limited to admins" flash up and then vanish.
    adminAccess.isAdmin = false;
    adminAccess.isResolving = true;
    await renderView();
    expect(
      screen.queryByText(/changing or deleting one is limited to admins/i),
    ).not.toBeInTheDocument();
  });

  it("shows the actions and no restriction note to an admin", async () => {
    await renderView();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toContain("Actions");
    expect(
      screen.queryByText(/changing or deleting one is limited to admins/i),
    ).not.toBeInTheDocument();
  });

  it("shows operator notes in the table, so they're readable without opening an entry", async () => {
    adminAccess.isAdmin = false;
    await renderView();
    // Entry 4801's note — previously only visible via the (now admin-only) form.
    expect(screen.getByText(/Reading 4\.2V on CH2/)).toBeInTheDocument();
  });
});

// The real log is ~1,470 rows, so the table caps what it puts in the DOM.
describe("TeradyneLogView — a log too big to render whole", () => {
  /** 500 seeded entries, newest first, so the 200-row cap kicks in. */
  function bigLog(): TeradyneLogEntry[] {
    return Array.from({ length: 500 }, (_, i) => ({
      id: 10_000 - i,
      title: `Board ${i} - U${i}`,
      // Descending dates within the current year, matching how the API hands
      // entries back for the default (current-year) scope.
      enterDate: new Date(Date.UTC(new Date().getFullYear(), 11, 31) - i * 86_400_000),
      product: { lookupId: 1, title: `Board ${i}` },
      employee1: null,
      employee2: null,
      remark: null,
      employee1Clock: null,
      employee2Clock: null,
      defectiveParts: `U${i}`,
      numberOfBoards: 1,
      boardsTested: 2,
      failuresPerBoard: 1,
      sapNumber: "",
      altronicPartNumber: "",
      operatorNotes: "",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      modifiedAt: new Date("2026-01-01T00:00:00Z"),
    }));
  }

  async function renderBig() {
    const entries = bigLog();
    const result = renderWithProviders(<TeradyneLogView />, {
      route: "/operations/teradyne",
      seedQueryData: [
        {
          key: teradyneLogKey({ kind: "year", year: new Date().getFullYear() }),
          data: { entries, filteredServerSide: true, fetchedRows: entries.length },
        },
      ],
    });
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    return result;
  }

  it("renders only the newest 200 rows, and says that's what it's doing", async () => {
    await renderBig();
    await waitFor(() =>
      expect(screen.getByText(/showing the newest 200 of 500 matching entries/i)).toBeInTheDocument(),
    );
    // 200 body rows + 1 header row.
    expect(screen.getAllByRole("row")).toHaveLength(201);
    expect(screen.getByText("Board 0")).toBeInTheDocument();
    expect(screen.queryByText("Board 400")).not.toBeInTheDocument();
  });

  it("totals every matching entry, not just the rendered ones", async () => {
    await renderBig();
    // 500 entries × 1 board and × 2 tested — proof the cap didn't shrink the sums.
    await waitFor(() =>
      expect(screen.getByText(/500 defective boards · 1,000 tested/i)).toBeInTheDocument(),
    );
  });

  it("renders the rest on 'Show all'", async () => {
    await renderBig();
    await userEvent.click(await screen.findByRole("button", { name: /show all 500 entries/i }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(501));
    expect(screen.getByText("Board 400")).toBeInTheDocument();
    expect(screen.queryByText(/showing the newest/i)).not.toBeInTheDocument();
  });

  it("drops the cap once a filter narrows the log below it", async () => {
    await renderBig();
    // "Board 499" matches exactly one entry.
    await userEvent.type(screen.getByPlaceholderText(/search anything/i), "Board 499");
    await waitFor(() => expect(screen.getByText(/showing 1 of 500 entries/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  });
});
