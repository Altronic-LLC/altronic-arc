import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";
import { QuoteDetailView } from "./QuoteDetailView";

// =============================================================================
// The quote worksheet, in mock mode, against the REAL roles list and gates.
//   demo.user = manager, katie.fleming = quoter, brandon.mirto = viewer.
//
// The load-bearing case is the first: a VIEWER must meet no cost, margin or
// overhead value, column header or input anywhere on the page — hidden, not
// masked. The distinctive mock costs (412.35, 88.10, 22.75…) are searched for
// in the whole document's text.
//
// The PDF hooks are mocked (jsPDF has no place in a view test); the revision
// API is a call-through spy so "Create R2" is shown to reach it.
// =============================================================================

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

vi.mock("@/hooks/useAttachments", () => ({
  useAttachments: () => ({ data: [], isLoading: false, error: null }),
  useUploadAttachment: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
  useAttachmentBlobUrl: () => ({ data: null }),
  useCommentFileUpload: () => vi.fn(async () => ({ name: "f.png", webUrl: "u" })),
}));

const pdf = vi.hoisted(() => ({
  generate: vi.fn(),
  save: vi.fn(),
  download: vi.fn(),
}));
vi.mock("@/hooks/useQuotePdf", () => ({
  useGenerateQuotePdf: () => ({ mutateAsync: pdf.generate, isPending: false }),
  useSaveQuotePdf: () => ({ mutateAsync: pdf.save, isPending: false }),
  useQuotePdfs: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  downloadBlob: pdf.download,
}));

vi.mock("@/api/quoteRevisions", async (orig) => {
  const a = await orig<typeof import("@/api/quoteRevisions")>();
  return { ...a, createQuoteRevision: vi.fn(a.createQuoteRevision) };
});
import * as revApi from "@/api/quoteRevisions";

const MANAGER = "demo.user@altronic-llc.com";
const QUOTER = "katie.fleming@altronic-llc.com";
const VIEWER = "brandon.mirto@altronic-llc.com";

beforeEach(() => {
  __resetQuoteMockStores();
  who.email = MANAGER;
  pdf.generate.mockReset();
  pdf.save.mockReset();
  pdf.download.mockReset();
  vi.mocked(revApi.createQuoteRevision).mockClear();
});

function renderQuote(id: number) {
  return renderWithProviders(<QuoteDetailView />, {
    route: `/sales/quotes/${id}`,
    routePattern: "/sales/quotes/:id",
  });
}

