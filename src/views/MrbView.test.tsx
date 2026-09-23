import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { MrbEntry } from "@/types/task";

// =============================================================================
// The MRB list view.
//
// The thing worth pinning: **the register opens on the work, not on the
// archive.** 2,863 of 2,960 real rows are retained Excel history, so a view
// that opened on everything would bury the ~37 live entries waiting on a
// disposition — which is the only reason this screen exists.
//
// **jsdom has no CSS breakpoints**, so the phone card list and the desktop
// table BOTH render and every entry's text appears twice. Scope queries to
// the table (`within(await table())`) or use getAllBy* — the singular
// unscoped form throws "Found multiple elements". Same convention as
// QcCpu95View.test.tsx.
// =============================================================================

const listMrbEntries = vi.hoisted(() => vi.fn());
vi.mock("@/api/mrb", () => ({ listMrbEntries }));

import { MrbView } from "./MrbView";

function entry(over: Partial<MrbEntry> = {}): MrbEntry {
  return {
    id: 1,
    sapNumber: "1000-0001-00",
    mrbDate: new Date("2026-09-08T12:00:00Z"),
    oldPartNumber: "",
    quantity: 1,
    description: "",
    reason: "",
    whereCaused: "",
    disposition: "",
    vendorName: "",
    pricePerUnit: null,
    pricePerIssue: null,
    notes: "",
    comments: [],
    watchers: [],
    dataFormat: "Current",
    sourceYear: 2026,
    provenance: {},
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
    ...over,
  };
}

const UNDECIDED = entry({
  id: 1,
  sapNumber: "LIVE-UNDECIDED",
  disposition: "",
  oldPartNumber: "EC10009",
});
const PENDING = entry({ id: 2, sapNumber: "LIVE-PENDING", disposition: "To be Determined" });
const DECIDED = entry({
  id: 3,
  sapNumber: "LIVE-DECIDED",
  disposition: "Scrap",
  vendorName: "Hobart",
  quantity: 2,
  pricePerUnit: 50,
  pricePerIssue: 100,
});
const ARCHIVED = entry({
  id: 4,
  sapNumber: "ARCHIVE-ROW",
  dataFormat: "Legacy",
  disposition: "",
  mrbDate: new Date("2018-02-14T12:00:00Z"),
});

beforeEach(() => {
  listMrbEntries.mockReset();
  listMrbEntries.mockResolvedValue([UNDECIDED, PENDING, DECIDED, ARCHIVED]);
});

/** The data table, once it has loaded. */
async function table() {
  return await screen.findByRole("table");
}

describe("MrbView — which rows it opens on", () => {
  it("defaults to the entries needing a disposition", async () => {
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    const t = await table();

    expect(within(t).getByText("LIVE-UNDECIDED")).toBeInTheDocument();
    expect(within(t).getByText("LIVE-PENDING")).toBeInTheDocument();
    expect(within(t).queryByText("LIVE-DECIDED")).not.toBeInTheDocument();
  });

  // An archive row is retained history, not a work item — it must never sit
  // in the queue however blank its disposition is.
  it("keeps archive rows OUT of the default queue", async () => {
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    const t = await table();
    expect(within(t).queryByText("ARCHIVE-ROW")).not.toBeInTheDocument();
  });

  it("shows only archive rows on the Archive tab, with an explanation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    await table();

    await user.click(screen.getByRole("button", { name: /Archive/ }));

    await waitFor(async () => {
      expect(within(await table()).getByText("ARCHIVE-ROW")).toBeInTheDocument();
    });
    const t = await table();
    expect(within(t).queryByText("LIVE-UNDECIDED")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Retained history imported from the old Excel workbooks/i),
    ).toBeInTheDocument();
  });

  it("shows the decided entries on the Decided tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    await table();

    await user.click(screen.getByRole("button", { name: /Decided/ }));

    await waitFor(async () =>
      expect(within(await table()).getByText("LIVE-DECIDED")).toBeInTheDocument(),
    );
  });

  it("shows everything on All", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    await table();

    await user.click(screen.getByRole("button", { name: /^All/ }));

    const t = await table();
    await waitFor(() => {
      expect(within(t).getByText("ARCHIVE-ROW")).toBeInTheDocument();
    });
    expect(within(t).getByText("LIVE-DECIDED")).toBeInTheDocument();
  });

  it("honours ?tab= from the URL, so a view can be shared", async () => {
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb?tab=archive" });
    const t = await table();
    expect(within(t).getByText("ARCHIVE-ROW")).toBeInTheDocument();
  });
});

