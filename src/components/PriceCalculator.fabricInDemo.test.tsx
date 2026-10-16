import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The dev demo with VITE_FABRIC_IN_DEMO (Ray, 2026-10-16): demo data
// everywhere, but the Calculator's cost lookup asks the LIVE Fabric view —
// never the demo's part list — and offers "Sign in to SAP" when that is all
// it needs.

const fabricQuery = vi.hoisted(() => vi.fn());
const signInToFabric = vi.hoisted(() => vi.fn());

vi.mock("@/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/config")>();
  return { ...actual, USE_MOCK: true, FABRIC_IN_DEMO: true, FABRIC_ENABLED: true };
});

vi.mock("@/api/fabric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/fabric")>();
  return { ...actual, fabricQuery, signInToFabric };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: "katie.fleming@altronic-llc.com", lookupId: 1 }),
  useCurrentUserEmails: () => ["katie.fleming@altronic-llc.com"],
}));

import { renderWithProviders } from "@/test/render";
import { __resetPricingMockStores } from "@/data/pricingMockData";
import { FabricAuthError } from "@/api/fabric";
import { needsSapSignIn, SAP_COST_LOOKUP_IS_DEMO } from "@/api/pricingLookup";
import { PriceCalculatorButton, __resetPriceCalculatorSession } from "./PriceCalculator";

beforeEach(() => {
  fabricQuery.mockReset();
  signInToFabric.mockReset();
  __resetPricingMockStores();
  __resetPriceCalculatorSession();
});

async function open() {
  renderWithProviders(<PriceCalculatorButton />);
  await userEvent.click(await screen.findByRole("button", { name: "Price calculator" }));
  return within(screen.getByRole("dialog", { name: "Price calculator" }));
}

describe("Calculator in the dev demo with live Fabric", () => {
  it("isn't the demo's lookup any more, and treats a missing sign-in as something to offer", () => {
    expect(SAP_COST_LOOKUP_IS_DEMO).toBe(false);
    expect(needsSapSignIn(new FabricAuthError("no account", "not-signed-in"))).toBe(true);
    expect(needsSapSignIn(new FabricAuthError("no consent", "needs-consent"))).toBe(true);
    expect(needsSapSignIn(new FabricAuthError("password expired", "account"))).toBe(false);
  });

  it("offers Sign in to SAP, then brings the live cost in", async () => {
    fabricQuery.mockRejectedValueOnce(new FabricAuthError("Not signed in.", "not-signed-in"));
    fabricQuery.mockResolvedValue({
      vw_cogs_material_apis: {
        items: [{ Plant: "4222", Material: "1000-1644-00", MaterialDescription: "I.C., 74HC4051N", UnitCost: 0.2495 }],
      },
    });
    signInToFabric.mockResolvedValue(undefined);

    const dialog = await open();
    await userEvent.type(dialog.getByLabelText("SAP part number"), "1000164400{Enter}");
    expect(await dialog.findByText("Sign in to SAP to bring in the live cost — or type it.")).toBeInTheDocument();

    await userEvent.click(dialog.getByRole("button", { name: "Sign in to SAP" }));
    expect(signInToFabric).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(dialog.getByLabelText("COGS")).toHaveValue(0.2495));
    expect(dialog.getByLabelText("Description")).toHaveValue("I.C., 74HC4051N");
    expect(dialog.queryByRole("button", { name: "Sign in to SAP" })).toBeNull();
    // It asked the live view, not the demo's part list.
    expect(fabricQuery.mock.calls.at(-1)?.[1]).toEqual({ sap: "1000-1644-00" });
  });

  it("says SAP doesn't have a part the live view doesn't hold — not 'not in the demo data'", async () => {
    fabricQuery.mockResolvedValue({ vw_cogs_material_apis: { items: [] } });
    const dialog = await open();
    await userEvent.type(dialog.getByLabelText("SAP part number"), "9999000000{Enter}");
    expect(await dialog.findByText("SAP doesn't have 9999-0000-00.")).toBeInTheDocument();
  });
});
