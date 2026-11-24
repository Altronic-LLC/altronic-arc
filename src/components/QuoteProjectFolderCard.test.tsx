import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";
import { __resetQuoteFoldersMock, DEMO_QUOTE_FOLDER, listIcQuoteFolders } from "@/api/quoteFolders";
import { quoteFolderFor } from "@/hooks/useQuoteFolder";
import type { Quote } from "@/types/quote";
import { QuoteProjectFolderCard } from "./QuoteProjectFolderCard";

// A quote's project folder (Ray, 2026-11-24), end to end in demo mode: create
// or link the folder under IC Quotes, browse it, add subfolders, and the
// quote edit right gating the set-up.

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: who.email, lookupId: 1 }),
  useCurrentUserEmails: () => [who.email],
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toast", async (orig) => ({
  ...(await orig<typeof import("@/components/Toast")>()),
  pushToast: toast,
}));

const MANAGER = "demo.user@altronic-llc.com";
const VIEWER = "brandon.mirto@altronic-llc.com";

beforeEach(() => {
  __resetQuoteMockStores();
  __resetQuoteFoldersMock();
  toast.mockReset();
  who.email = MANAGER;
});

const quote = (id: number): Quote => quoteMockDb.quotes.find((q) => q.id === id)!;

function renderCard(id: number, canSetUp = true) {
  return renderWithProviders(
    <QuoteProjectFolderCard quote={quote(id)} allQuotes={quoteMockDb.quotes} canSetUp={canSetUp} setUpHint="Only quoters." />,
  );
}

describe("QuoteProjectFolderCard", () => {
  it("creates a named folder under IC Quotes and links it to the quote", async () => {
    renderCard(4); // IQ-INN-0003-R1 — no folder yet
    const name = screen.getByLabelText("Folder name");
    expect(name).toHaveValue("IQ-INN-0003");
    await userEvent.clear(name);
    await userEvent.type(name, "IQ-INN-0003 NGI-2000");
    await userEvent.click(screen.getByRole("button", { name: /Create folder/ }));
    await waitFor(() => expect(quote(4).projectFolder).toBe("IQ-INN-0003 NGI-2000"));
    expect((await listIcQuoteFolders()).map((f) => f.name)).toContain("IQ-INN-0003 NGI-2000");
  });

  it("refuses a name SharePoint wouldn't take, before anything is created", async () => {
    renderCard(4);
    const name = screen.getByLabelText("Folder name");
    await userEvent.clear(name);
    await userEvent.type(name, "Bad/name");
    expect(screen.getByRole("alert")).toHaveTextContent("can't contain");
    expect(screen.getByRole("button", { name: /Create folder/ })).toBeDisabled();
  });

  it("links an existing IC Quotes folder", async () => {
    renderCard(4);
    await userEvent.click(screen.getByRole("button", { name: /link an existing folder/i }));
    await userEvent.click(screen.getByRole("button", { name: "Existing folder" }));
    await userEvent.click(await screen.findByRole("option", { name: "IQ-WAB-0002 Wabtec sensors" }));
    await userEvent.click(screen.getByRole("button", { name: "Link folder" }));
    await waitFor(() => expect(quote(4).projectFolder).toBe("IQ-WAB-0002 Wabtec sensors"));
  });

  it("browses the linked folder, opens a subfolder and creates a new one inside it", async () => {
    renderCard(2); // the demo folder
    const list = await screen.findByRole("list", { name: `Contents of ${DEMO_QUOTE_FOLDER}` });
    expect(within(list).getByText("Customer RFQ 4471.pdf")).toBeInTheDocument();
    await userEvent.click(within(list).getByRole("button", { name: /Drawings/ }));
    const inner = await screen.findByRole("list", { name: "Contents of Drawings" });
    expect(within(inner).getByText("CPU-95 harness.pdf")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /New subfolder/ }));
    await userEvent.type(screen.getByLabelText(/New subfolder in Drawings/), "Rev B");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await within(await screen.findByRole("list", { name: "Contents of Drawings" })).findByText("Rev B")).toBeInTheDocument();

    // The breadcrumb leads back to the quote folder — and never above it.
    const crumbs = screen.getByRole("navigation", { name: "Folder path" });
    expect(crumbs).not.toHaveTextContent("IC Quotes");
    await userEvent.click(within(crumbs).getByRole("button", { name: DEMO_QUOTE_FOLDER }));
    expect(await screen.findByRole("list", { name: `Contents of ${DEMO_QUOTE_FOLDER}` })).toBeInTheDocument();
  });

  it("without the edit right, says who can set one up and offers no create", () => {
    who.email = VIEWER;
    renderCard(4, false);
    expect(screen.getByText(/No project folder yet\. Only quoters\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create folder/ })).toBeNull();
  });

  it("the set-up is refused inside the mutation for someone without the edit right", async () => {
    who.email = VIEWER; // a viewer — the card is (wrongly) offering the form
    renderCard(4, true);
    await userEvent.click(screen.getByRole("button", { name: /Create folder/ }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error", message: expect.stringMatching(/quoter/i) })),
    );
    expect(quote(4).projectFolder).toBe("");
    expect((await listIcQuoteFolders()).map((f) => f.name)).not.toContain("IQ-INN-0003");
  });
});

describe("quoteFolderFor", () => {
  it("is the quote's own folder, else the newest rev of the same base that has one", () => {
    const r1 = { ...quote(1), projectFolder: "" };
    const r2 = { ...quote(2), projectFolder: "F" };
    expect(quoteFolderFor(r1, [r1, r2])).toBe("F");
    expect(quoteFolderFor({ ...r1, projectFolder: "Own" }, [r1, r2])).toBe("Own");
    expect(quoteFolderFor(quote(4), quoteMockDb.quotes)).toBe("");
  });
});
