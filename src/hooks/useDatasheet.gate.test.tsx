import { beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetPartsRolesMockStore } from "@/api/partsRoles";
import { __resetDatasheetsMockStore, findDatasheet } from "@/api/datasheets";
import { __resetAltronicComponentsMockStore } from "@/api/altronicComponents";
import type { PartsRoleEntry } from "@/types/task";
import { useUploadDatasheet } from "./useDatasheet";

// A missing datasheet from a part's page (via "edit") is open to the Add role
// as well as parts editors (Tim, 2026-09-29) — asked INSIDE the mutation, so
// a hidden button isn't the only thing standing in the way.

const DEMO = "demo.user@altronic-llc.com";
const asDemo = (roles: PartsRoleEntry["roles"]) =>
  __resetPartsRolesMockStore([{ id: 1, email: DEMO, displayName: "Demo User", roles, note: "" }]);

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], "sheet.pdf", { type: "application/pdf" });

beforeEach(() => {
  __resetDatasheetsMockStore();
  __resetAltronicComponentsMockStore();
});

describe("uploading a missing datasheet from a part's page", () => {
  it("lets the Add role do it", async () => {
    asDemo(["editor"]);
    const { result } = renderHook(() => useUploadDatasheet(), { wrapper: wrapper() });
    await act(() => result.current.mutateAsync({ partNumber: "101022", file: pdf(), via: "edit" }));
    expect(await findDatasheet("101022")).not.toBeNull();
  });

  it("refuses somebody with no role, and uploads nothing", async () => {
    asDemo([]);
    const { result } = renderHook(() => useUploadDatasheet(), { wrapper: wrapper() });
    await act(() =>
      expect(result.current.mutateAsync({ partNumber: "101022", file: pdf(), via: "edit" })).rejects.toThrow(),
    );
    expect(await findDatasheet("101022")).toBeNull();
  });

  it("refuses the Add role on the 722 list", async () => {
    asDemo(["editor"]);
    const { result } = renderHook(() => useUploadDatasheet(), { wrapper: wrapper() });
    await act(() =>
      expect(result.current.mutateAsync({ partNumber: "722044", file: pdf(), via: "edit", componentId: 15 })).rejects.toThrow(/722/),
    );
    expect(await findDatasheet("722044")).toBeNull();
  });
});
