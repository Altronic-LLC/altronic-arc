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
const api = vi.hoisted(() => ({
  createLayout: vi.fn(),
  createRole: vi.fn(),
  createSymbol: vi.fn(),
  replaceSymbol: vi.fn(),
  getLayout: vi.fn(),
  publish: vi.fn(),
  remove: vi.fn(),
  writeFile: vi.fn(),
}));

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
  getPlantLayout: api.getLayout,
  publishPlantLayout: api.publish,
  deletePlantLayout: api.remove,
  listPlantLayouts: vi.fn(async () => []),
}));
vi.mock("@/api/layoutComponents", () => ({
  createLayoutComponent: api.createSymbol,
  replaceLayoutComponent: api.replaceSymbol,
  listLayoutComponents: vi.fn(async () => []),
}));
vi.mock("@/api/admins", () => ({ listAdmins: vi.fn(async () => admins.rows) }));
vi.mock("@/api/plantLayoutFiles", () => ({
  writePublishedFile: api.writeFile,
  readWallsFile: vi.fn(async () => ""),
  findPublishedFiles: vi.fn(async () => ({})),
  readPublishedFile: vi.fn(async () => ""),
}));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Me", email: "me@example.com" }),
  useCurrentUserEmails: () => ["me@example.com"],
}));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

import {
  useCreateLayoutComponent,
  useCreatePlantLayout,
  useDeletePlantLayout,
  usePublishPlantLayout,
  useReplaceLayoutComponent,
  useWritePublishedFiles,
} from "./usePlantLayouts";
import { pushToast } from "@/components/Toast";
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
  api.replaceSymbol.mockReset();
  api.getLayout.mockReset();
  api.publish.mockReset().mockResolvedValue({ layout: { id: 5, version: 2 }, superseded: [], warnings: [] });
  api.writeFile.mockReset().mockImplementation(async (name: string) => ({ name, webUrl: "", size: 1, modifiedAt: null }));
  vi.mocked(pushToast).mockClear();
  api.remove.mockReset().mockResolvedValue({ layout: { id: 5, version: 2, title: "Main", wallsFileId: "F1" }, wallsDeleted: true, wallsKeptFor: [], warnings: [] });
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

const SYMBOL_BASE = {
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
    await act(() => expect(result.current.mutateAsync(SYMBOL)).rejects.toThrow(/Only a Plant Map admin can add or replace symbols/));
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

describe("replacing a symbol", () => {
  const { key: _key, ...INPUT } = { ...SYMBOL_BASE, key: "" };
  const previous = { ...SYMBOL_BASE, id: 4, svgMarkup: "<svg/>", collisionPolygon: null, version: 1, active: true };

  it("is refused to an editor and to an ARC admin, and nothing is written", async () => {
    roles.rows = [me(["editor"])];
    admins.rows = [{ id: 1, email: "me@example.com", displayName: "Me" }];
    const { result } = renderHook(() => useReplaceLayoutComponent(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ previous, input: INPUT })).rejects.toThrow(/Only a Plant Map admin/));
    expect(api.replaceSymbol).not.toHaveBeenCalled();
  });

  it("is allowed to a Plant Map admin", async () => {
    roles.rows = [me(["admin"])];
    api.replaceSymbol.mockResolvedValue({ ...previous, id: 14, version: 2 });
    const { result } = renderHook(() => useReplaceLayoutComponent(), { wrapper });
    await act(() => result.current.mutateAsync({ previous, input: INPUT }));
    expect(api.replaceSymbol).toHaveBeenCalledWith(previous, INPUT);
  });
});

