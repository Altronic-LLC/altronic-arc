import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { __resetQuoteMockStores, MOCK_QUOTES } from "@/data/quoteMockData";
import { latestRevisions } from "@/lib/quoteNumber";

// =============================================================================
// The Insourcing Quotes card is shown ONLY to someone holding a quote role —
// no role, no card (not a locked one, not a placeholder).
// =============================================================================

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

const who = vi.hoisted(() => ({ emails: ["demo.user@altronic-llc.com"] as string[] }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Someone", email: who.emails[0] ?? "", lookupId: 0 }),
  useCurrentUserEmails: () => who.emails,
}));

import { DashboardView } from "./DashboardView";

beforeEach(() => {
  __resetQuoteMockStores();
});

function supplyChainGrid() {
  const heading = screen.getByRole("heading", { name: "Supply Chain", level: 2 });
  return within(heading.closest("section") as HTMLElement).getByTestId("dept-cards");
}

describe("DashboardView — Insourcing Quotes card", () => {
  it("is shown, with the open-quote count, to someone with a quote role", async () => {
    who.emails = ["brandon.mirto@altronic-llc.com"]; // a viewer
    renderWithProviders(<DashboardView />);
    const expected = latestRevisions(MOCK_QUOTES).filter(
      (q) => q.status === "Draft" || q.status === "Sent",
    ).length;
    const card = await waitFor(() => within(supplyChainGrid()).getByRole("button", { name: /Insourcing Quotes/ }));
    await waitFor(() => expect(card).toHaveTextContent(String(expected)));
  });

  it("is absent for somebody with no quote role — even an ARC admin", async () => {
    who.emails = ["ray.white@altronic-llc.com"];
    renderWithProviders(<DashboardView />);
    await waitFor(() => expect(within(supplyChainGrid()).getByRole("button", { name: /SCNs/ })).toBeInTheDocument());
    // Give the roles list time to answer, then confirm it never appeared.
    await new Promise((r) => setTimeout(r, 50));
    expect(within(supplyChainGrid()).queryByText("Insourcing Quotes")).not.toBeInTheDocument();
  });
});
