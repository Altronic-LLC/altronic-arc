import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// =============================================================================
// The Open Orders screen. Three things are worth pinning here:
//
//   1. **The files come first and the tool is behind a button** (Ray,
//      2026-08-24). One person generates once a week; everybody else arrives to
//      download, and an upload form at the top made the page read as a job to
//      do rather than a shelf to take a file off.
//   2. It SAYS the job is weekly and done by a person. ARC has no scheduler,
//      and a screen implying otherwise leaves everyone assuming somebody else
//      pressed the button.
//   3. Generating is behind a confirmation that names what will be replaced,
//      because a run overwrites that week's files for everybody.
//
// The preview tiles are NOT covered here: they only appear once an extract has
// been read, and jsdom cannot parse an xlsx. The figure that was wrong — a USD
// past-due total labelled "EUR" — is pinned where the logic lives, in
// `formatByCurrency` in lib/openOrders.test.ts. A test here that opened the
// tool and then called the formatter directly would prove nothing about this
// screen.
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

const mockAccess = vi.hoisted(() => ({
  value: { isReportManager: true, enforced: true, isResolving: false },
}));

vi.mock("@/hooks/useOpenOrdersCustomers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useOpenOrdersCustomers")>();
  return { ...actual, useMyOpenOrdersAccess: () => mockAccess.value };
});

import { OpenOrdersView } from "./OpenOrdersView";

const MASTER = "Altronic_Open_Orders_Dashboard_2026-08-21.xlsx";
const CUSTOMER_FILE = /Permian_Midstream_Partners_Open_Orders_2026-08-17/;
const OPEN_TOOL = /Build this week's reports/i;

beforeEach(() => {
  mockAccess.value = { isReportManager: true, enforced: true, isResolving: false };
});

describe("OpenOrdersView — what you see on arrival", () => {
  // The whole point of the reorder: arriving shows you files, not a form.
  it("leads with the files, not the upload form", async () => {
    renderWithProviders(<OpenOrdersView />);
    await waitFor(() => expect(screen.getByText(MASTER)).toBeInTheDocument());
    expect(screen.queryByLabelText(/Run date/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: OPEN_TOOL })).toBeInTheDocument();
  });

  // Reading this week's customer files is what most visitors came for, so the
  // newest week is expanded already.
  it("shows the newest week's individual files without a click", async () => {
    renderWithProviders(<OpenOrdersView />);
    await waitFor(() => expect(screen.getByText(CUSTOMER_FILE)).toBeInTheDocument());
  });

  it("flags the newest master as the latest", async () => {
    renderWithProviders(<OpenOrdersView />);
    await waitFor(() => expect(screen.getByText(MASTER)).toBeInTheDocument());
    expect(screen.getByText("Latest")).toBeInTheDocument();
  });

  it("says the job is weekly, in words", async () => {
    renderWithProviders(<OpenOrdersView />);
    await waitFor(() => expect(screen.getByText(/once-a-week job/i)).toBeInTheDocument());
  });

  it("names the SharePoint folder the files live in", async () => {
    renderWithProviders(<OpenOrdersView />);
    await waitFor(() =>
      expect(screen.getByText(/General\/Order Management\/OPEN ORDERS/)).toBeInTheDocument(),
    );
  });
});

describe("OpenOrdersView — the weekly folders", () => {
  it("collapses a week's folder and opens it again", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpenOrdersView />);
    const week = await screen.findByRole("button", { name: /Week of 2026-08-17/ });
    await user.click(week);
    await waitFor(() => expect(screen.queryByText(CUSTOMER_FILE)).not.toBeInTheDocument());
    await user.click(week);
    await waitFor(() => expect(screen.getByText(CUSTOMER_FILE)).toBeInTheDocument());
  });
});

describe("OpenOrdersView — the tool", () => {
  it("opens on demand and closes again", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpenOrdersView />);
    await user.click(await screen.findByRole("button", { name: OPEN_TOOL }));
    await waitFor(() => expect(screen.getByLabelText(/Run date/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByLabelText(/Run date/i)).not.toBeInTheDocument(),
    );
  });

  it("warns that re-running replaces that week's files", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpenOrdersView />);
    await user.click(await screen.findByRole("button", { name: OPEN_TOOL }));
    await waitFor(() =>
      expect(screen.getByText(/replaces that week's files/i)).toBeInTheDocument(),
    );
  });

  it("links to the customer list with a count on it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpenOrdersView />);
    await user.click(await screen.findByRole("button", { name: OPEN_TOOL }));
    const link = await screen.findByRole("link", { name: /Customer list/i });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("/sales/open-orders/customers"),
    );
  });
});

describe("OpenOrdersView — who can run it", () => {
  // Said on the button before it is pressed, so nobody opens the tool only to
  // be turned away by it.
  it("says downloading is open to everyone, on the button itself", async () => {
    mockAccess.value = { isReportManager: false, enforced: true, isResolving: false };
    renderWithProviders(<OpenOrdersView />);
    await waitFor(() => expect(screen.getByText(/downloading doesn't/i)).toBeInTheDocument());
  });

  it("explains the limit inside the tool, and points at downloading instead", async () => {
    mockAccess.value = { isReportManager: false, enforced: true, isResolving: false };
    const user = userEvent.setup();
    renderWithProviders(<OpenOrdersView />);
    await user.click(await screen.findByRole("button", { name: OPEN_TOOL }));
    await waitFor(() =>
      expect(screen.getByText(/limited to report managers/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/still download everything above/i)).toBeInTheDocument();
  });

  // "You don't have access" flashing up before the lists load reads as a
  // refusal, and people stop trying.
  it("says it is still checking rather than refusing, while access resolves", async () => {
    mockAccess.value = { isReportManager: false, enforced: true, isResolving: true };
    const user = userEvent.setup();
    renderWithProviders(<OpenOrdersView />);
    await user.click(await screen.findByRole("button", { name: OPEN_TOOL }));
    await waitFor(() => expect(screen.getByText(/Checking your access/i)).toBeInTheDocument());
    expect(screen.queryByText(/limited to report managers/i)).not.toBeInTheDocument();
  });

  it("offers the upload control to a report manager", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpenOrdersView />);
    await user.click(await screen.findByRole("button", { name: OPEN_TOOL }));
    await waitFor(() =>
      expect(screen.getByText(/Run this week's reports/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/Run date/i)).toBeInTheDocument();
  });
});
