import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const pushToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toast", () => ({ pushToast }));

import { resetEquipmentMockStore } from "@/api/operationsEquipment";
import {
  useEquipment,
  useEquipmentItem,
  useSetEquipmentAssetStatus,
  useSetEquipmentResponsibleTech,
  useSetEquipmentWarrantyExpiry,
  useUpdateEquipmentFields,
} from "./useEquipment";
import type { Equipment } from "@/types/task";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

async function loaded(wrap: ReturnType<typeof wrapper>): Promise<Equipment[]> {
  const { result } = renderHook(() => useEquipment(), { wrapper: wrap });
  await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  return result.current.data!;
}

beforeEach(() => {
  resetEquipmentMockStore();
  pushToast.mockClear();
});

describe("useEquipment", () => {
  it("loads the register and can pick one asset out", async () => {
    const wrap = wrapper();
    const assets = await loaded(wrap);
    const { result } = renderHook(() => useEquipmentItem(assets[0].lookupId), { wrapper: wrap });
    await waitFor(() => expect(result.current.data?.lookupId).toBe(assets[0].lookupId));
  });

  it("returns null for a null id", async () => {
    const wrap = wrapper();
    await loaded(wrap);
    const { result } = renderHook(() => useEquipmentItem(null), { wrapper: wrap });
    expect(result.current.data).toBeNull();
  });
});

describe("the edits a technician makes from a work order", () => {
  it("marks an asset down", async () => {
    const wrap = wrapper();
    const assets = await loaded(wrap);
    const { result } = renderHook(() => useSetEquipmentAssetStatus(), { wrapper: wrap });
    let updated: Equipment | undefined;
    await act(async () => {
      updated = await result.current.mutateAsync({
        lookupId: assets[0].lookupId,
        assetStatus: "Down",
      });
    });
    expect(updated?.assetStatus).toBe("Down");
  });

  it("moves the responsible tech", async () => {
    const wrap = wrapper();
    const assets = await loaded(wrap);
    const tech = { displayName: "Alyssa Garrett", email: "a.g@altronic-llc.com", lookupId: 63 };
    const { result } = renderHook(() => useSetEquipmentResponsibleTech(), { wrapper: wrap });
    let updated: Equipment | undefined;
    await act(async () => {
      updated = await result.current.mutateAsync({ lookupId: assets[0].lookupId, person: tech });
    });
    expect(updated?.responsibleTech).toEqual(tech);
  });

  it("corrects a warranty expiry", async () => {
    const wrap = wrapper();
    const assets = await loaded(wrap);
    const { result } = renderHook(() => useSetEquipmentWarrantyExpiry(), { wrapper: wrap });
    let updated: Equipment | undefined;
    await act(async () => {
      updated = await result.current.mutateAsync({
        lookupId: assets[0].lookupId,
        date: new Date("2027-01-31T00:00:00Z"),
      });
    });
    expect(updated?.warrantyExpiry?.toISOString()).toBe("2027-01-31T12:00:00.000Z");
  });

  it("patches arbitrary columns", async () => {
    const wrap = wrapper();
    const assets = await loaded(wrap);
    const { result } = renderHook(() => useUpdateEquipmentFields(), { wrapper: wrap });
    let updated: Equipment | undefined;
    await act(async () => {
      updated = await result.current.mutateAsync({
        lookupId: assets[0].lookupId,
        fields: { Location: "MAINTENANCE ROOM" },
      });
    });
    expect(updated?.location).toBe("MAINTENANCE ROOM");
  });

  it("reports a failure rather than failing silently", async () => {
    const wrap = wrapper();
    await loaded(wrap);
    const { result } = renderHook(() => useUpdateEquipmentFields(), { wrapper: wrap });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ lookupId: 987654, fields: { AssetStatus: "Down" } });
      }),
    ).rejects.toThrow(/not found/);
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });
});