describe("publishing a layout", () => {
  // No walls file, so the only keep-out is the layout's own no-go area at x 80…100.
  const layout = (x: number) => ({
    id: 5,
    status: "Draft",
    wallsFileId: "",
    doc: {
      extent: { w: 100, h: 50 },
      items: [{ uid: "i1", componentId: 1, x, y: 25, w: 10, d: 10, rot: 0, label: "Bench" }],
      areas: [{ uid: "a_1", kind: "no-go", x: 90, y: 25, w: 20, d: 20, rot: 0, label: "" }],
    },
  });

  it("is refused to an editor, and nothing is written", async () => {
    roles.rows = [me(["editor"])];
    api.getLayout.mockResolvedValue(layout(50));
    const { result } = renderHook(() => usePublishPlantLayout(), { wrapper });
    await act(() => expect(result.current.mutateAsync(5)).rejects.toThrow(/Only a Plant Map admin can publish/));
    expect(api.publish).not.toHaveBeenCalled();
  });

  it("checks the layout AGAIN before writing — a problem refuses it, whatever the page showed", async () => {
    roles.rows = [me(["admin"])];
    api.getLayout.mockResolvedValue(layout(88)); // the bench sits in the no-go area
    const { result } = renderHook(() => usePublishPlantLayout(), { wrapper });
    await act(() => expect(result.current.mutateAsync(5)).rejects.toThrow(/Fix the 1 placement problem first/));
    expect(api.publish).not.toHaveBeenCalled();

    api.getLayout.mockResolvedValue(layout(50));
    await act(() => result.current.mutateAsync(5));
    expect(api.publish).toHaveBeenCalledWith(5);
  });

  it("publishes with an item outside the building — an extinguisher or an exit out there is fine", async () => {
    roles.rows = [me(["admin"])];
    api.getLayout.mockResolvedValue(layout(-30));
    const { result } = renderHook(() => usePublishPlantLayout(), { wrapper });
    await act(() => result.current.mutateAsync(5));
    expect(api.publish).toHaveBeenCalledWith(5);
  });

  it("then writes the files for Power BI — this version's and the current copies", async () => {
    roles.rows = [me(["admin"])];
    api.getLayout.mockResolvedValue(layout(50));
    api.publish.mockResolvedValue({
      layout: { ...layout(50), status: "Published", version: 2, layoutKey: "main-x", building: "Main", title: "Main" },
      superseded: [],
      warnings: [],
    });
    const { result } = renderHook(() => usePublishPlantLayout(), { wrapper });
    await act(() => result.current.mutateAsync(5));
    expect(api.writeFile.mock.calls.map((c) => c[0])).toEqual([
      "main-x-v2.svg",
      "main-x-v2-tags.csv",
      "main-x.svg",
      "main-x-tags.csv",
    ]);
  });

  it("still publishes when the files can't be saved, and says how to try again", async () => {
    roles.rows = [me(["admin"])];
    api.getLayout.mockResolvedValue(layout(50));
    api.publish.mockResolvedValue({
      layout: { ...layout(50), status: "Published", version: 2, layoutKey: "main-x", building: "Main", title: "Main" },
      superseded: [],
      warnings: [],
    });
    api.writeFile.mockRejectedValue(new Error("Graph 403"));
    const { result } = renderHook(() => usePublishPlantLayout(), { wrapper });
    const out = await act(() => result.current.mutateAsync(5));
    expect(out.layout.status).toBe("Published");
    expect(out.warnings).toEqual([expect.stringMatching(/files for Power BI couldn't be saved \(Graph 403\)\. Press Save files for Power BI/)]);
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error", message: out.warnings[0] }));
  });
});

describe("saving a published layout's files again", () => {
  const published = {
    id: 5,
    status: "Published",
    version: 2,
    layoutKey: "main-x",
    building: "Main",
    title: "Main",
    wallsFileId: "",
    doc: { extent: { w: 100, h: 50 }, items: [], areas: [] },
  };

  it("is refused to an editor, and nothing is written", async () => {
    roles.rows = [me(["editor"])];
    api.getLayout.mockResolvedValue(published);
    const { result } = renderHook(() => useWritePublishedFiles(), { wrapper });
    await act(() => expect(result.current.mutateAsync(5)).rejects.toThrow(/Only a Plant Map admin/));
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it("is refused on a version that isn't the published one", async () => {
    roles.rows = [me(["admin"])];
    api.getLayout.mockResolvedValue({ ...published, status: "Superseded" });
    const { result } = renderHook(() => useWritePublishedFiles(), { wrapper });
    await act(() => expect(result.current.mutateAsync(5)).rejects.toThrow(/Only the published version/));
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it("writes all four for a Plant Map admin", async () => {
    roles.rows = [me(["admin"])];
    api.getLayout.mockResolvedValue(published);
    const { result } = renderHook(() => useWritePublishedFiles(), { wrapper });
    await act(() => result.current.mutateAsync(5));
    expect(api.writeFile).toHaveBeenCalledTimes(4);
  });
});

describe("deleting a layout", () => {
  it("is refused to an editor and to an ARC admin, and nothing is deleted", async () => {
    roles.rows = [me(["editor"])];
    admins.rows = [{ id: 1, email: "me@example.com", displayName: "Me" }];
    const { result } = renderHook(() => useDeletePlantLayout(), { wrapper });
    await act(() => expect(result.current.mutateAsync(5)).rejects.toThrow(/Only a Plant Map admin can delete a layout/));
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("goes through for a Plant Map admin", async () => {
    roles.rows = [me(["admin"])];
    const { result } = renderHook(() => useDeletePlantLayout(), { wrapper });
    await act(() => result.current.mutateAsync(5));
    expect(api.remove).toHaveBeenCalledWith(5);
  });
});
