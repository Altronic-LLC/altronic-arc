import { beforeEach, describe, expect, it } from "vitest";
import * as api from "./scns";
import {
  __resetScnMockStore,
  addScnComment,
  createScn,
  editScnComment,
  getScn,
  listScns,
  setScnAssigned,
  setScnOwner,
  setScnWatchers,
  updateScnFields,
} from "./scns";
import type { ScnInput } from "@/types/task";

// USE_MOCK is true under Vitest — these run against the in-memory store.

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 };
const KATIE = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com", lookupId: 97 };
const SARAH = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com", lookupId: 120 };

const input: ScnInput = {
  product: "NGI-1000",
  category: "OBS",
  approvalStatus: "Approved",
  assignedTo: [SARAH],
  owner: [RAY],
  values: { description: "Supplier EOL on the controller", customer: "Multiple" },
};

beforeEach(() => {
  __resetScnMockStore();
});

describe("SCNs API (mock mode)", () => {
  it("lists newest SCN# first", async () => {
    const rows = await listScns();
    expect(rows.length).toBeGreaterThan(0);
    const numbers = rows.map((r) => r.scnNumber);
    expect([...numbers].sort().reverse()).toEqual(numbers);
  });

  it("reads one SCN, and null for an id that isn't there", async () => {
    expect((await getScn(1))?.scnNumber).toBe("2026-0148");
    expect(await getScn(9999)).toBeNull();
  });

  it("creates an SCN with the next GLOBAL number, its year, and WIP by default", async () => {
    const created = await createScn(input);
    expect(created.scnNumber).toBe("2026-0149"); // the seed tops out at 2026-0148
    expect(created.year).toBe("2026");
    expect(created.status).toBe("WIP");
    expect(created.approvalStatus).toBe("Approved");
    expect(created.product).toBe("NGI-1000");
    expect(created.values.description).toBe("Supplier EOL on the controller");
    expect(created.checks.projectStatus).toEqual([]);
    expect(created.dates.ltsExpires).toBeNull();
    expect(created.taskList).toBeNull();
  });

  it("keeps a status the caller chose", async () => {
    const created = await createScn({ ...input, status: "On Hold" });
    expect(created.status).toBe("On Hold");
  });

  it("numbers two creates in a row consecutively", async () => {
    const a = await createScn(input);
    const b = await createScn(input);
    expect(b.scnNumber).toBe(`2026-${String(parseInt(a.scnNumber.slice(5), 10) + 1).padStart(4, "0")}`);
  });

  it("makes the assignees and owners watchers on the new SCN", async () => {
    const created = await createScn({ ...input, watchers: [KATIE] });
    expect(created.watchers.map((w) => w.displayName).sort()).toEqual(
      ["Katie Fleming", "Ray White", "Sarah Shaffer"],
    );
  });

  it("patches only what changed, by descriptor key", async () => {
    const before = (await getScn(1))!;
    const updated = await updateScnFields(
      1,
      { status: "CLOSED", description: "Done", projectStatus: ["Immediate Phase Complete"] },
      before,
    );
    expect(updated.status).toBe("CLOSED");
    expect(updated.values.description).toBe("Done");
    expect(updated.checks.projectStatus).toEqual(["Immediate Phase Complete"]);
    // Untouched columns survive.
    expect(updated.product).toBe(before.product);
    expect(updated.values.customer).toBe(before.values.customer);
    expect(updated.scnNumber).toBe(before.scnNumber);
  });

  it("writes and clears a date", async () => {
    const before = (await getScn(1))!;
    const dated = await updateScnFields(1, { ltbExpires: new Date("2026-12-31T12:00:00Z") }, before);
    expect(dated.dates.ltbExpires?.toISOString()).toBe("2026-12-31T12:00:00.000Z");
    const cleared = await updateScnFields(1, { ltbExpires: null }, dated);
    expect(cleared.dates.ltbExpires).toBeNull();
  });

  it("refuses to write the read-only Task List", async () => {
    const before = (await getScn(1))!;
    await expect(updateScnFields(1, { taskList: "https://x" }, before)).rejects.toThrow(/read-only/);
  });

  it("throws for an SCN that isn't there", async () => {
    const before = (await getScn(1))!;
    await expect(updateScnFields(9999, { status: "CLOSED" }, before)).rejects.toThrow(/not found/);
  });

  it("replaces the watchers", async () => {
    const updated = await setScnWatchers(2, [KATIE]);
    expect(updated.watchers).toEqual([KATIE]);
  });

  it("assigning someone also makes them a watcher, and removes nobody", async () => {
    const before = (await getScn(2))!; // watchers: Ray, Valerie
    const updated = await setScnAssigned(2, [KATIE]);
    expect(updated.assignedTo).toEqual([KATIE]);
    const names = updated.watchers.map((w) => w.displayName);
    expect(names).toContain("Katie Fleming");
    for (const w of before.watchers) expect(names).toContain(w.displayName);
  });

  it("setting the owner does the same", async () => {
    const updated = await setScnOwner(6, [KATIE, SARAH]);
    expect(updated.owner.map((p) => p.displayName)).toEqual(["Katie Fleming", "Sarah Shaffer"]);
    expect(updated.watchers.map((w) => w.displayName)).toEqual(
      expect.arrayContaining(["Ray White", "Katie Fleming", "Sarah Shaffer"]),
    );
  });

  it("posts a comment, newest first, and edits it in place", async () => {
    const posted = await addScnComment(2, {
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml: "<p>First</p>",
    });
    expect(posted.comments[0].bodyHtml).toBe("<p>First</p>");

    const edited = await editScnComment(
      2,
      { timestamp: posted.comments[0].timestamp, authorEmail: "ray.white@altronic-llc.com" },
      "<p>Edited</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>Edited</p>");
    expect(edited.comments).toHaveLength(1);
  });

  it("hands back copies — mutating a result never reaches the store", async () => {
    const first = (await getScn(1))!;
    first.product = "TAMPERED";
    first.checks.projectStatus.push("x");
    const again = (await getScn(1))!;
    expect(again.product).not.toBe("TAMPERED");
    expect(again.checks.projectStatus).not.toContain("x");
  });

  it("exports no delete — an SCN is a controlled notice, closed or cancelled rather than removed", () => {
    const names = Object.keys(api);
    expect(names.filter((n) => /delete|remove/i.test(n))).toEqual([]);
  });
});