/** Wait until the worksheet's components have loaded (the CPU-95 board line). */
async function waitForWorksheet() {
  await screen.findByRole("heading", { level: 1 }, { timeout: 10_000 });
  await waitFor(() => expect(screen.getAllByText("791950-PCB").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
}

/** Cost-bearing text that must never reach a viewer's screen. */
const COST_STRINGS = [
  "412.35",
  "88.10",
  "22.75",
  "31.20",
  "Unit cost",
  "Loaded cost",
  "Overhead",
  "Target GM",
  "GM %",
  "Ext. cost",
  "Markup",
  "Profit",
  "Discount",
  "Total cost",
  "Manual price",
  "Achieved GM",
  // The lines' target GMs as the worksheet prints them (quote 2: 40% and 35%).
  "40.0%",
  "35.0%",
];

/** Wait until a quote's lines have loaded, by one part number on it. */
async function waitForLine(partNumber: string) {
  await screen.findByRole("heading", { level: 1 }, { timeout: 10_000 });
  await waitFor(() => expect(screen.getAllByText(partNumber).length).toBeGreaterThan(0), { timeout: 10_000 });
}

describe("QuoteDetailView — cost is hidden from viewers", () => {
  it("a VIEWER sees no cost, margin or overhead value, header or input anywhere", async () => {
    who.email = VIEWER;
    renderQuote(2);
    await waitForWorksheet();
    // Sell prices ARE visible to everyone.
    expect(screen.getAllByText("Unit price").length).toBeGreaterThan(0);
    const text = document.body.textContent ?? "";
    for (const s of COST_STRINGS) expect(text, `viewer saw "${s}"`).not.toContain(s);
    // No editing affordances at all.
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add line/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Generate PDF/ })).toBeNull();
    expect(document.querySelectorAll('input[type="number"]').length).toBe(0);
  });

  it("a VIEWER sees a Part line's price but not its cost, overhead or target GM", async () => {
    who.email = VIEWER;
    renderQuote(3);
    await waitForLine("610225-ELEM");
    const part = screen.getByRole("article", { name: "Part 610225-ELEM" });
    expect(within(part).getByText("Part")).toBeInTheDocument();
    expect(within(part).getAllByText("$76.80").length).toBeGreaterThan(0);
    const text = document.body.textContent ?? "";
    for (const s of ["38.40", "42.24", "45.0%", "10%", ...COST_STRINGS]) {
      expect(text, `viewer saw "${s}"`).not.toContain(s);
    }
  });

  it("a QUOTER sees the cost columns and values", async () => {
    who.email = QUOTER;
    renderQuote(2);
    await waitForWorksheet();
    const text = document.body.textContent ?? "";
    expect(text).toContain("$412.35");
    expect(text).toContain("Unit cost");
    expect(text).toContain("Loaded cost");
    expect(text).toContain("Total cost");
    expect(text).toContain("Manual price");
  });

  it("the viewer can still comment — the Discussion composer is there", async () => {
    who.email = VIEWER;
    renderQuote(2);
    await waitForWorksheet();
    expect(screen.getByRole("heading", { name: "Discussion" })).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText(/Write a comment/).length).toBeGreaterThan(0);
  });
});

describe("QuoteDetailView — revisions", () => {
  it("links the other revs and flags a superseded one", async () => {
    renderQuote(1);
    await waitForWorksheet();
    expect(screen.getByText(/Rev 1 of 2/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/earlier revision/);
    expect(within(screen.getByLabelText("Revisions")).getByRole("link", { name: "R2" })).toHaveAttribute(
      "href",
      "/sales/quotes/2",
    );
  });

  it("the latest rev carries no superseded banner", async () => {
    renderQuote(2);
    await waitForWorksheet();
    expect(screen.queryByText(/earlier revision/)).toBeNull();
  });
});

describe("QuoteDetailView — status", () => {
  it("a QUOTER can move Draft → Sent but the outcomes are refused, with the reason on screen", async () => {
    who.email = QUOTER;
    renderQuote(2);
    await waitForWorksheet();
    const group = screen.getByRole("group", { name: "Quote status" });
    expect(within(group).getByRole("button", { name: "Sent" })).not.toHaveAttribute("aria-disabled");
    const won = within(group).getByRole("button", { name: "Won" });
    expect(won).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/Only a quote manager can mark a quote Won/)).toBeInTheDocument();

    await userEvent.click(won);
    expect(quoteMockDb.quotes.find((q) => q.id === 2)?.status).toBe("Draft");
  });

  it("a MANAGER may set an outcome", async () => {
    renderQuote(2);
    await waitForWorksheet();
    const group = screen.getByRole("group", { name: "Quote status" });
    expect(within(group).getByRole("button", { name: "Won" })).not.toHaveAttribute("aria-disabled");
  });

  it("marking a quote Sent offers to save the PDF", async () => {
    renderQuote(2);
    await waitForWorksheet();
    await userEvent.click(within(screen.getByRole("group", { name: "Quote status" })).getByRole("button", { name: "Sent" }));
    expect(await screen.findByText("Save the PDF to the IC Quotes folder now?")).toBeInTheDocument();
  });
});

