import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_ALTRONIC_PARTS } from "@/data/altronicPartsMockData";
import type { AltronicPart } from "@/types/task";

// The Part List read is swapped per test — the mock data by default, a failure
// or a big list where a case needs one.
const listAltronicParts = vi.hoisted(() => vi.fn());
vi.mock("@/api/altronicParts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/altronicParts")>();
  return { ...actual, listAltronicParts: () => listAltronicParts() };
});

import { PartsListView } from "./PartsListView";

class FakeGraphError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Graph ${status}`);
    this.name = "GraphError";
  }
}

function renderList(route: string) {
  const pattern = route.startsWith("/engineering/parts/search")
    ? "/engineering/parts/search"
    : "/engineering/parts/list/:prefix";
  return renderWithProviders(<PartsListView />, { route, routePattern: pattern });
}

function useMockParts() {
  listAltronicParts.mockResolvedValue(MOCK_ALTRONIC_PARTS.map((p) => ({ ...p })));
}

/** Part numbers in the rendered table, top to bottom. */
function tablePartNumbers(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("td")?.textContent?.trim() ?? "");
}

afterEach(() => listAltronicParts.mockReset());

describe("PartsListView — one Part List list", () => {
  it("shows only the parts in that three-digit list", async () => {
    useMockParts();
    renderList("/engineering/parts/list/309");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(tablePartNumbers()).toEqual(["309114", "309115"]);
    expect(screen.getByRole("heading", { name: "309 List" })).toBeInTheDocument();
  });

  it("offers New part to somebody who can add there", async () => {
    // Mock mode: the demo user holds every Parts Roles tag.
    useMockParts();
    renderList("/engineering/parts/list/309");
    expect(await screen.findByRole("button", { name: "New part" })).toBeInTheDocument();
  });

  it("links each part number to its own page", async () => {
    useMockParts();
    renderList("/engineering/parts/list/309");
    const link = await screen.findByRole("link", { name: "309114" });
    expect(link).toHaveAttribute("href", "/engineering/parts/part/5");
  });

  it("applies a field search from the URL, and forces the panel open", async () => {
    useMockParts();
    renderList("/engineering/parts/list/604?f.manufacturer=gct");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(tablePartNumbers()).toEqual(["604596"]);
    // A narrowed list must say it is narrowed.
    expect(screen.getByText("1 of 2 parts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Search/, expanded: true })).toBeInTheDocument();
  });

  it("searches everything word by word", async () => {
    useMockParts();
    renderList("/engineering/parts/list/604?q=type%20c");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(tablePartNumbers()).toEqual(["604596"]);
  });

  it("says nothing matches, rather than showing an empty table", async () => {
    useMockParts();
    renderList("/engineering/parts/list/604?q=zzzz");
    expect(await screen.findByText("No parts match this search.")).toBeInTheDocument();
  });

  it("clears every search at once", async () => {
    useMockParts();
    renderList("/engineering/parts/list/604?q=type&f.manufacturer=gct");
    await userEvent.click(await screen.findByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(tablePartNumbers()).toEqual(["604596", "604612"]));
  });

  it("says so when the list number has no parts", async () => {
    useMockParts();
    renderList("/engineering/parts/list/444");
    expect(await screen.findByText("No parts in list 444.")).toBeInTheDocument();
  });

  it("shows a pending sign-off, and nothing for a legacy row", async () => {
    useMockParts();
    renderList("/engineering/parts/list/604");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByText("Pending SAP")).toBeInTheDocument();
    expect(screen.queryByText("Not tracked")).not.toBeInTheDocument();
  });
});

describe("PartsListView — a Component List list", () => {
  it("reads the Component List for an HCO prefix, with its columns", async () => {
    renderList("/engineering/parts/list/701");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(tablePartNumbers()).toEqual(["701043", "701212", "701990"]);
    expect(screen.getByText(/Altronic Component List · Surface Mount/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort by Rating A" })).toBeInTheDocument();
    // The Part List was never asked for.
    expect(listAltronicParts).not.toHaveBeenCalled();
  });
});

describe("PartsListView — range search (the old app's R)", () => {
  // Mock list 701: 701043 RESISTOR 10K, 701212 CAPACITOR 0.1uF, 701990 RESISTOR 4K7.

  it("finds 4K7 in a 1K–5K search from the URL, with the From/To boxes showing", async () => {
    renderList("/engineering/parts/list/701?from.ratingA=1K&to.ratingA=5K");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(tablePartNumbers()).toEqual(["701990"]);
    // A range in a shared link must show the boxes narrowing the list.
    expect(screen.getByRole("button", { name: "Search Rating A as a range" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Rating A from")).toHaveValue("1K");
    expect(screen.getByText(/Reads as 1k to 5k\./)).toBeInTheDocument();
  });

  it("switches a field to a range with R, and searches it", async () => {
    renderList("/engineering/parts/list/701");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Search Rating A as a range" }));
    await userEvent.type(screen.getByLabelText("Rating A from"), "5K");
    await waitFor(() => expect(tablePartNumbers()).toEqual(["701043"]));
    expect(screen.getByText(/Reads as 5k or more\./)).toBeInTheDocument();
  });

  it("says so when a box holds no value, and doesn't narrow on it", async () => {
    renderList("/engineering/parts/list/701?from.ratingA=lots");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByText(/Couldn't read “lots” as a value/)).toBeInTheDocument();
    expect(tablePartNumbers()).toEqual(["701043", "701212", "701990"]);
  });

  it("goes back to a text search with R again, dropping the range", async () => {
    renderList("/engineering/parts/list/701?from.ratingA=1K&to.ratingA=5K");
    await waitFor(() => expect(tablePartNumbers()).toEqual(["701990"]));
    await userEvent.click(screen.getByRole("button", { name: "Search Rating A as a range" }));
    await waitFor(() => expect(tablePartNumbers()).toEqual(["701043", "701212", "701990"]));
    expect(screen.getByLabelText("Rating A")).toBeInTheDocument();
  });

  it("range-searches component temperatures in Global Search, and no Part List part", async () => {
    useMockParts();
    renderList("/engineering/parts/search?from.tempMax=150");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(tablePartNumbers().sort()).toEqual(["601110", "611075", "701043", "701990", "711508", "711640"]);
  });
});

describe("PartsListView — Global Search", () => {
  it("searches both lists at once", async () => {
    useMockParts();
    renderList("/engineering/parts/search?f.manufacturer=vishay");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const numbers = tablePartNumbers();
    expect(numbers).toContain("601110"); // a component
    expect(numbers.every((n) => n.startsWith("6"))).toBe(true);
  });

  it("finds everything awaiting approval with a sign-off search — the banner's link", async () => {
    useMockParts();
    renderList("/engineering/parts/search?f.signOffStatus=Pending");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(tablePartNumbers().sort()).toEqual(["604612", "701990", "711702"]);
  });

  it("links a component row to the component page", async () => {
    useMockParts();
    renderList("/engineering/parts/search?q=601110");
    const link = await screen.findByRole("link", { name: "601110" });
    expect(link).toHaveAttribute("href", "/engineering/parts/component/1");
  });

  it("links each row's list", async () => {
    useMockParts();
    renderList("/engineering/parts/search?q=601110");
    expect(await screen.findByRole("link", { name: "601" })).toHaveAttribute("href", "/engineering/parts/list/601");
  });
});

describe("PartsListView — a read that fails", () => {
  it("shows the access notice when SharePoint refuses the list", async () => {
    listAltronicParts.mockRejectedValue(new FakeGraphError(403, '{"error":{"code":"accessDenied"}}'));
    renderList("/engineering/parts/list/309");
    expect(await screen.findByText(/don't have access to this SharePoint list/i)).toBeInTheDocument();
    expect(screen.queryByText("No parts in list 309.")).not.toBeInTheDocument();
  });

  it("says it couldn't load for any other failure", async () => {
    listAltronicParts.mockRejectedValue(new FakeGraphError(404, '{"error":{"code":"itemNotFound"}}'));
    renderList("/engineering/parts/list/309");
    expect(await screen.findByText("Couldn't load the parts list.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("names the permission possibility when the whole list comes back empty", async () => {
    // A 14,000-row list returning nothing is how SharePoint answers an
    // item-level permission problem — never just "no parts in list 309".
    listAltronicParts.mockResolvedValue([]);
    renderList("/engineering/parts/list/309");
    expect(await screen.findByText("No parts to show.")).toBeInTheDocument();
    expect(screen.queryByText("No parts in list 309.")).not.toBeInTheDocument();
  });
});

describe("PartsListView — fitting the window on a desktop", () => {
  it("sizes the search panel and the table to end above the footer, each scrolling inside", async () => {
    // jsdom has no layout, so every rect is 0: the fit is the window height
    // minus the gap left above the footer.
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("min-width: 1024px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    try {
      useMockParts();
      renderList("/engineering/parts/list/604");
      await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
      expect(screen.getByRole("search")).toHaveStyle({ maxHeight: "884px" });
      // The table's card, and inside it the box that scrolls both ways.
      const scroller = screen.getByRole("table").parentElement!;
      expect(scroller.className).toContain("overflow-auto");
      expect(scroller.parentElement).toHaveStyle({ maxHeight: "884px" });
    } finally {
      window.matchMedia = original;
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
    }
  });

  it("leaves the ordinary page scroll alone on a phone", async () => {
    useMockParts();
    renderList("/engineering/parts/list/604");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByRole("search").style.maxHeight).toBe("");
  });
});

describe("PartsListView — row cap", () => {
  it("renders 150 rows, says how many exist, and shows the rest on request", async () => {
    const base = MOCK_ALTRONIC_PARTS[0];
    const many: AltronicPart[] = Array.from({ length: 151 }, (_, i) => ({
      ...base,
      id: i + 1,
      partNumber: `101${String(i).padStart(3, "0")}`,
    }));
    listAltronicParts.mockResolvedValue(many);
    renderList("/engineering/parts/list/101");

    // Matched by text, not *ByRole — see CLAUDE.md on row-cap tests.
    expect(await screen.findByText("Showing 150 — show all")).toBeInTheDocument();
    expect(screen.getByText("151 parts")).toBeInTheDocument();
    expect(screen.queryByText("101150")).not.toBeInTheDocument();

    await userEvent.setup({ delay: null }).click(screen.getByText("Showing 150 — show all"));
    expect(await screen.findByText("101150")).toBeInTheDocument();
  });
});

describe("PartsListView — deleted part numbers", () => {
  function withDeleted() {
    listAltronicParts.mockResolvedValue(
      MOCK_ALTRONIC_PARTS.map((p) =>
        p.partNumber === "309114" ? { ...p, description: "DELETED", signOffStatus: "Deleted" } : { ...p },
      ),
    );
  }

  it("leaves a deleted number out of its list", async () => {
    withDeleted();
    renderList("/engineering/parts/list/309");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(tablePartNumbers()).toEqual(["309115"]);
    expect(screen.getByText("1 part")).toBeInTheDocument();
  });

  it("leaves it out of Global Search too", async () => {
    withDeleted();
    renderList("/engineering/parts/search?q=309");
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(tablePartNumbers()).not.toContain("309114");
    expect(tablePartNumbers()).toContain("309115");
  });
});
