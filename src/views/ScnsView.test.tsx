import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_SCNS } from "@/data/scnMockData";
import { __resetScnMockStore } from "@/api/scns";
import type { Scn } from "@/types/task";
import { ScnsView } from "./ScnsView";

// =============================================================================
// NOTE: jsdom has no CSS breakpoints, so the phone cards (`sm:hidden`) and
// the table (`hidden sm:block`) BOTH render, and every SCN's number appears
// twice. Queries use getAllBy* or scope to the table.
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

/** Swap the list read per test — a refusal, a failure, an empty list, 151 rows. */
const api = vi.hoisted(() => ({ listImpl: null as null | (() => Promise<Scn[]>) }));
vi.mock("@/api/scns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/scns")>();
  return {
    ...actual,
    listScns: () => (api.listImpl ? api.listImpl() : actual.listScns()),
  };
});

beforeEach(() => {
  api.listImpl = null;
  mockNavigate.mockReset();
  __resetScnMockStore();
});

async function renderList(search = "") {
  const result = renderWithProviders(<ScnsView />, {
    route: `/supply-chain/scns${search}`,
    routePattern: "/supply-chain/scns",
  });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return result;
}

/** How many times an SCN# is on screen — 2 means card + table row, 0 means filtered out. */
function shown(scnNumber: string): number {
  return screen.queryAllByText(scnNumber).length;
}

function filterTrigger(label: string): HTMLElement {
  const bar = screen.getByRole("search", { name: /scn filters/i });
  const field = within(bar).getByText(label).closest("label") as HTMLElement;
  return field.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
}

/** The SCN# cells of the table, top to bottom. */
function tableFirstColumn(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("td a")?.textContent?.trim() ?? "")
    .filter(Boolean);
}

describe("ScnsView — what is shown", () => {
  // 128 of the 142 live rows are CLOSED; opening on all of them buries the
  // handful that are work.
  it("shows only open SCNs by default", async () => {
    await renderList();
    expect(shown("2026-0148")).toBe(2); // WIP
    expect(shown("2026-0146")).toBe(2); // LTB in process
    expect(shown("2026-0145")).toBe(2); // Customer Phase Out
    expect(shown("2026-0144")).toBe(2); // On Hold
    expect(shown("2026-0147")).toBe(0); // CLOSED
    expect(shown("2026-0143")).toBe(0); // Cancelled
  });

  it("links to the SCN Documents library from the header", async () => {
    await renderList();
    expect(screen.getByRole("link", { name: /Documents/ })).toHaveAttribute(
      "href",
      "/supply-chain/scns/documents",
    );
  });

  it("counts every pill over the whole set", async () => {
    await renderList();
    expect(screen.getByRole("button", { name: /^Open/ })).toHaveTextContent("4");
    expect(screen.getByRole("button", { name: /^All/ })).toHaveTextContent("8");
    expect(screen.getByRole("button", { name: /^CLOSED/ })).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /^Cancelled/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^WIP/ })).toHaveTextContent("1");
  });

  it("honours a status in the URL", async () => {
    await renderList("?status=CLOSED");
    expect(shown("2026-0147")).toBe(2);
    expect(shown("2026-0142")).toBe(2);
    expect(shown("2026-0141")).toBe(2);
    expect(shown("2026-0148")).toBe(0);
  });

  it("switches to all of them from the pills", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /^All/ }));
    await waitFor(() => expect(shown("2026-0147")).toBe(2));
    expect(shown("2026-0148")).toBe(2);
  });

  it("searches every field — a customer, a part number, the SCN# itself", async () => {
    await renderList("?status=All");
    const box = screen.getByPlaceholderText(/scn#, product/i);
    await userEvent.type(box, "Waukesha");
    await waitFor(() => expect(shown("2026-0148")).toBe(0));
    expect(shown("2026-0146")).toBe(2);

    await userEvent.clear(box);
    await userEvent.type(box, "791952-18");
    await waitFor(() => expect(shown("2026-0146")).toBe(2));
    expect(shown("2026-0145")).toBe(0);

    await userEvent.clear(box);
    await userEvent.type(box, "0143");
    await waitFor(() => expect(shown("2026-0143")).toBe(2));
    expect(shown("2026-0146")).toBe(0);
  });

  it("counts the pills over the search results, not the whole list", async () => {
    await renderList("?status=All&q=Waukesha");
    expect(screen.getByRole("button", { name: /^All/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^Open/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^CLOSED/ })).toHaveTextContent("0");
  });

  it("filters by category", async () => {
    await renderList("?status=All");
    await userEvent.click(filterTrigger("Category"));
    await userEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "EECR" }));
    await waitFor(() => expect(shown("2026-0148")).toBe(0));
    expect(shown("2026-0144")).toBe(2);
  });

  it("filters by year, from the URL", async () => {
    // Every mock row is 2026, so this narrows to nothing — and says so with
    // the "no match" wording, not the "nothing open" one, because a filter
    // IS set. No table renders, so don't wait for one.
    renderWithProviders(<ScnsView />, { route: "/supply-chain/scns?status=All&year=2025" });
    expect(await screen.findByText("No SCNs match these filters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^All/ })).toHaveTextContent("0");
  });

  it("offers the years the data holds", async () => {
    await renderList();
    await userEvent.click(filterTrigger("Year"));
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: "2026" })).toBeInTheDocument();
  });

  it("says nothing is open rather than nothing matches, when no filter is set", async () => {
    api.listImpl = async () => MOCK_SCNS.filter((s) => s.status === "CLOSED");
    renderWithProviders(<ScnsView />, { route: "/supply-chain/scns" });
    expect(await screen.findByText(/Nothing open\. Switch to All/)).toBeInTheDocument();
  });

  it("links each row to the SCN and opens it on a card tap", async () => {
    await renderList();
    const links = screen.getAllByRole("link", { name: "2026-0148" });
    expect(links[0]).toHaveAttribute("href", "/supply-chain/scn/1");

    // The phone card is a button; clicking it navigates.
    const card = screen.getAllByText("2026-0148").find((el) => el.closest("button"))!.closest("button")!;
    await userEvent.click(card);
    expect(mockNavigate).toHaveBeenCalledWith("/supply-chain/scn/1");
  });

  it("marks an SCN with attachments", async () => {
    await renderList();
    // SCN 1 has files and is open — card + table row.
    expect(screen.getAllByLabelText("Has attachments")).toHaveLength(2);
  });

  it("shows a comment count on the table row", async () => {
    await renderList();
    const row = screen.getAllByText("2026-0148").find((el) => el.closest("tr"))!.closest("tr")!;
    expect(within(row).getByTitle("2 comments")).toBeInTheDocument();
  });

  it("opens the new-SCN form", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /new scn/i }));
    expect(await screen.findByRole("dialog", { name: "New SCN" })).toBeInTheDocument();
  });

  it("has no delete control", async () => {
    await renderList("?status=All");
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});

