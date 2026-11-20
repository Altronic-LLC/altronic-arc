import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS } from "@/data/mockData";
import { getEir } from "@/api/eirs";
import { EirDetailView } from "./EirDetailView";

// BusinessIT#23: the stock and cost from when an EIR was raised are the
// INITIAL pair (the old "Current" columns), and Supply Chain keeps a CURRENT
// pair up to date beside them. BusinessIT#72: the EIR number leads the page.

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

let roles = { isEngineer: false, isSupplyChain: false, enforced: true };
vi.mock("@/hooks/useEirRoles", () => ({
  useMyEirRoles: () => roles,
}));

const EIR = MOCK_EIRS[0];

async function renderEir() {
  const result = renderWithProviders(<EirDetailView />, {
    route: `/eir/${EIR.id}`,
    routePattern: "/eir/:id",
  });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  return result;
}

const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("EirDetailView — initial and current stock and cost", () => {
  beforeEach(() => {
    roles = { isEngineer: false, isSupplyChain: false, enforced: true };
  });

  it("shows the raised-with figures as Initial and the up-to-date ones as Current", async () => {
    await renderEir();
    expect(box("Initial Stock").value).toBe(EIR.currentStock);
    expect(box("Initial Cost").value).toBe(EIR.currentPrice);
    expect(box("Current Stock").value).toBe(EIR.latestStock);
    expect(box("Current Cost").value).toBe(EIR.latestCost);
    // The fixture must actually differ, or the test can't tell the pairs apart.
    expect(EIR.latestStock).not.toBe(EIR.currentStock);
  });

  it("locks Current Stock and Current Cost for someone without the Supply Chain role", async () => {
    await renderEir();
    expect(box("Current Stock")).toBeDisabled();
    expect(box("Current Cost")).toBeDisabled();
    expect(box("Current Stock").title).toMatch(/supply chain/i);
    // The Initial pair is not role-gated.
    expect(box("Initial Stock")).toBeEnabled();
  });

  it("lets a Supply Chain user update Current Stock, written to its own column", async () => {
    roles = { isEngineer: false, isSupplyChain: true, enforced: true };
    const user = userEvent.setup();
    await renderEir();
    const current = box("Current Stock");
    expect(current).toBeEnabled();

    await user.clear(current);
    await user.type(current, "12");
    await user.tab();

    await waitFor(async () => expect((await getEir(EIR.id))?.latestStock).toBe("12"));
    // The Initial figure is untouched.
    expect((await getEir(EIR.id))?.currentStock).toBe(EIR.currentStock);
  });

  it("leads the page with the EIR number in large type", async () => {
    await renderEir();
    const number = screen.getByText(EIR.eirNo);
    expect(number.tagName).toBe("P");
    expect(number.className.split(" ")).toContain("text-2xl");
  });
});
