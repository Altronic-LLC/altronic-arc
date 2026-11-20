import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetQuoteMockStores } from "@/data/quoteMockData";

const who = vi.hoisted(() => ({ emails: ["demo.user@altronic-llc.com"] as string[] }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Someone", email: who.emails[0] ?? "", lookupId: 0 }),
  useCurrentUserEmails: () => who.emails,
}));

import { QuoteCustomersView } from "./QuoteCustomersView";

const MANAGER = ["demo.user@altronic-llc.com"];
const QUOTER = ["katie.fleming@altronic-llc.com"];
const NOBODY = ["someone.else@altronic-llc.com"];

beforeEach(() => {
  __resetQuoteMockStores();
  who.emails = MANAGER;
});

function table() {
  return screen.getByRole("table");
}

describe("QuoteCustomersView", () => {
  it("lists active customers, hiding retired ones until asked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<QuoteCustomersView />, { route: "/sales/quotes/customers" });
    await waitFor(() => expect(table()).toBeInTheDocument());
    expect(within(table()).getByText("Cooper Machinery Services")).toBeInTheDocument();
    expect(within(table()).getByText("0001042")).toBeInTheDocument();
    expect(within(table()).queryByText("Hoerbiger Service Inc.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Show retired/ }));
    expect(within(table()).getByText("Hoerbiger Service Inc.")).toBeInTheDocument();
  });

  it("searches", async () => {
    const user = userEvent.setup();
    renderWithProviders(<QuoteCustomersView />);
    await waitFor(() => expect(table()).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/Name, code, customer number/), "wabtec");
    await waitFor(() =>
      expect(within(table()).queryByText("Cooper Machinery Services")).not.toBeInTheDocument(),
    );
    expect(within(table()).getByText("Wabtec Transportation Systems")).toBeInTheDocument();
  });

  it("gives a manager Add and Edit", async () => {
    const user = userEvent.setup();
    renderWithProviders(<QuoteCustomersView />);
    await waitFor(() => expect(table()).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Add customer" })).toBeInTheDocument();
    await user.click(within(table()).getByRole("button", { name: "Edit Wabtec Transportation Systems" }));
    expect(screen.getByRole("dialog", { name: "Edit customer" })).toBeInTheDocument();
  });

  it("lets a quoter read but shows no Add or Edit controls at all", async () => {
    who.emails = QUOTER;
    renderWithProviders(<QuoteCustomersView />);
    await waitFor(() => expect(table()).toBeInTheDocument());
    expect(within(table()).getByText("Cooper Machinery Services")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add customer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  });

  it("refuses somebody with no quote role", async () => {
    who.emails = NOBODY;
    renderWithProviders(<QuoteCustomersView />);
    expect(await screen.findByText("You don't have access to Insourcing Quotes.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("sorts by Code", async () => {
    const user = userEvent.setup();
    renderWithProviders(<QuoteCustomersView />);
    await waitFor(() => expect(table()).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Sort by Code" }));
    const codes = within(table())
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.querySelectorAll("td")[1]?.textContent);
    expect(codes).toEqual(["COO", "INN", "WAB"]);
  });
});
