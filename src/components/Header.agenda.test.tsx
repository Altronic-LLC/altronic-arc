import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { Header } from "./Header";

// The header's My Agenda button (BusinessIT#13). The count itself is pinned in
// lib/agenda.test.ts (agendaAttentionCount); this pins the three states the
// BADGE has: not loaded yet (no badge, not "0"), nothing due (no badge), and a
// count — in BOTH header clusters, since a button in only one is invisible on
// the other form factor.

let count: number | null = null;
vi.mock("@/hooks/useAgenda", () => ({
  useAgendaAttentionCount: () => count,
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

beforeEach(() => {
  count = null;
});

describe("Header — My agenda", () => {
  it("links to /agenda from both the phone and desktop clusters", () => {
    renderWithProviders(<Header />);
    const links = screen.getAllByRole("link", { name: "My agenda" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/agenda");
  });

  it("shows no badge until the lists have loaded", () => {
    renderWithProviders(<Header />);
    expect(screen.queryByTestId("agenda-badge")).not.toBeInTheDocument();
  });

  it("shows no badge when nothing is overdue or due today", () => {
    count = 0;
    renderWithProviders(<Header />);
    expect(screen.queryByTestId("agenda-badge")).not.toBeInTheDocument();
  });

  it("shows the count, and says it in the accessible name", () => {
    count = 4;
    renderWithProviders(<Header />);
    const links = screen.getAllByRole("link", { name: "My agenda — 4 overdue or due today" });
    expect(links).toHaveLength(2);
    expect(within(links[0]).getByTestId("agenda-badge")).toHaveTextContent("4");
  });

  it("caps a large count at 99+", () => {
    count = 140;
    renderWithProviders(<Header />);
    expect(screen.getAllByTestId("agenda-badge")[0]).toHaveTextContent("99+");
  });
});
