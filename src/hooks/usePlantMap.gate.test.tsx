import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// The Plant Map's writes ask their gate INSIDE the mutationFn, in REAL mode —
// so no future screen can reach the API ungated. Starting a layout: an editor
// or a Plant Map admin. The roles list: a Plant Map admin or an ARC admin —
// and an ARC admin gets ONLY that, not the drawing rights.

const roles = vi.hoisted(() => ({ rows: [] as unknown[] }));
const admins = vi.hoisted(() => ({ rows: [] as unknown[] }));
const api = vi.hoisted(() => ({ createLayout: vi.fn(), createRole: vi.fn(), createSymbol: vi.fn() }));

vi.mock("@/api/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/config")>()),
  USE_MOCK: false,
}));
vi.mock("@/api/plantMapRoles", () => ({
  listPlantMapRoleEntries: vi.fn(async () => roles.rows),
  createPlantMapRoleEntry: api.createRole,
  updatePlantMapRoleEntry: vi.fn(),
  deletePlantMapRoleEntry: vi.fn(),
}));
vi.mock("@/api/plantLayouts", () => ({
  createPlantLayout: api.createLayout,
  getPlantLayout: vi.fn(),
  listPlantLayouts: vi.fn(async () => []),
}));
vi.mock("@/api/layoutComponents", () => ({
  createLayoutComponent: api.createSymbol,
  listLayoutComponents: vi.fn(async () => []),
}));
vi.mock("@/api/admins", () => ({ listAdmins: vi.fn(async () => admins.rows) }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Me", email: "me@example.com" }),
  useCurrentUserEmails: () => ["me@example.com"],
}));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

import { useCreateLayoutComponent, useCreatePlantLayout } from "./usePlantLayouts";
import { useCreatePlantMapRoleEntry } from "./usePlantMapRoles";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const LAYOUT = { building: "Main", title: "Main", area: "", walls: { kind: "upload" as const, svg: "<svg/>", fileName: "m.svg" }, extent: { w: 10, h: 10 } };
const PERSON = { email: "new@example.com", displayName: "New", roles: ["editor" as const], note: "" };
const me = (tags: string[]) => ({ id: 1, email: "me@example.com", displayName: "Me", roles: tags, note: "" });

beforeEach(() => {
  roles.rows = [];
  admins.rows = [];
  api.createLayout.mockReset().mockResolvedValue({ id: 9, doc: { items: [] } });
  api.createRole.mockReset().mockImplementation(async (input) => ({ id: 2, ...input }));
  api.createSymbol.mockReset();
});

describe("starting a layout", () => {
  it("is refused to somebody not on the roles list, and nothing is written", async () => {
    const { result } = renderHook(() => useCreatePlantLayout(), { wrapper });
    await act(() => expect(result.current.mutateAsync(LAYOUT)).rejects.toThrow(/Only a Plant Map editor/));
    expect(api.createLayout).not.toHaveBeenCalled();
  });

  it("is refused to an ARC admin who holds no Plant Map role", async () => {
    admins.rows = [{ id: 1, email: "me@example.com", displayName: "Me" }];
    const { result } = renderHook(() => useCreatePlantLayout(), { wrapper });
    await act(() => expect(result.current.mutateAsync(LAYOUT)).rejects.toThrow(/Only a Plant Map editor/));
    expect(api.createLayout).not.toHaveBeenCalled();
  });

  it("goes through for an editor", async () => {
    roles.rows = [me(["editor"])];
    const { result } = renderHook(() => useCreatePlantLayout(), { wrapper });
    await act(() => result.current.mutateAsync(LAYOUT));
    expect(api.createLayout).toHaveBeenCalledWith(LAYOUT);
  });
});

describe("the roles list", () => {
  it("is refused to an editor", async () => {
    roles.rows = [me(["editor"])];
    const { result } = renderHook(() => useCreatePlantMapRoleEntry(), { wrapper });
    await act(() => expect(result.current.mutateAsync(PERSON)).rejects.toThrow(/Plant Map admin or an ARC admin/));
    expect(api.createRole).not.toHaveBeenCalled();
  });

  it("is open to an ARC admin, so a list nobody manages is never locked from the inside", async () => {
    admins.rows = [{ id: 1, email: "me@example.com", displayName: "Me" }];
    const { result } = renderHook(() => useCreatePlantMapRoleEntry(), { wrapper });
    await act(() => result.current.mutateAsync(PERSON));
    expect(api.createRole).toHaveBeenCalledWith(PERSON);
  });

  it("is open to a Plant Map admin", async () => {
    roles.rows = [me(["admin"])];
    const { result } = renderHook(() => useCreatePlantMapRoleEntry(), { wrapper });
    await act(() => result.current.mutateAsync(PERSON));
    expect(api.createRole).toHaveBeenCalled();
  });
});

describe("adding a symbol", () => {
  const SYMBOL = {
    title: "Router",
    key: "router-96x48",
    category: "Machine" as const,
    svgMarkup: "<svg/>",
    footprintW: 96,
    footprintD: 48,
    allowResize: false,
    allowRotate: true,
    minScale: 1,
    maxScale: 1,
    collides: true,
    clearance: 0,
  };

  it("is refused to an editor and to an ARC admin, and nothing is written", async () => {
    roles.rows = [me(["editor"])];
    admins.rows = [{ id: 1, email: "me@example.com", displayName: "Me" }];
    const { result } = renderHook(() => useCreateLayoutComponent(), { wrapper });
    await act(() => expect(result.current.mutateAsync(SYMBOL)).rejects.toThrow(/Only a Plant Map admin can add symbols/));
    expect(api.createSymbol).not.toHaveBeenCalled();
  });

  it("is allowed to a Plant Map admin", async () => {
    roles.rows = [me(["admin"])];
    api.createSymbol.mockResolvedValue({ ...SYMBOL, id: 13, version: 1, active: true });
    const { result } = renderHook(() => useCreateLayoutComponent(), { wrapper });
    await act(() => result.current.mutateAsync(SYMBOL));
    expect(api.createSymbol).toHaveBeenCalledWith(SYMBOL);
  });
});
