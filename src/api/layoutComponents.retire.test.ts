import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetLayoutComponentsMockStore,
  listLayoutComponents,
  replaceLayoutComponent,
  setLayoutComponentActive,
} from "./layoutComponents";

beforeEach(() => __resetLayoutComponentsMockStore());

describe("setLayoutComponentActive (demo store)", () => {
  it("retires and restores the latest version", async () => {
    const mill = (await listLayoutComponents()).find((c) => c.key === "cnc-vmc-120x96")!;
    expect((await setLayoutComponentActive(mill, false)).active).toBe(false);
    expect((await listLayoutComponents()).find((c) => c.id === mill.id)?.active).toBe(false);
    expect((await setLayoutComponentActive(mill, true)).active).toBe(true);
  });

  it("refuses a version that was replaced meanwhile", async () => {
    const mill = (await listLayoutComponents()).find((c) => c.key === "cnc-vmc-120x96")!;
    await replaceLayoutComponent(mill, { ...mill, category: "Machine", title: "Mill v2" });
    await expect(setLayoutComponentActive(mill, false)).rejects.toThrow(/replaced meanwhile.*v2/);
  });
});

describe("setLayoutComponentActive (real mode)", () => {
  it("PATCHes only IsActive on the row", async () => {
    vi.resetModules();
    const graphFetch = vi.fn();
    vi.doMock("./config", async (orig) => ({
      ...(await orig<typeof import("./config")>()),
      USE_MOCK: false,
      SP_LAYOUT_COMPONENTS_LIST_ID: "lc-list",
    }));
    vi.doMock("./graph", async (orig) => ({
      ...(await orig<typeof import("./graph")>()),
      graphFetch,
      graphFetchAll: vi.fn(async () => [
        { id: "7", fields: { Title: "Mill", ComponentKey: "mill", Category: "Machine", Version: 1, IsActive: true, FootprintW: 10, FootprintD: 10 } },
      ]),
    }));
    const api = await import("./layoutComponents");
    const mill = (await api.listLayoutComponents())[0];
    await api.setLayoutComponentActive(mill, false);
    expect(graphFetch).toHaveBeenCalledWith(expect.stringMatching(/\/lists\/lc-list\/items\/7\/fields$/), {
      method: "PATCH",
      body: JSON.stringify({ IsActive: false }),
    });
    vi.doUnmock("./config");
    vi.doUnmock("./graph");
  });
});
