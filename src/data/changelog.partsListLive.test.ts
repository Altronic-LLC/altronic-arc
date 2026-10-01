import { afterEach, describe, expect, it, vi } from "vitest";

// v0.168.0's notes follow the Parts List's go-live switch (Tim, 2026-09-29):
// only the Coming soon line until VITE_PARTS_LIST_LIVE, then every feature.
// The changelog is built when the module loads, so each case re-imports it
// with the switch set.

async function changelogWith(live: boolean) {
  vi.resetModules();
  vi.doMock("@/api/config", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/api/config")>();
    return { ...actual, PARTS_LIST_LIVE: live };
  });
  return (await import("./changelog")).CHANGELOG.find((e) => e.version === "0.168.0")!;
}

afterEach(() => {
  vi.doUnmock("@/api/config");
  vi.resetModules();
});

describe("v0.168.0 in the history", () => {
  it("shows only the Coming soon line while the Parts List is hidden", async () => {
    const entry = await changelogWith(false);
    expect(entry.changes).toHaveLength(1);
    expect(entry.changes[0]).toMatch(/coming soon/i);
  });

  it("shows every Parts List feature, and no Coming soon line, once it's live", async () => {
    const entry = await changelogWith(true);
    expect(entry.changes.length).toBeGreaterThan(10);
    expect(entry.changes[0]).toMatch(/^New Parts List under Engineering/);
    expect(entry.changes.some((c) => /coming soon/i.test(c))).toBe(false);
  });
});
