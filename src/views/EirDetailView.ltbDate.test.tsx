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

/** The LTB Date picker's trigger button. */
function ltbTrigger(): HTMLButtonElement {
  return screen.getByRole("button", { name: "LTB Date" }) as HTMLButtonElement;
}

describe("EirDetailView — LTB Date is a Supply Chain field", () => {
  beforeEach(() => {
    roles = { isEngineer: false, isSupplyChain: false, enforced: true };
  });

  it("locks the field for someone without the Supply Chain role", async () => {
    await renderEir();
    expect(ltbTrigger()).toBeDisabled();
  });

  it("says why it's locked rather than just greying out", async () => {
    await renderEir();
    expect(ltbTrigger().title).toMatch(/supply chain/i);
    const row = screen.getByText("LTB Date").closest("div")!.parentElement as HTMLElement;
    expect(within(row).getByLabelText("Locked")).toBeInTheDocument();
  });

  it("lets a Supply Chain user edit it", async () => {
    roles = { isEngineer: false, isSupplyChain: true, enforced: true };
    await renderEir();
    expect(ltbTrigger()).toBeEnabled();
  });

  it("leaves the field open to everyone when role gating isn't configured", async () => {
    roles = { isEngineer: false, isSupplyChain: false, enforced: false };
    await renderEir();
    expect(ltbTrigger()).toBeEnabled();
  });

  // The Engineer role gates its own fields — it must not unlock this one.
  it("does not open up for an Engineer who isn't also Supply Chain", async () => {
    roles = { isEngineer: true, isSupplyChain: false, enforced: true };
    await renderEir();
    expect(ltbTrigger()).toBeDisabled();
  });

  // Regression: a half-typed year ("0002-05-01") used to be PATCHed straight
  // through and came back as "Graph 404 Not Found". The date is now picked from
  // a calendar, so there is no text entry to half-type into.
  it("offers no typable date input at all", async () => {
    roles = { isEngineer: false, isSupplyChain: true, enforced: true };
    const { container } = await renderEir();
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(container.querySelector('input[type="text"]')).toBeNull();
  });
});
