import { describe, it, expect } from "vitest";
import {
  createWhereAmI,
  deleteWhereAmI,
  listWhereAmI,
  updateWhereAmI,
} from "./whereAmI";

// USE_MOCK is true under Vitest — these run against the in-memory store.

const day = (offset: number) => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, 12),
  );
};

describe("Where am I? API", () => {
  it("lists soonest first", async () => {
    const entries = await listWhereAmI();
    const times = entries.map((e) => e.date?.getTime() ?? Infinity);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("adds an entry", async () => {
    const created = await createWhereAmI({ title: "Ray - offsite", date: day(4) });
    expect(created.title).toBe("Ray - offsite");

    const all = await listWhereAmI();
    expect(all.some((e) => e.id === created.id)).toBe(true);
  });

  it("edits an entry", async () => {
    const created = await createWhereAmI({ title: "Typo", date: day(4) });
    const updated = await updateWhereAmI(created.id, {
      title: "Fixed",
      date: day(5),
    });
    expect(updated.title).toBe("Fixed");

    const all = await listWhereAmI();
    expect(all.find((e) => e.id === created.id)?.title).toBe("Fixed");
  });

  // Plans get cancelled — this list HAS a delete, unlike Visit Reports and
  // Gray Market Requests, which record things that actually happened.
  it("removes an entry", async () => {
    const created = await createWhereAmI({ title: "Cancelled trip", date: day(6) });
    await deleteWhereAmI(created.id);

    const all = await listWhereAmI();
    expect(all.some((e) => e.id === created.id)).toBe(false);
  });

  it("rejects an edit to something that isn't there", async () => {
    await expect(
      updateWhereAmI(999_999, { title: "x", date: day(1) }),
    ).rejects.toThrow();
  });

  it("shrugs off deleting something already gone", async () => {
    // Two people cancelling the same trip shouldn't produce an error.
    await expect(deleteWhereAmI(999_999)).resolves.toBeUndefined();
  });
});