describe("MrbView — what it tells you", () => {
  it("counts each tab over the whole register", async () => {
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    await table();

    // 2 need a disposition, 1 decided, 1 archived, 4 in total.
    expect(screen.getByRole("button", { name: /Needs disposition\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Decided\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Archive\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All\s*4/ })).toBeInTheDocument();
  });

  // Tim, 2026-09-21: show it beside the SAP number. Its SharePoint label is
  // "Old Part Number" — ARC calls it the Altronic Part Number.
  it("shows the Altronic Part Number column right after SAP Number", async () => {
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    const t = await table();

    const headers = within(t)
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "");
    expect(headers[0]).toContain("SAP Number");
    expect(headers[1]).toContain("Altronic Part Number");
    // The old column label must be gone, or the list and the detail page
    // would disagree about what the same field is called.
    expect(headers.join(" ")).not.toContain("Old Part Number");
  });

  it("renders the Altronic Part Number value in that column", async () => {
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    const t = await table();
    const row = within(t).getByText("LIVE-UNDECIDED").closest("tr")!;
    expect(within(row).getAllByRole("cell")[1]).toHaveTextContent("EC10009");
  });

  it("marks a blank disposition as 'Not decided' rather than a dash", async () => {
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    const t = await table();
    expect(within(t).getAllByText("Not decided").length).toBeGreaterThan(0);
  });

  it("totals the cost of what is on screen", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    await table();

    await user.click(screen.getByRole("button", { name: /Decided/ }));

    // The one decided row is $100.00.
    await waitFor(() => expect(screen.getByText(/\$100\.00 total/)).toBeInTheDocument());
  });

  it("filters on the search box", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    await table();

    await user.type(screen.getByPlaceholderText(/Part, reason, vendor/i), "UNDECIDED");

    await waitFor(async () => {
      const t = await table();
      expect(within(t).queryByText("LIVE-PENDING")).not.toBeInTheDocument();
    });
    expect(within(await table()).getByText("LIVE-UNDECIDED")).toBeInTheDocument();
  });

  it("says so, rather than showing an empty table, when the queue is clear", async () => {
    listMrbEntries.mockResolvedValue([DECIDED, ARCHIVED]);
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });

    expect(
      await screen.findByText(/Nothing is waiting on a disposition/i),
    ).toBeInTheDocument();
  });
});

describe("MrbView — on a phone", () => {
  // jsdom applies no CSS, so this asserts BOTH renderings exist and carry
  // the same entries. Which one is visible is Tailwind's `sm:` breakpoint,
  // which no test in this project can evaluate.
  it("renders a card list alongside the table", async () => {
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    const t = await table();

    // In the table exactly once...
    expect(within(t).getAllByText("LIVE-UNDECIDED")).toHaveLength(1);
    // ...and once more outside it, in the card list.
    expect(screen.getAllByText("LIVE-UNDECIDED")).toHaveLength(2);
  });

  it("makes the whole card one tap target", async () => {
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    await table();

    const card = screen.getAllByText("LIVE-UNDECIDED")[0].closest("button");
    expect(card).not.toBeNull();
    // The card repeats the columns the table can't fit on a phone.
    expect(card).toHaveTextContent("EC10009");
  });
});

describe("MrbView — the filter panel", () => {
  it("is collapsed behind a toggle, with nothing selected", async () => {
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    await table();

    const toggle = screen.getByRole("button", { name: /Search and filters/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("opens when the toggle is pressed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb" });
    await table();

    await user.click(screen.getByRole("button", { name: /Search and filters/i }));
    expect(
      screen.getByRole("button", { name: /Search and filters/i }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  // A list narrowed by a filter nobody can see is the invisible-filter trap
  // the EIR status pills already paid for — worse here, because the filter
  // can arrive in a shared URL.
  it("is FORCED open when a filter is already active", async () => {
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb?vendor=Hobart&tab=all" });
    await table();

    expect(
      screen.getByRole("button", { name: /Search and filters/i }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  // Two filters set. Deliberately NOT awaiting the table: these two together
  // match no fixture row, so the empty state renders instead — and the
  // toggle must still show the count, which is exactly when a user needs to
  // know why they are looking at nothing.
  it("badges how many filters are narrowing the list", async () => {
    renderWithProviders(<MrbView />, {
      route: "/supply-chain/mrb?vendor=Hobart&cause=Handling&tab=all",
    });

    const toggle = await screen.findByRole("button", { name: /Search and filters/i });
    expect(toggle).toHaveTextContent("2");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

describe("MrbView — sorting", () => {
  // The trap this catches: headers wired, rows still mapped from the
  // pre-sort list. See views/listSorting.test.tsx for the same check across
  // the other seven lists.
  it("re-orders the rows when a header is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrbView />, { route: "/supply-chain/mrb?tab=all" });
    await table();

    function sapOrder(): string[] {
      const rows = screen.getAllByRole("row").slice(1); // drop the header
      return rows.map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");
    }

    const before = sapOrder();
    await user.click(screen.getByRole("button", { name: /Sort by SAP Number/i }));
    await waitFor(() => expect(sapOrder()).not.toEqual(before));

    const after = sapOrder();
    expect(after[0]).toContain("ARCHIVE-ROW");
  });
});
