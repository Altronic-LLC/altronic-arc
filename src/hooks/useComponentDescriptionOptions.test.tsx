import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetPartsRolesMockStore } from "@/api/partsRoles";
import {
  __resetComponentDescriptionOptionsMockStore,
  listComponentDescriptionOptions,
} from "@/api/componentDescriptionOptions";
import type { PartsRoleEntry } from "@/types/task";
import { optionsOfKind } from "@/lib/componentDescriptions";

// The description lists through the hooks — the gate is asked INSIDE each
// mutation, so no future screen can write them without it. Mock mode; the
// demo user is the actor, and the roles store is replaced per test.

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

import {
  useAddDescriptionOption,
  useDeleteDescriptionOption,
  useMoveDescriptionOption,
  useUpdateDescriptionOption,
} from "./useComponentDescriptionOptions";

const DEMO = "demo.user@altronic-llc.com";
const demoWith = (roles: PartsRoleEntry["roles"]): PartsRoleEntry[] => [
  { id: 1, email: DEMO, displayName: "Demo User", roles, note: "" },
];

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  __resetComponentDescriptionOptionsMockStore();
});

describe("who may change the description lists", () => {
  it("refuses an HCO editor — the lists are the SAP admin's and the reviewing engineers'", async () => {
    __resetPartsRolesMockStore(demoWith(["hco editor"]));
    const { result } = renderHook(() => useAddDescriptionOption(), { wrapper: wrapper() });
    await act(() =>
      expect(result.current.mutateAsync({ kind: "Description", name: "Fuse", types: [], sortOrder: 999 })).rejects.toThrow(/Only the SAP admin and the reviewing engineers/),
    );
    expect((await listComponentDescriptionOptions()).some((o) => o.name === "Fuse")).toBe(false);
  });

  it("refuses a rename and a removal too", async () => {
    __resetPartsRolesMockStore(demoWith(["editor"]));
    const update = renderHook(() => useUpdateDescriptionOption(), { wrapper: wrapper() }).result;
    const remove = renderHook(() => useDeleteDescriptionOption(), { wrapper: wrapper() }).result;
    await act(() =>
      expect(update.current.mutateAsync({ id: 1, name: "Resistors" })).rejects.toThrow(/Only the SAP admin/),
    );
    await act(() => expect(remove.current.mutateAsync(1)).rejects.toThrow(/Only the SAP admin/));
    expect((await listComponentDescriptionOptions()).find((o) => o.id === 1)?.name).toBe("Resistor");
  });

  it("lets a reviewing engineer add, and the SAP admin remove", async () => {
    __resetPartsRolesMockStore(demoWith(["reviewing engineer"]));
    const add = renderHook(() => useAddDescriptionOption(), { wrapper: wrapper() }).result;
    const created = await act(() =>
      add.current.mutateAsync({ kind: "Description", name: "Fuse", types: ["Glass"], sortOrder: 999 }),
    );
    expect(created).toMatchObject({ name: "Fuse", types: ["Glass"] });

    __resetPartsRolesMockStore(demoWith(["sap admin"]));
    const remove = renderHook(() => useDeleteDescriptionOption(), { wrapper: wrapper() }).result;
    await act(() => remove.current.mutateAsync(created.id));
    expect((await listComponentDescriptionOptions()).some((o) => o.name === "Fuse")).toBe(false);
  });
});

describe("moving an option", () => {
  it("swaps it with its neighbour, within its own kind", async () => {
    __resetPartsRolesMockStore(demoWith(["sap admin"]));
    const move = renderHook(() => useMoveDescriptionOption(), { wrapper: wrapper() }).result;
    // Seed order starts Resistor, Capacitor.
    await act(() => move.current.mutateAsync({ id: 2, direction: "up" }));
    const order = optionsOfKind(await listComponentDescriptionOptions(), "Description").map((o) => o.name);
    expect(order.slice(0, 2)).toEqual(["Capacitor", "Resistor"]);
  });

  it("does nothing at the end of the list", async () => {
    __resetPartsRolesMockStore(demoWith(["sap admin"]));
    const move = renderHook(() => useMoveDescriptionOption(), { wrapper: wrapper() }).result;
    const sil = optionsOfKind(await listComponentDescriptionOptions(), "SIL Category");
    expect(await act(() => move.current.mutateAsync({ id: sil[0].id, direction: "up" }))).toEqual([]);
  });
});