describe("QuoteDetailView — editing a Sent quote", () => {
  it("asks 'Update anyway, or create a new rev?' before editing a Sent quote", async () => {
    renderQuote(1); // Sent; R2 already exists, so the next rev is R3
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: "Edit quote details" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "This rev was sent to the customer. Update IQ-COO-0001-R1 anyway, or create R3?",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Update anyway" }));
    expect(await screen.findByRole("dialog", { name: "Edit IQ-COO-0001-R1" })).toBeInTheDocument();
  });

  it("guards assembly and component edits too", async () => {
    renderQuote(1);
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(/was sent to the customer/);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit component 791950-PCB" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(/was sent to the customer/);
  });

  it("does NOT ask on a Draft quote", async () => {
    renderQuote(2);
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: "Edit quote details" }));
    expect(await screen.findByRole("dialog", { name: "Edit IQ-COO-0001-R2" })).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("'Create R2' makes the new rev and opens it", async () => {
    quoteMockDb.quotes.find((q) => q.id === 4)!.status = "Sent";
    renderQuote(4);
    await screen.findByRole("heading", { level: 1, name: "IQ-INN-0003-R1" }, { timeout: 10_000 });
    await userEvent.click(screen.getByRole("button", { name: "Edit quote details" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create R2" }));
    expect(revApi.createQuoteRevision).toHaveBeenCalledWith(4);
    expect(
      await screen.findByRole("heading", { level: 1, name: "IQ-INN-0003-R2" }, { timeout: 10_000 }),
    ).toBeInTheDocument();
  });
});

describe("QuoteDetailView — the PDF", () => {
  it("Generate PDF lists what's stopping it rather than failing silently", async () => {
    pdf.generate.mockRejectedValue(
      new Error("The quote can't be generated yet:\n• Choose a customer before generating the quote.\n• This quote has no assemblies to print."),
    );
    renderQuote(2);
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: /Generate PDF/ }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Choose a customer before generating the quote.")).toBeInTheDocument();
    expect(within(alert).getByText("This quote has no assemblies to print.")).toBeInTheDocument();
    expect(pdf.download).not.toHaveBeenCalled();
  });

  it("Generate PDF downloads it, and saves nothing", async () => {
    const blob = new Blob(["%PDF"]);
    pdf.generate.mockResolvedValue({ blob, fileName: "IQ-COO-0001-R2.pdf" });
    renderQuote(2);
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: /Generate PDF/ }));
    await waitFor(() => expect(pdf.download).toHaveBeenCalledWith(blob, "IQ-COO-0001-R2.pdf"));
    expect(pdf.generate.mock.calls[0][0].quote.id).toBe(2);
    expect(pdf.save).not.toHaveBeenCalled();
  });

  it("Save PDF to folder generates, then saves", async () => {
    const blob = new Blob(["%PDF"]);
    pdf.generate.mockResolvedValue({ blob, fileName: "IQ-COO-0001-R2.pdf" });
    pdf.save.mockResolvedValue({ name: "IQ-COO-0001-R2.pdf", webUrl: "https://x" });
    renderQuote(2);
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: /Save PDF to folder/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledWith({ blob, fileName: "IQ-COO-0001-R2.pdf" }));
  });
});

