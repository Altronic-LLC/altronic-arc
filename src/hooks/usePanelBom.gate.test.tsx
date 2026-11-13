import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// The BOM Builder's writes ask the panel gates INSIDE their mutationFn, in
// REAL mode (demo mode always allows) — so no future screen can reach the API
// ungated. Changing the parts list: Super User or ARC admin. Saving a BOM:
// anyone on the panel team but a Viewer.

const roles = vi.hoisted(() => ({ rows: [] as unknown[] }));
const api = vi.hoisted(() => ({ createPart: vi.fn(), createBom: vi.fn() }));
const live = vi.hoisted(() => ({ on: true }));

vi.mock("@/api/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/config")>()),
  USE_MOCK: false,
  get PANEL_BOM_LIVE() {
    return live.on;
  },
}));
vi.mock("@/api/panelRoles", () => ({
  listPanelRoles: vi.fn(async () => roles.rows),
  addPanelRole: vi.fn(),
  updatePanelRole: vi.fn(),
  removePanelRole: vi.fn(),
}));
vi.mock("@/api/admins", () => ({ listAdmins: vi.fn(async () => []) }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Me", email: "me@example.com" }),
  useCurrentUserEmails: () => ["me@example.com"],
}));
vi.mock("./useIsAdmin", () => ({
  useIsAdmin: () => false,
  useAdminAccess: () => ({ isAdmin: false, isResolving: false }),
}));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/api/panelBomParts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/panelBomParts")>()),
  createPanelBomPart: api.createPart,
}));
vi.mock("@/api/panelBoms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/panelBoms")>()),
  createPanelBom: api.createBom,
}));

import { useSavePanelBom, useSavePanelBomPart } from "./usePanelBom";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const ME = { displayName: "Me", email: "me@example.com" };
const PART = {
  sapPartNumber: "9000-0001-00",
  altronicPartNumber: "",
  description: "Thing",
  cluster: 1,
  category: "",
  standard: false,
  preferred: false,
  doNotQuote: false,
  datasheet: "",
  qtyIfUsed: null,
  active: true,
};
const BOM = {
  panelSystemNumber: "PS-1",
  notes: "",
  panelOrderId: null,
  picks: { parts: { "9000-0001-00": 1 }, kits: {} },
  result: { lines: [{ item: 1000, qty: 1, sapPartNumber: "9000-0001-00", description: "Thing", cluster: 1 }], manual: [] },
};

beforeEach(() => {
  roles.rows = [];
  live.on = true;
  api.createPart.mockReset().mockResolvedValue({ ...PART, id: 1 });
  api.createBom.mockReset().mockResolvedValue({ id: 1, panelSystemNumber: "PS-1" });
});

describe("useSavePanelBomPart", () => {
  it("refuses an Engineer before anything is written", async () => {
    roles.rows = [{ id: 1, user: ME, role: "Engineer", note: "" }];
    const { result } = renderHook(() => useSavePanelBomPart(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ id: null, input: PART })).rejects.toThrow(/Super User/));
    expect(api.createPart).not.toHaveBeenCalled();
  });

  it("lets a Super User add a part", async () => {
    roles.rows = [{ id: 1, user: ME, role: "Super User", note: "" }];
    const { result } = renderHook(() => useSavePanelBomPart(), { wrapper });
    await act(() => result.current.mutateAsync({ id: null, input: PART }));
    expect(api.createPart).toHaveBeenCalledWith(PART);
  });
});

describe("useSavePanelBom", () => {
  it("refuses a Viewer", async () => {
    roles.rows = [{ id: 1, user: ME, role: "Viewer", note: "" }];
    const { result } = renderHook(() => useSavePanelBom(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ id: null, input: BOM })).rejects.toThrow(/Viewers/));
    expect(api.createBom).not.toHaveBeenCalled();
  });

  it("lets an Engineer save, and refuses a BOM with no Panel System #", async () => {
    roles.rows = [{ id: 1, user: ME, role: "Engineer", note: "" }];
    const { result } = renderHook(() => useSavePanelBom(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ id: null, input: { ...BOM, panelSystemNumber: " " } })).rejects.toThrow(/Panel System #/));
    await act(() => result.current.mutateAsync({ id: null, input: BOM }));
    expect(api.createBom).toHaveBeenCalledTimes(1);
  });
});

describe("the limited live demo (PANEL_BOM_LIVE off)", () => {
  it("refuses an Engineer's save and lets a Super User's through", async () => {
    live.on = false;
    roles.rows = [{ id: 1, user: ME, role: "Engineer", note: "" }];
    const a = renderHook(() => useSavePanelBom(), { wrapper });
    await act(() => expect(a.result.current.mutateAsync({ id: null, input: BOM })).rejects.toThrow(/limited preview/));
    expect(api.createBom).not.toHaveBeenCalled();
    roles.rows = [{ id: 1, user: ME, role: "Super User", note: "" }];
    const b = renderHook(() => useSavePanelBom(), { wrapper });
    await act(() => b.result.current.mutateAsync({ id: null, input: BOM }));
    expect(api.createBom).toHaveBeenCalledTimes(1);
  });
});
