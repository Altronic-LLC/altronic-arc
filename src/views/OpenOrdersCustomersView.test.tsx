import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
const mockAccounts = vi.hoisted(() => ({
  rows: [] as Array<{
    id: number;
    accountNumber: string;
    customerName: string;
    active: boolean;
    notes: string;
  }>,
}));

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

const generateOne = vi.hoisted(() => vi.fn());
const mockAccess = vi.hoisted(() => ({
  value: {
    isReportManager: true,
    canAddOrRemove: true,
    enforced: false,
    isResolving: false,
  },
}));

vi.mock("@/hooks/useOpenOrdersReports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useOpenOrdersReports")>();
  return {
    ...actual,
    useParseExtract: () => ({ parse: vi.fn(), parsing: false }),
    useGenerateCustomerReport: () => ({
      mutate: generateOne,
      isPending: false,
      step: null,
      variables: undefined,
    }),
  };
});

vi.mock("@/hooks/useOpenOrdersCustomers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useOpenOrdersCustomers")>();
  return {
    ...actual,
    useMyOpenOrdersAccess: () => mockAccess.value,
    useOpenOrdersCustomers: () => ({
      data: mockAccounts.rows,
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
  mockAccounts.rows = [];
  mockAccess.value = {
    isReportManager: true,
    canAddOrRemove: true,
    enforced: false,
    isResolving: false,
  };
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

describe("building one customer's report after the week has run", () => {
  const ACCOUNTS = [
    { id: 1, accountNumber: "1042", customerName: "Permian Midstream", active: true, notes: "" },
    { id: 2, accountNumber: "7788", customerName: "Retired Account", active: false, notes: "" },
  ];

  beforeEach(() => {
    mockConfig.listId = "a-real-list-id";
    generateOne.mockClear();
    mockAccounts.rows = ACCOUNTS;
  });

  // The question this feature answers: somebody is added on a Thursday, after
  // the week was built. Without it, the only way to get their file is to find
  // the extract and rebuild all seventy.
  it("offers Build report on an active customer", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpenOrdersCustomersView />);
    const buttons = await screen.findAllByRole("button", { name: /Build report/i });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    expect(generateOne).toHaveBeenCalledWith(
      expect.objectContaining({ accountNumber: "1042" }),
    );
  });

  // An inactive account is off the weekly run; offering to build them a file
  // would contradict that.
  it("doesn't offer it on an inactive customer", async () => {
    renderWithProviders(<OpenOrdersCustomersView />);
    await screen.findByText("Retired Account");
    // Two customers on screen, one button — the active one's.
    expect(screen.getAllByRole("button", { name: /Build report/i })).toHaveLength(1);
  });

  it("explains what the button is for", async () => {
    renderWithProviders(<OpenOrdersCustomersView />);
    await waitFor(() =>
      expect(screen.getByText(/after this week was already built/i)).toBeInTheDocument(),
    );
  });
});

describe("adding and removing is admin-only", () => {
  const ACCOUNTS = [
    { id: 1, accountNumber: "1042", customerName: "Permian Midstream", active: true, notes: "" },
  ];

  beforeEach(() => {
    mockConfig.listId = "a-real-list-id";
    mockAccounts.rows = ACCOUNTS;
  });

  it("offers Add, Import and Remove to an admin", async () => {
    renderWithProviders(<OpenOrdersCustomersView />);
    expect(await screen.findByRole("button", { name: /Add customer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import from an extract/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Remove /i })).toBeInTheDocument();
  });

  // Ray, 2026-08-25. Narrower than editing on purpose: who receives an external
  // report is a different decision from correcting a name.
  it("hides Add, Import and Remove from a non-admin", async () => {
    mockAccess.value = {
      isReportManager: true,
      canAddOrRemove: false,
      enforced: false,
      isResolving: false,
    };
    renderWithProviders(<OpenOrdersCustomersView />);
    await screen.findByText("Permian Midstream");
    expect(screen.queryByRole("button", { name: /Add customer/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Import from an extract/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove /i })).not.toBeInTheDocument();
  });

  // Editing is still theirs — and it's the way to take somebody off the run
  // without needing delete, which is the whole reason the split is safe.
  it("still lets a non-admin edit somebody already on the list", async () => {
    mockAccess.value = {
      isReportManager: true,
      canAddOrRemove: false,
      enforced: false,
      isResolving: false,
    };
    renderWithProviders(<OpenOrdersCustomersView />);
    expect(await screen.findByRole("button", { name: /^Edit /i })).toBeInTheDocument();
  });

  it("says why the buttons aren't there, rather than just showing fewer", async () => {
    mockAccess.value = {
      isReportManager: true,
      canAddOrRemove: false,
      enforced: false,
      isResolving: false,
    };
    renderWithProviders(<OpenOrdersCustomersView />);
    await waitFor(() =>
      expect(screen.getByText(/limited to admins/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/not active/i)).toBeInTheDocument();
  });
});