describe("QuoteDetailView — components", () => {
  it("a component row expands to its own discussion", async () => {
    who.email = VIEWER;
    renderQuote(2);
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: "Show discussion for component 791950-PCB" }));
    expect(await screen.findByText("Component discussion")).toBeInTheDocument();
    expect(screen.getByText(/Board cost from the Sept build lot/)).toBeInTheDocument();
  });

  it("the expanded panel: attachments BEFORE comments in the wide column, watchers beside — no sideways scroll", async () => {
    who.email = QUOTER;
    renderQuote(2);
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: "Show discussion for component 791950-PCB" }));
    const panel = await screen.findByTestId(/^component-panel-/);
    const parts = [...panel.querySelectorAll("[data-panel-part]")].map((el) => el.getAttribute("data-panel-part"));
    expect(parts).toEqual(["attachments", "comments", "watchers"]);
    const attachments = panel.querySelector('[data-panel-part="attachments"]')!;
    const comments = panel.querySelector('[data-panel-part="comments"]')!;
    // Attachments precede the thread in DOM order, in the SAME (wide) column.
    expect(attachments.compareDocumentPosition(comments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(attachments.parentElement).toBe(comments.parentElement);
    // Two columns from md, stacked below; every column may shrink (min-w-0).
    expect(panel.className).toMatch(/\bgrid-cols-1\b/);
    expect(panel.className).toMatch(/md:grid-cols-\[minmax\(0,1fr\)_16rem\]/);
    for (const child of [...panel.children]) expect(child.className).toMatch(/\bmin-w-0\b/);
    // The panel's own wrapper never scrolls sideways: pinned (sticky left-0), overflow-x hidden.
    const wrapper = panel.parentElement!;
    expect(wrapper.className).toMatch(/\bsticky\b/);
    expect(wrapper.className).toMatch(/\bleft-0\b/);
    expect(wrapper.className).toMatch(/\boverflow-x-hidden\b/);
    expect(wrapper.className).not.toMatch(/overflow-x-(auto|scroll)/);
  });

  it("deleting an assembly names how many components go with it", async () => {
    renderQuote(2);
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: "Delete assembly 693005-1" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("This also deletes its 2 components");
    await act(async () => {
      await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    await waitFor(() => expect(quoteMockDb.assemblies.some((a) => a.id === 4)).toBe(false));
  });
});

