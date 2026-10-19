import { beforeEach, describe, expect, it, vi } from "vitest";

// A new request asks SAP about its part (Ray, 2026-10-17). A live lookup this
// account can't make — requesters have no Fabric query rights — or can't
// reach must NEVER block the request: it routes as "not connected", where a
// typed SAP number is the requester's word.

const lookupSapPart = vi.hoisted(() => vi.fn());

vi.mock("@/api/pricingLookup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/pricingLookup")>();
  return { ...actual, lookupSapPart };
});

import { FabricAuthError, FabricRequestError } from "@/api/fabric";
import { PricingDataNotConnectedError } from "@/api/pricingLookup";
import { askSap } from "./usePricingRequests";

beforeEach(() => {
  lookupSapPart.mockReset();
});

const args = { altronicPartNumber: "593027-15", sapPartNumber: "2001-0310-15" };

describe("askSap", () => {
  it("passes SAP's answer through", async () => {
    lookupSapPart.mockResolvedValue({ sapPartNumber: "2001-0310-15" });
    expect(await askSap(args)).toEqual({ part: { sapPartNumber: "2001-0310-15" }, notConnected: false });
  });

  it.each([
    ["not connected", new PricingDataNotConnectedError()],
    ["refused (no query rights on the Fabric API)", new FabricRequestError("403", "http", { status: 403 })],
    ["no Fabric sign-in or consent", new FabricAuthError("silent failed", "needs-consent")],
    ["unreachable", new FabricRequestError("network", "transport")],
  ])("treats SAP %s as not connected, so the request still submits", async (_label, err) => {
    lookupSapPart.mockRejectedValue(err);
    expect(await askSap(args)).toEqual({ part: null, notConnected: true });
  });

  it("still throws a fault that isn't about reaching SAP", async () => {
    lookupSapPart.mockRejectedValue(new TypeError("a bug"));
    await expect(askSap(args)).rejects.toThrow("a bug");
  });
});
