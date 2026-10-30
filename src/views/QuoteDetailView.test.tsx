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
// masked. The distinctive mock costs (520.00 material, 85.00 labor, 93.60
// overhead, 698.60 total…) are searched for in the whole document's text.
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

/** Wait until the worksheet's lines have loaded (the CPU-95 line on quotes 1 and 2). */
async function waitForWorksheet() {
  await screen.findByRole("heading", { level: 1 }, { timeout: 10_000 });
  await waitFor(() => expect(screen.getByRole("article", { name: "Line 791950-08" })).toBeInTheDocument(), {
    timeout: 10_000,
  });
}

/** Cost-bearing text that must never reach a viewer's screen. */
const COST_STRINGS = [
  "520.00",
  "85.00",
  "93.60",
  "698.60",
  "54.00",
  "75.72",
  "Material",
  "Labor",
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

  it("a VIEWER sees a no-labor line's price but not its material, overhead or target GM", async () => {
    who.email = VIEWER;
    renderQuote(3);
    await waitForLine("610225-ELEM");
    const line = screen.getByRole("article", { name: "Line 610225-ELEM" });
    expect(within(line).getAllByText("$76.80").length).toBeGreaterThan(0);
    const text = document.body.textContent ?? "";
    for (const s of ["38.40", "42.24", "3.84", "45.0%", "10%", ...COST_STRINGS]) {
      expect(text, `viewer saw "${s}"`).not.toContain(s);
    }
  });

  it("a QUOTER sees the cost columns and values", async () => {
    who.email = QUOTER;
    renderQuote(2);
    await waitForWorksheet();
    const text = document.body.textContent ?? "";
    expect(text).toContain("$520.00");
    expect(text).toContain("Material");
    expect(text).toContain("Labor");
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

  it("guards line and alternates edits too", async () => {
    renderQuote(1);
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(/was sent to the customer/);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit line 791950-08" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(/was sent to the customer/);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit alternates" }));
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

describe("QuoteDetailView — lines", () => {
  it("deleting a line asks first, then removes it", async () => {
    renderQuote(2);
    await waitForWorksheet();
    await userEvent.click(screen.getByRole("button", { name: "Delete line 693005-1" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete line 693005-1?");
    await act(async () => {
      await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    await waitFor(() => expect(quoteMockDb.assemblies.some((a) => a.id === 4)).toBe(false));
  });

  it("no component rows, Final assembly / Part badges or Add component anywhere", async () => {
    renderQuote(2);
    await waitForWorksheet();
    expect(screen.queryByText(/Components \(/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Add component/ })).toBeNull();
    expect(screen.queryByText("Final assembly")).toBeNull();
  });
});

describe("QuoteDetailView — customer reference and customer notes", () => {
  it("shows the customer reference, and the customer's notes marked as never printed", async () => {
    who.email = VIEWER;
    renderQuote(2);
    await waitForWorksheet();
    expect(screen.getByText("RFQ 4471 — CPU-95 retrofit kits")).toBeInTheDocument();
    const notes = screen.getByTestId("customer-notes");
    expect(notes).toHaveTextContent(/Net 45/);
    expect(notes).toHaveTextContent(/Not printed/);
  });

  it("shows no customer notes box for a customer without notes", async () => {
    renderQuote(4); // INNIO — no notes
    await screen.findByRole("heading", { level: 1, name: "IQ-INN-0003-R1" }, { timeout: 10_000 });
    expect(screen.queryByTestId("customer-notes")).toBeNull();
  });
});

describe("QuoteDetailView — alternates", () => {
  it("everyone sees the table; a quoter edits it, pasting three-option rows from Excel", async () => {
    who.email = QUOTER;
    renderQuote(2);
    await waitForWorksheet();
    const card = screen.getByRole("region", { name: "Alternates" });
    for (const header of ["Option 1", "Option 2", "Option 3", "Reason for the alternate"]) {
      expect(within(card).getByText(header)).toBeInTheDocument();
    }
    expect(within(card).getAllByText("Manufacturer")).toHaveLength(3);
    expect(within(card).getByText("MS3106A-20-27S")).toBeInTheDocument();
    expect(within(card).getByText(/ships in 3 weeks instead of 22/)).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "Edit alternates" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit alternates" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Paste from Excel/ }));
    await userEvent.click(within(dialog).getByLabelText("Paste from Excel"));
    await userEvent.paste("Vishay\tCRCW0603\t4 weeks\tYageo\tRC0603\tStock\t\t\t\tYageo is in stock");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add rows" }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Added 1 row.");
    // Typed by hand into the new row's third option.
    await userEvent.type(within(dialog).getByLabelText("Row 3 option 3 Manufacturer"), "Bourns");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(quoteMockDb.quotes.find((q) => q.id === 2)!.alternates).toHaveLength(3));
    expect(quoteMockDb.quotes.find((q) => q.id === 2)!.alternates[2]).toEqual({
      designator: "",
      sources: [
        { manufacturer: "Vishay", partNumber: "CRCW0603", leadTime: "4 weeks" },
        { manufacturer: "Yageo", partNumber: "RC0603", leadTime: "Stock" },
        { manufacturer: "Bourns", partNumber: "", leadTime: "" },
      ],
      reason: "Yageo is in stock",
    });
  });

  it("a viewer sees the table but no Edit", async () => {
    who.email = VIEWER;
    renderQuote(2);
    await waitForWorksheet();
    const card = screen.getByRole("region", { name: "Alternates" });
    expect(within(card).getByText("MS3106A-20-27S")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Edit alternates" })).toBeNull();
  });

  it("a table ARC couldn't read is said, and can't be edited", async () => {
    const row = quoteMockDb.quotes.find((q) => q.id === 2)!;
    row.alternatesCorrupt = true;
    row.alternates = [];
    renderQuote(2);
    await waitForWorksheet();
    const card = screen.getByRole("region", { name: "Alternates" });
    expect(within(card).getByRole("alert")).toHaveTextContent(/couldn't be read/);
    expect(within(card).queryByRole("button", { name: "Edit alternates" })).toBeNull();
  });
});

describe("QuoteDetailView — linked work", () => {
  it("shows a linked Engineering task with an Open link to it", async () => {
    renderQuote(4); // linked to task 47
    await screen.findByRole("heading", { level: 1, name: "IQ-INN-0003-R1" }, { timeout: 10_000 });
    const panel = screen.getByTestId("quote-links");
    expect(within(panel).getByRole("link", { name: "Open the linked engineering task" })).toHaveAttribute(
      "href",
      "/task/47",
    );
    expect(within(panel).queryByRole("link", { name: "Open the linked operations task" })).toBeNull();
  });

  it("a quoter links an Operations project, saved straight away", async () => {
    who.email = QUOTER;
    renderQuote(2);
    await waitForWorksheet();
    const panel = screen.getByTestId("quote-links");
    await userEvent.click(within(panel).getByRole("button", { name: "Operations project" }));
    await userEvent.click(await screen.findByRole("option", { name: "0002-PVA Conformal Coating Machine" }));
    await waitFor(() =>
      expect(quoteMockDb.quotes.find((q) => q.id === 2)!.operationsProjectRef).toBe("0002-PVA Conformal Coating Machine"),
    );
  });

  it("a viewer can't change a link", async () => {
    who.email = VIEWER;
    renderQuote(2);
    await waitForWorksheet();
    const panel = screen.getByTestId("quote-links");
    for (const name of ["Engineering project", "Engineering task", "Operations project", "Operations task"]) {
      expect(within(panel).getByRole("button", { name })).toBeDisabled();
    }
  });
});

describe("QuoteDetailView — quoted quantity, Subtotal and Total", () => {
  it("everyone sees each line's Qty, Unit price and Subtotal, and the quote Total; cost at qty is gated", async () => {
    who.email = VIEWER;
    renderQuote(3);
    await waitForLine("610225-ELEM");
    const sensor = screen.getByRole("article", { name: "Line 610225-2" });
    const qty = within(sensor).getByLabelText("Quoted quantity");
    // $96.47 less the 25+ break's 8% = $88.75; × 25 = $2,218.75.
    expect(within(qty).getByText("25")).toBeInTheDocument();
    expect(within(qty).getByText("$88.75")).toBeInTheDocument();
    expect(within(qty).getByText("$2,218.75")).toBeInTheDocument();
    expect(within(qty).queryByText(/Cost at qty|GM at qty|Profit at qty/)).toBeNull();
    const total = screen.getByLabelText("Quote total");
    expect(within(total).getByText("Total")).toBeInTheDocument();
    expect(within(total).getByText("$2,295.55")).toBeInTheDocument(); // + the $76.80 line
    expect(within(total).queryByText("Total cost")).toBeNull();
  });

  it("a quoter also sees cost, profit and GM at the quoted quantity", async () => {
    who.email = QUOTER;
    renderQuote(3);
    await waitForLine("610225-ELEM");
    const qty = within(screen.getByRole("article", { name: "Line 610225-2" })).getByLabelText("Quoted quantity");
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
    expect(attachments).toHaveTextContent(/customer's data package and supplier quotes/);
  });
});

describe("QuoteDetailView — the line's cost", () => {
  it("shows material, overhead, labor, total cost, target GM, price, achieved GM and markup", async () => {
    who.email = QUOTER;
    renderQuote(2);
    await waitForWorksheet();
    const card = screen.getByRole("article", { name: "Line 791950-08" });
    const strip = within(card).getByLabelText("Line cost");
    const labels = [...strip.querySelectorAll("dt")].map((d) => (d.textContent ?? "").trim());
    expect(labels).toEqual([
      "Material",
      "Overhead (18%)",
      "Labor",
      "Total cost",
      "Target GM",
      "Price",
      "Achieved GM",
      "Markup %",
    ]);
    // 520 + 93.60 overhead + 85 labor = 698.60; at 40% → 1,164.33.
    expect(within(strip).getByText("$520.00")).toBeInTheDocument();
    expect(within(strip).getByText("$93.60")).toBeInTheDocument();
    expect(within(strip).getByText("$85.00")).toBeInTheDocument();
    expect(within(strip).getByText("$698.60")).toBeInTheDocument();
    expect(within(strip).getByText("$1,164.33")).toBeInTheDocument();
    expect(within(strip).getAllByText("40.0%")).toHaveLength(2); // target, and achieved at the computed price
  });

  it("a line with no labor says so rather than inventing one", async () => {
    who.email = QUOTER;
    renderQuote(3);
    await waitForLine("610225-ELEM");
    const strip = within(screen.getByRole("article", { name: "Line 610225-ELEM" })).getByLabelText("Line cost");
    expect(within(strip).getByText("Overhead (10%)")).toBeInTheDocument();
    expect(within(strip).getByText("$3.84")).toBeInTheDocument();
    expect(within(strip).getByText("$42.24")).toBeInTheDocument();
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