describe("QuoteDetailView — quoted quantity, Subtotal and Total", () => {
  it("everyone sees each line's Qty, Unit price and Subtotal, and the quote Total; cost at qty is gated", async () => {
    who.email = VIEWER;
    renderQuote(3);
    await waitForLine("610225-ELEM");
    const sensor = screen.getByRole("article", { name: "Assembly 610225-2" });
    const qty = within(sensor).getByLabelText("Quoted quantity");
    expect(within(qty).getByText("25")).toBeInTheDocument();
    expect(within(qty).getByText("$87.70")).toBeInTheDocument();
    expect(within(qty).getByText("$2,192.50")).toBeInTheDocument();
    expect(within(qty).queryByText(/Cost at qty|GM at qty|Profit at qty/)).toBeNull();
    const total = screen.getByLabelText("Quote total");
    expect(within(total).getByText("Total")).toBeInTheDocument();
    expect(within(total).getByText("$2,269.30")).toBeInTheDocument();
    expect(within(total).queryByText("Total cost")).toBeNull();
  });

  it("a quoter also sees cost, profit and GM at the quoted quantity", async () => {
    who.email = QUOTER;
    renderQuote(3);
    await waitForLine("610225-ELEM");
    const qty = within(screen.getByRole("article", { name: "Assembly 610225-2" })).getByLabelText("Quoted quantity");
    expect(within(qty).getByText("Cost at qty")).toBeInTheDocument();
    expect(within(qty).getByText("GM at qty")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Quote total")).getByText("Total cost")).toBeInTheDocument();
  });
});

describe("QuoteDetailView — the quote's attachments", () => {
  it("sit in the MAIN column, directly above the Discussion — not in the sidebar", async () => {
    renderQuote(2);
    await waitForWorksheet();
    const attachments = screen.getByTestId("quote-attachments");
    const discussion = screen.getByRole("heading", { name: "Discussion" }).closest("section")!;
    expect(attachments.compareDocumentPosition(discussion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(attachments.nextElementSibling).toBe(discussion);
    expect(attachments.closest("aside")).toBeNull();
    expect(attachments).toHaveTextContent(/customer's data package/);
  });
});

describe("QuoteDetailView — the margin lives on the LINE, never on a component", () => {
  it("the components table shows cost only: no target GM, sell or GM % header", async () => {
    who.email = QUOTER;
    renderQuote(2);
    await waitForWorksheet();
    const card = screen.getByRole("article", { name: "Assembly 791950-08" });
    const table = within(card).getAllByRole("table").find((t) => within(t).queryByText("Altronic part #"))!;
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => (h.textContent ?? "").trim())
      .filter(Boolean);
    expect(headers).toEqual([
      "Line",
      "Altronic part #",
      "SAP #",
      "Description",
      "Qty",
      "Unit cost",
      "Overhead %",
      "Loaded cost",
      "Ext. cost",
    ]);
    for (const banned of [/target gm/i, /sell/i, /^gm/i, /margin/i, /price/i]) {
      expect(headers.some((h) => banned.test(h)), `component header matched ${banned}`).toBe(false);
    }
    // Derived money is 2 decimals: 412.35 × 1.08 = 445.338 → $445.34, never $445.338.
    expect(within(table).getAllByText("$445.34")).toHaveLength(2); // loaded and ext. at qty 1
    expect(card.textContent).not.toContain("445.338");
  });

  it("the assembly roll-up shows its total cost, target GM, price, achieved GM and markup", async () => {
    who.email = QUOTER;
    renderQuote(2);
    await waitForWorksheet();
    const card = screen.getByRole("article", { name: "Assembly 791950-08" });
    const rollUp = within(card).getByLabelText("Assembly roll-up");
    expect(within(rollUp).getByText("Total cost")).toBeInTheDocument();
    expect(within(rollUp).getByText("$642.16")).toBeInTheDocument();
    expect(within(rollUp).getAllByText("40.0%")).toHaveLength(2); // target, and achieved at the computed price
    expect(within(rollUp).getByText("$1,070.26")).toBeInTheDocument();
    expect(within(rollUp).getByText("Achieved GM")).toBeInTheDocument();
    expect(within(rollUp).getByText("Markup %")).toBeInTheDocument();
  });

  it("a Part line shows its own cost, a Part badge, and NO components section", async () => {
    who.email = QUOTER;
    renderQuote(3);
    await waitForLine("610225-ELEM");
    const part = screen.getByRole("article", { name: "Part 610225-ELEM" });
    expect(within(part).getByText("Part")).toBeInTheDocument();
    expect(within(part).getByText("$38.40")).toBeInTheDocument(); // unit cost
    expect(within(part).getAllByText("$42.24").length).toBeGreaterThan(0); // loaded
    expect(within(part).queryByText(/Components \(/)).toBeNull();
    expect(within(part).queryByRole("button", { name: /Add component/ })).toBeNull();
    // The assembly on the same quote still has its components.
    const assembly = screen.getByRole("article", { name: "Assembly 610225-2" });
    expect(within(assembly).getByRole("button", { name: /Add component/ })).toBeInTheDocument();
  });

  it("a Part line shows 'Loaded cost' exactly ONCE — its cost inputs sit in the one roll-up strip", async () => {
    who.email = QUOTER;
    renderQuote(3);
    await waitForLine("610225-ELEM");
    const part = screen.getByRole("article", { name: "Part 610225-ELEM" });
    expect(within(part).getAllByText("Loaded cost")).toHaveLength(1);
    const rollUp = within(part).getByLabelText("Part roll-up");
    const labels = [...rollUp.querySelectorAll("dt")].map((d) => (d.textContent ?? "").trim());
    expect(labels).toEqual(["Unit cost", "Overhead %", "Loaded cost", "Target GM", "Price", "Achieved GM", "Markup %"]);
  });
});

describe("QuoteDetailView — layout", () => {
  it("the worksheet goes two-column (main + sidebar) only from xl; the sidebar stacks AFTER the main column below that", async () => {
    renderQuote(2);
    await waitForWorksheet();
    const aside = document.querySelector("aside")!;
    const grid = aside.parentElement!;
    expect(grid.className).toMatch(/\bgrid-cols-1\b/);
    expect(grid.className).toMatch(/xl:grid-cols-\[minmax\(0,1fr\)_20rem\]/);
    expect(grid.className).not.toMatch(/\blg:grid-cols-/);
    expect(grid.lastElementChild).toBe(aside);
    for (const child of [...grid.children]) expect(child.className).toMatch(/\bmin-w-0\b/);
  });
});
