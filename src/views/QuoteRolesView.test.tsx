import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetQuoteMockStores, quoteMockDb } from "@/data/quoteMockData";

const who = vi.hoisted(() => ({ emails: ["demo.user@altronic-llc.com"] as string[] }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Someone", email: who.emails[0] ?? "", lookupId: 0 }),
  useCurrentUserEmails: () => who.emails,
}));
vi.mock("@/hooks/useDirectory", () => ({ useDirectoryPeople: () => [] }));

import { QuoteRolesView } from "./QuoteRolesView";

const MANAGER = ["demo.user@altronic-llc.com"];
const QUOTER = ["katie.fleming@altronic-llc.com"];
// A bootstrap ARC admin who holds NO quote role.
const ARC_ADMIN = ["ray.white@altronic-llc.com"];

beforeEach(() => {
  __resetQuoteMockStores();
  who.emails = MANAGER;
});

async function waitForTable() {
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return screen.getByRole("table");
}

describe("QuoteRolesView — who may manage", () => {
  it("refuses a quoter", async () => {
    who.emails = QUOTER;
    renderWithProviders(<QuoteRolesView />);
    expect(await screen.findByText("You can't manage quote roles.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add person/ })).not.toBeInTheDocument();
  });

  it("lets a quote manager manage", async () => {
    renderWithProviders(<QuoteRolesView />);
    const t = await waitForTable();
    expect(within(t).getByText("Katie Fleming")).toBeInTheDocument();
    expect(within(t).getByText("Quoter")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add person/ })).toBeInTheDocument();
  });

  it("lets an ARC admin with no quote role manage", async () => {
    who.emails = ARC_ADMIN;
    renderWithProviders(<QuoteRolesView />);
    await waitForTable();
    expect(screen.getByRole("button", { name: /Add person/ })).toBeInTheDocument();
  });

  it("explains each role, including that a viewer never sees cost", async () => {
    renderWithProviders(<QuoteRolesView />);
    await waitForTable();
    expect(screen.getByText(/never sees cost or margin/)).toBeInTheDocument();
  });
});

describe("QuoteRolesView — writes", () => {
  it("adds a person by email with their roles", async () => {
    const user = userEvent.setup();
    renderWithProviders(<QuoteRolesView />);
    await waitForTable();
    await user.click(screen.getByRole("button", { name: /Add person/ }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Enter an email manually/ }));
    await user.type(within(dialog).getByLabelText("Email"), "new.person@altronic-llc.com");
    await user.type(within(dialog).getByLabelText("Name"), "New Person");
    await user.click(within(dialog).getByRole("checkbox", { name: /^Viewer/ }));
    await user.click(within(dialog).getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const row = quoteMockDb.roles.find((r) => r.email === "new.person@altronic-llc.com");
    expect(row?.roles).toEqual(["viewer"]);
  });

  it("edits a person's roles", async () => {
    const user = userEvent.setup();
    renderWithProviders(<QuoteRolesView />);
    const t = await waitForTable();
    await user.click(within(t).getByRole("button", { name: "Edit Katie Fleming" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: /^Manager/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(quoteMockDb.roles.find((r) => r.displayName === "Katie Fleming")?.roles).toEqual(["quoter", "manager"]);
  });

  it("removes a person after confirming", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<QuoteRolesView />);
    const t = await waitForTable();
    await user.click(within(t).getByRole("button", { name: "Remove Brandon Mirto" }));
    await waitFor(() => expect(quoteMockDb.roles.some((r) => r.displayName === "Brandon Mirto")).toBe(false));
  });
});
