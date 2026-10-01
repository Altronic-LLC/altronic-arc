import { describe, it, expect } from "vitest";
import * as ecnsModule from "./ecns";
import {
  addEcnComment,
  createEcn,
  deleteEcn,
  editEcnComment,
  getEcn,
  listEcns,
  updateEcnFields,
} from "./ecns";

// USE_MOCK is true under Vitest — these run against the in-memory store.

describe("ECN API", () => {
  it("lists newest Log# first", async () => {
    const ecns = await listEcns();
    expect(ecns.length).toBeGreaterThan(0);
    expect(ecns[0].logNo).toBe("260062");
  });

  it("raises an ECN with the number that was typed", async () => {
    const created = await createEcn(
      {
        title: "SPARK PLUG, 591011",
        logNo: "260099",
        projectLookupId: 3,
        values: { finalAssemblyPartNumbers: "591011" },
      },
      { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
    );
    expect(created.logNo).toBe("260099");
    // Mock mode fills the submitter in from the signed-in user; real mode
    // reads Graph's createdBy.
    expect(created.submittedBy?.email).toBe("ray.white@altronic-llc.com");

    const found = await getEcn(created.id);
    expect(found?.title).toBe("SPARK PLUG, 591011");
  });

  it("patches one column at a time", async () => {
    const created = await createEcn({ title: "x", logNo: "260098", projectLookupId: null, values: {} });
    const updated = await updateEcnFields(created.id, { field_7: "Operations - Stock modified" });
    expect(updated.values.inHouseStock).toBe("Operations - Stock modified");
    expect(updated.title).toBe("x");
  });

  it("turns a boolean patch back into Yes / empty", async () => {
    const created = await createEcn({ title: "x", logNo: "260097", projectLookupId: null, values: {} });
    const on = await updateEcnFields(created.id, { field_9: true });
    expect(on.values.drawingsComplete).toBe("Yes");
    const off = await updateEcnFields(created.id, { field_9: false });
    expect(off.values.drawingsComplete).toBe("");
  });

  it("edits the Log# and the Title", async () => {
    const created = await createEcn({ title: "Typo", logNo: "260096", projectLookupId: null, values: {} });
    const updated = await updateEcnFields(created.id, { Title: "Fixed", field_2: "260096R1" });
    expect(updated.title).toBe("Fixed");
    expect(updated.logNo).toBe("260096R1");
  });

  it("posts a comment onto the thread", async () => {
    const created = await createEcn({ title: "x", logNo: "260095", projectLookupId: null, values: {} });
    const withComment = await addEcnComment(created.id, {
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml: "<p>Drawings are out.</p>",
    });
    expect(withComment.comments[0].bodyHtml).toContain("Drawings are out.");
  });

  it("edits a comment in place", async () => {
    const created = await createEcn({ title: "x", logNo: "260094", projectLookupId: null, values: {} });
    const posted = await addEcnComment(created.id, {
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml: "<p>Frist</p>",
    });
    const edited = await editEcnComment(
      created.id,
      {
        timestamp: posted.comments[0].timestamp,
        authorEmail: "ray.white@altronic-llc.com",
      },
      "<p>First</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>First</p>");
  });

  it("rejects an update to something that isn't there", async () => {
    await expect(updateEcnFields(999_999, { Title: "x" })).rejects.toThrow();
  });

  it("returns null for an ECN that doesn't exist", async () => {
    expect(await getEcn(999_999)).toBeNull();
  });

  // An ECN is a controlled record, and a superseded one is still revised, not
  // removed. Delete exists ONLY for a row that should never have been (Ray,
  // 2026-09-28), admin-gated in useDeleteEcn — so there is exactly ONE, and a
  // second (a "remove" helper, a bulk delete) has to argue with this test.
  it("has exactly one delete", () => {
    const exported = Object.keys(ecnsModule);
    expect(exported.filter((name) => /delete|remove/i.test(name))).toEqual(["deleteEcn"]);
  });

  it("deletes an ECN, and refuses one that isn't there", async () => {
    const [first] = await listEcns();
    await deleteEcn(first.id);
    expect(await getEcn(first.id)).toBeNull();
    await expect(deleteEcn(999_999)).rejects.toThrow();
  });
});
