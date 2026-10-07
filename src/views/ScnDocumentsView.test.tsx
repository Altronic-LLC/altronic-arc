import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetScnDocumentsMock } from "@/api/scnDocuments";

// =============================================================================
// The SCN Documents browser against the MOCK library (which mirrors the live
// root). jsdom has no breakpoints, so the phone cards AND the table render at
// once — every entry appears twice; scope to the table or use getAll*.
//
// Seeded ids are deterministic: General is scndoc-6, its Templates scndoc-7.
// =============================================================================

type QueryState = { data?: unknown; isLoading: boolean; error: unknown; refetch: () => void };
const override = vi.hoisted(() => ({ list: null as null | QueryState }));

vi.mock("@/hooks/useScnDocuments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useScnDocuments")>();
  return {
    ...actual,
    useScnDocuments: (folderId?: string | null) =>
      override.list ?? actual.useScnDocuments(folderId),
  };
});

import { ScnDocumentsView } from "./ScnDocumentsView";

const ROUTE = "/supply-chain/scns/documents";

beforeEach(() => {
  __resetScnDocumentsMock();
  override.list = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function table() {
  return within(await screen.findByRole("table"));
}

describe("ScnDocumentsView", () => {
  it("opens on the library root: folders first, the note, and the root breadcrumb", async () => {
    renderWithProviders(<ScnDocumentsView />, { route: ROUTE });
    const t = await table();
    const names = t.getAllByRole("row").slice(1).map((r) => r.querySelector("td")?.textContent);
    expect(names.slice(0, 2)).toEqual(["ARCHIVE", "EECR"]);
    expect(names).toContain("SCN FLOW.pdf");
    expect(
      screen.getByText(/Edit opens the file in Word \/ Excel for the web/),
    ).toBeInTheDocument();
    const crumbs = screen.getByRole("navigation", { name: "Folder path" });
    expect(within(crumbs).getByText("Documents")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Open in SharePoint/ })).toHaveAttribute(
      "href",
      expect.stringContaining("/Shared%20Documents/Forms/AllItems.aspx"),
    );
  });

  it("navigates into a folder via ?folder=, and the breadcrumb follows", async () => {
    renderWithProviders(<ScnDocumentsView />, { route: ROUTE });
    const t = await table();
    await userEvent.click(t.getByRole("button", { name: "General" }));
    const inner = await table();
    expect(await inner.findByRole("button", { name: "Templates" })).toBeInTheDocument();
    const crumbs = screen.getByRole("navigation", { name: "Folder path" });
    await waitFor(() => expect(within(crumbs).getByText("General")).toBeInTheDocument());
    expect(within(crumbs).getByRole("link", { name: "Documents" })).toHaveAttribute("href", ROUTE);
  });

  it("deep-links to a nested folder, every ancestor a link", async () => {
    renderWithProviders(<ScnDocumentsView />, { route: `${ROUTE}?folder=scndoc-7` });
    const t = await table();
    expect(t.getByText("SCN Template.docx")).toBeInTheDocument();
    const crumbs = screen.getByRole("navigation", { name: "Folder path" });
    await waitFor(() =>
      expect(within(crumbs).getByRole("link", { name: "General" })).toHaveAttribute(
        "href",
        `${ROUTE}?folder=scndoc-6`,
      ),
    );
    expect(within(crumbs).getByText("Templates")).toHaveAttribute("aria-current", "page");
  });

  it("Edit opens an Office file in a new tab; anything else is Open", async () => {
    renderWithProviders(<ScnDocumentsView />, { route: ROUTE });
    const t = await table();
    const docRow = t.getByText("Submitting an SCN.docx").closest("tr")!;
    const edit = within(docRow).getByRole("link", { name: "Edit in Office" });
    expect(edit).toHaveAttribute("target", "_blank");
    expect(edit).toHaveAttribute("rel", "noopener noreferrer");
    expect(edit.getAttribute("href")).toContain("Submitting%20an%20SCN.docx");

    const pdfRow = t.getByText("SCN FLOW.pdf").closest("tr")!;
    expect(within(pdfRow).getByRole("link", { name: "Open" })).toHaveAttribute("target", "_blank");
    expect(within(pdfRow).queryByRole("link", { name: "Edit in Office" })).toBeNull();
  });

  it("downloads through the authenticated read, not the webUrl", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    renderWithProviders(<ScnDocumentsView />, { route: ROUTE });
    const t = await table();
    await userEvent.click(t.getByRole("button", { name: "Download SCN FLOW.pdf" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });

  it("creates a folder — Enter submits — and it appears", async () => {
    renderWithProviders(<ScnDocumentsView />, { route: ROUTE });
    await table();
    await userEvent.click(screen.getByRole("button", { name: /New folder/ }));
    await userEvent.type(screen.getByLabelText("New folder name"), "Q4 Reviews{Enter}");
    const t = await table();
    expect(await t.findByRole("button", { name: "Q4 Reviews" })).toBeInTheDocument();
    expect(screen.queryByLabelText("New folder name")).toBeNull();
  });

  it("refuses an illegal folder name before sending, and Escape cancels", async () => {
    renderWithProviders(<ScnDocumentsView />, { route: ROUTE });
    await table();
    await userEvent.click(screen.getByRole("button", { name: /New folder/ }));
    await userEvent.type(screen.getByLabelText("New folder name"), "A/B");
    expect(screen.getByText(/can't contain/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText("New folder name")).toBeNull();
  });

  it("uploads several picked files into the current folder", async () => {
    renderWithProviders(<ScnDocumentsView />, { route: `${ROUTE}?folder=scndoc-6` });
    await table();
    const input = screen.getByTestId("scn-documents-file-input");
    fireEvent.change(input, {
      target: { files: [new File(["a"], "Notes A.txt"), new File(["b"], "Notes B.txt")] },
    });
    const t = await table();
    expect(await t.findByText("Notes A.txt")).toBeInTheDocument();
    expect(await t.findByText("Notes B.txt")).toBeInTheDocument();
  });

  it("shows the loading screen while the folder loads", () => {
    override.list = { isLoading: true, error: null, refetch: vi.fn() };
    renderWithProviders(<ScnDocumentsView />, { route: ROUTE });
    // The verb is random; the noun is what the caller passed.
    expect(screen.getByText(/ documents$/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says a refused library is a permission problem — never an empty folder", () => {
    const refetch = vi.fn();
    override.list = {
      isLoading: false,
      error: Object.assign(new Error("Graph 403"), { status: 403 }),
      refetch,
    };
    renderWithProviders(<ScnDocumentsView />, { route: ROUTE });
    expect(screen.getByText(/You don't have access/)).toBeInTheDocument();
    expect(screen.queryByText("This folder is empty.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Check again/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says a failed read failed, with a retry — never an empty folder", () => {
    const refetch = vi.fn();
    override.list = { isLoading: false, error: new Error("Graph 500 boom"), refetch };
    renderWithProviders(<ScnDocumentsView />, { route: ROUTE });
    expect(screen.getByText("Couldn't load this folder.")).toBeInTheDocument();
    expect(screen.queryByText("This folder is empty.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says an empty folder is empty only when the read succeeded", () => {
    override.list = { data: [], isLoading: false, error: null, refetch: vi.fn() };
    renderWithProviders(<ScnDocumentsView />, { route: ROUTE });
    expect(screen.getByText("This folder is empty.")).toBeInTheDocument();
  });
});
