import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS } from "@/data/mockData";
import { EirDetailView } from "./EirDetailView";

// LTB Date belongs to Supply Chain once an EIR is submitted: the New EIR form
// leaves it open so the person raising the EIR can fill one in, but on the
// detail view only the `supply chain` role may change it.

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
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

/** The LTB Date input, scoped to its sidebar row (the label isn't wired up via htmlFor). */
function ltbInput(): HTMLInputElement {
  const label = screen.getByText("LTB Date");
  const row = label.closest("div")!.parentElement as HTMLElement;
  return row.querySelector('input[type="date"]') as HTMLInputElement;
}

describe("EirDetailView — LTB Date is a Supply Chain field", () => {
  beforeEach(() => {
    roles = { isEngineer: false, isSupplyChain: false, enforced: true };
  });

  it("locks the field for someone without the Supply Chain role", async () => {
    await renderEir();
    expect(ltbInput()).toBeDisabled();
  });

  it("says why it's locked rather than just greying out", async () => {
    await renderEir();
    expect(ltbInput().title).toMatch(/supply chain/i);
    const row = screen.getByText("LTB Date").closest("div")!.parentElement as HTMLElement;
    expect(within(row).getByLabelText("Locked")).toBeInTheDocument();
  });

  it("lets a Supply Chain user edit it", async () => {
    roles = { isEngineer: false, isSupplyChain: true, enforced: true };
    await renderEir();
    expect(ltbInput()).toBeEnabled();
    expect(screen.getByText("LTB Date").parentElement).not.toHaveTextContent(/locked/i);
  });

  it("leaves the field open to everyone when role gating isn't configured", async () => {
    roles = { isEngineer: false, isSupplyChain: false, enforced: false };
    await renderEir();
    expect(ltbInput()).toBeEnabled();
  });

  // The Engineer role gates its own fields — it must not unlock this one.
  it("does not open up for an Engineer who isn't also Supply Chain", async () => {
    roles = { isEngineer: true, isSupplyChain: false, enforced: true };
    await renderEir();
    expect(ltbInput()).toBeDisabled();
  });
});
