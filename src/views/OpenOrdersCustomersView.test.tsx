import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

// =============================================================================
// What this screen does when the SharePoint list behind it doesn't exist.
//
// It used to render "Nobody on the list yet. Add a customer…" — an invitation
// to do something impossible — and the real answer arrived as a toast only
// AFTER somebody had typed a customer in and pressed Save (Ray, 2026-08-24:
// "ccant add a customer The Open Orders customer list isn't set up yet").
// =============================================================================

const mockConfig = vi.hoisted(() => ({ listId: undefined as string | undefined }));

vi.mock("@/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/config")>();
  return {
    ...actual,
    USE_MOCK: false,
    get SP_OPEN_ORDERS_CUSTOMERS_LIST_ID() {
      return mockConfig.listId;
    },
  };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

vi.mock("@/hooks/useOpenOrdersCustomers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useOpenOrdersCustomers")>();
  return {
    ...actual,
    useMyOpenOrdersAccess: () => ({
      isReportManager: true,
      enforced: false,
      isResolving: false,
    }),
    useOpenOrdersCustomers: () => ({
      data: [],
      isLoading: false,
      error: mockConfig.listId
        ? undefined
        : new Error("The Open Orders customer list isn't set up yet."),
    }),
  };
});

import { OpenOrdersCustomersView } from "./OpenOrdersCustomersView";

beforeEach(() => {
  mockConfig.listId = undefined;
});

describe("OpenOrdersCustomersView — the list doesn't exist yet", () => {
  it("says so up front instead of inviting you to add a customer", async () => {
    renderWithProviders(<OpenOrdersCustomersView />);
    await waitFor(() =>
      expect(
        screen.getByText(/hasn't been created in SharePoint yet/i),
      ).toBeInTheDocument(),
    );
  });

  // The whole point: don't offer an action that cannot succeed.
  it("switches off Add and Import rather than failing after you type", async () => {
    renderWithProviders(<OpenOrdersCustomersView />);
    await waitFor(() =>
      expect(screen.getByText(/hasn't been created/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /Add customer/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Import from an extract/i }),
    ).not.toBeInTheDocument();
  });

  it("doesn't claim the list is merely empty", async () => {
    renderWithProviders(<OpenOrdersCustomersView />);
    await waitFor(() =>
      expect(screen.getByText(/no list to read yet/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Nobody on the list yet/i)).not.toBeInTheDocument();
  });

  // The step people miss: a VITE_ variable is baked in at build time, so the
  // list stays "not set up" until the next deploy.
  it("spells out that a redeploy is needed", async () => {
    renderWithProviders(<OpenOrdersCustomersView />);
    await waitFor(() => expect(screen.getByText(/Redeploy ARC/i)).toBeInTheDocument());
    expect(screen.getByText(/no effect until the next/i)).toBeInTheDocument();
  });

  it("names the script and the variable", async () => {
    renderWithProviders(<OpenOrdersCustomersView />);
    await waitFor(() =>
      expect(screen.getByText(/create-open-orders-lists\.ps1/)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/VITE_SP_OPEN_ORDERS_CUSTOMERS_LIST_ID/),
    ).toBeInTheDocument();
  });

  it("reassures that downloading still works", async () => {
    renderWithProviders(<OpenOrdersCustomersView />);
    await waitFor(() =>
      expect(screen.getByText(/keeps working meanwhile/i)).toBeInTheDocument(),
    );
  });
});

describe("OpenOrdersCustomersView — the list exists", () => {
  beforeEach(() => {
    mockConfig.listId = "a-real-list-id";
  });

  it("drops the setup notice and offers the controls", async () => {
    renderWithProviders(<OpenOrdersCustomersView />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Add customer/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/hasn't been created/i)).not.toBeInTheDocument();
  });

  it("goes back to the ordinary empty state", async () => {
    renderWithProviders(<OpenOrdersCustomersView />);
    await waitFor(() =>
      expect(screen.getByText(/Nobody on the list yet/i)).toBeInTheDocument(),
    );
  });
});
