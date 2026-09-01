import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const pushToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toast", () => ({ pushToast }));

// Every equipment write asks `manageAssetsGate` inside its `mutationFn`. That
// rule is NOT what this file is about — it has its own file
// (useEquipment.guard.test.tsx), which mocks the roles LIST and runs the real
// gate. Here access is simply granted, so nothing below depends on the roles
// list loading.
vi.mock("./useMaintenanceRoles", () => ({
  useMyMaintenanceRoles: () => ({
    isTech: true,
    isAdmin: true,
    enforced: true,
    isResolving: false,
  }),
  useResolveMaintenanceAccess: () => async () => ({
    isTech: true,
    isAdmin: true,
    enforced: true,
    isResolving: false,
  }),
}));

import { resetEquipmentMockStore } from "@/api/operationsEquipment";
import {
  useEquipment,
  useEquipmentItem,
  useSetEquipmentAssetStatus,
  useSetEquipmentMachineHours,
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
        // Location is a single LOOKUP since 2026-08-28 — a bare lookupId, and
        // the title comes back resolved against the reference list.
        fields: { LocationRefLookupId: 35 },
      });
    });
    expect(updated?.location).toEqual({ lookupId: 35, title: "MAINTENANCE ROOM" });
  });

  it("records the hourmeter reading, and tells blank apart from zero", async () => {
    const wrap = wrapper();
    const assets = await loaded(wrap);
    const { result } = renderHook(() => useSetEquipmentMachineHours(), { wrapper: wrap });

    let updated: Equipment | undefined;
    await act(async () => {
      updated = await result.current.mutateAsync({ lookupId: assets[0].lookupId, hours: 5120 });
    });
    expect(updated?.currentMachineHours).toBe(5120);

    // Zero is a READING. It must survive as 0 rather than collapsing into the
    // "never recorded" null, or a freshly-installed machine looks unread.
    await act(async () => {
      updated = await result.current.mutateAsync({ lookupId: assets[0].lookupId, hours: 0 });
    });
    expect(updated?.currentMachineHours).toBe(0);

    await act(async () => {
      updated = await result.current.mutateAsync({ lookupId: assets[0].lookupId, hours: null });
    });
    expect(updated?.currentMachineHours).toBeNull();
  });

  it("stamps the row as modified, so the register's staleness column moves", async () => {
    const wrap = wrapper();
    const assets = await loaded(wrap);
    const before = assets[0].modifiedAt;
    const { result } = renderHook(() => useSetEquipmentMachineHours(), { wrapper: wrap });
    let updated: Equipment | undefined;
    await act(async () => {
      updated = await result.current.mutateAsync({ lookupId: assets[0].lookupId, hours: 77 });
    });
    expect(updated?.modifiedAt?.getTime()).toBeGreaterThan(before?.getTime() ?? 0);
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