describe("ScnsView — sorting", () => {
  it("renders a sort button per data column and none for the paperclip", async () => {
    await renderList();
    for (const label of ["SCN#", "Product", "Category", "Status", "Approval", "Assigned to", "Owner", "Year"]) {
      expect(screen.getByRole("button", { name: `Sort by ${label}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /sort by attachments/i })).toBeNull();
  });

  it("opens newest SCN# first and reverses on click — the rows actually move", async () => {
    await renderList("?status=All");
    expect(tableFirstColumn()[0]).toBe("2026-0148");
    await userEvent.click(screen.getByRole("button", { name: "Sort by SCN#" }));
    await waitFor(() => expect(tableFirstColumn()[0]).toBe("2026-0141"));
  });
});

describe("ScnsView — the phone filter panel", () => {
  it("is collapsed by default, and forced open with a badge when a filter is active", async () => {
    await renderList();
    const toggle = screen.getByRole("button", { name: /search and filters/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("never hides an active filter that arrived in the URL", async () => {
    await renderList("?q=Waukesha");
    const toggle = screen.getByRole("button", { name: /search and filters/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(toggle).getByText("1")).toBeInTheDocument();
  });
});

describe("ScnsView — the row cap", () => {
  function manyScns(n: number): Scn[] {
    const base = MOCK_SCNS[0];
    return Array.from({ length: n }, (_, i) => ({
      ...base,
      id: 1000 + i,
      scnNumber: `2026-${String(1000 + i).padStart(4, "0")}`,
      comments: [],
      hasAttachments: false,
    }));
  }

  it("renders 150 rows, offers show all, and resets when a filter changes", async () => {
    api.listImpl = async () => manyScns(151);
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<ScnsView />, { route: "/supply-chain/scns" });
    // Text, never *ByRole — see CLAUDE.md on capped-list tests.
    const showAll = await screen.findByText(/Showing 150 — show all/);
    expect(screen.getByText("151 SCNs")).toBeInTheDocument();
    expect(tableFirstColumn()).toHaveLength(150);

    await user.click(showAll);
    await waitFor(() => expect(tableFirstColumn()).toHaveLength(151));
    expect(screen.queryByText(/show all/)).toBeNull();

    await user.type(screen.getByPlaceholderText(/scn#, product/i), "DD");
    await waitFor(() => expect(screen.getByText(/Showing 150 — show all/)).toBeInTheDocument());
  });
});

describe("ScnsView — a failed read is never an empty list", () => {
  it("shows the access notice when SharePoint refuses the list", async () => {
    api.listImpl = () =>
      Promise.reject(
        Object.assign(new Error("Graph 403 Forbidden: accessDenied"), { status: 403 }),
      );
    renderWithProviders(<ScnsView />, { route: "/supply-chain/scns" });
    expect(await screen.findByText(/You don't have access to this SharePoint list yet/)).toBeInTheDocument();
    expect(screen.getByText(/SCN Dashboard cannot load/)).toBeInTheDocument();
    expect(screen.getByText("ALTRONICSALESTEAM/SCN")).toBeInTheDocument();
    expect(screen.queryByText(/No SCNs/)).toBeNull();
  });

  it("says it couldn't load, with the reason and a retry, for any other failure", async () => {
    api.listImpl = () => Promise.reject(new Error("the wire went quiet"));
    renderWithProviders(<ScnsView />, { route: "/supply-chain/scns" });
    expect(await screen.findByText("Couldn't load SCNs.")).toBeInTheDocument();
    expect(screen.getByText("the wire went quiet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/No SCNs/)).toBeNull();
  });

  it("shows the real empty state only when the read succeeded and came back empty", async () => {
    api.listImpl = async () => [];
    renderWithProviders(<ScnsView />, { route: "/supply-chain/scns" });
    expect(await screen.findByText("No SCNs yet.")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
    expect(screen.queryByText(/don't have access/)).toBeNull();
  });
});
