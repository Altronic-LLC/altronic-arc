import { describe, it, expect } from "vitest";
import * as faitsModule from "./faits";
import {
  addFaitComment,
  createFait,
  editFaitComment,
  getFait,
  listFaits,
  setFaitWatchers,
  updateFaitFields,
} from "./faits";

// USE_MOCK is true under Vitest — these run against the in-memory store.

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };

describe("FAIT API", () => {
  it("lists newest first", async () => {
    const faits = await listFaits();
    expect(faits.length).toBeGreaterThan(0);
    for (let i = 1; i < faits.length; i++) {
      expect(faits[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        faits[i].createdAt.getTime(),
      );
    }
  });

  it("raises one, and the initiator watches it", async () => {
    const created = await createFait(
      {
        title: "",
        status: "Open",
        projectLookupId: 501,
        values: { sapPartNumber: "9999-0001", supplierName: "ACME" },
      },
      RAY,
    );
    expect(created.values.sapPartNumber).toBe("9999-0001");
    expect(created.parentProject).toEqual({ lookupId: 501, title: "" });
    // Whoever raises it watches it — the house rule everywhere in ARC.
    expect(created.watchers.map((w) => w.email)).toEqual([RAY.email]);
    expect(created.initiator?.email).toBe(RAY.email);

    expect((await getFait(created.id))?.values.supplierName).toBe("ACME");
  });

  it("patches one column at a time", async () => {
    const created = await createFait(
      { title: "", status: "Open", projectLookupId: null, values: { sapPartNumber: "9999-0002" } },
      RAY,
    );
    const updated = await updateFaitFields(created.id, { SupplierName: "NEW SUPPLIER" });
    expect(updated.values.supplierName).toBe("NEW SUPPLIER");
    expect(updated.values.sapPartNumber).toBe("9999-0002");
  });

  it("turns a boolean patch back into Yes / empty", async () => {
    const created = await createFait(
      { title: "", status: "Open", projectLookupId: null, values: { sapPartNumber: "9999-0003" } },
      RAY,
    );
    expect((await updateFaitFields(created.id, { NewPart: true })).values.newPart).toBe("Yes");
    expect((await updateFaitFields(created.id, { NewPart: false })).values.newPart).toBe("");
  });

  it("moves the status and the project", async () => {
    const created = await createFait(
      { title: "", status: "Open", projectLookupId: null, values: { sapPartNumber: "9999-0004" } },
      RAY,
    );
    const updated = await updateFaitFields(created.id, {
      Status: "This is with SQE",
      ProjectReferenceLookupId: 412,
    });
    expect(updated.status).toBe("This is with SQE");
    expect(updated.parentProject).toEqual({ lookupId: 412, title: "" });
  });

  it("replaces the watchers", async () => {
    const created = await createFait(
      { title: "", status: "Open", projectLookupId: null, values: { sapPartNumber: "9999-0005" } },
      RAY,
    );
    const updated = await setFaitWatchers(created.id, [
      { displayName: "Sarah Shaffer", email: "sarah@altronic-llc.com" },
    ]);
    expect(updated.watchers.map((w) => w.email)).toEqual(["sarah@altronic-llc.com"]);
  });

  it("posts and edits a comment", async () => {
    const created = await createFait(
      { title: "", status: "Open", projectLookupId: null, values: { sapPartNumber: "9999-0006" } },
      RAY,
    );
    const posted = await addFaitComment(created.id, {
      authorName: "Ray White",
      authorEmail: RAY.email,
      bodyHtml: "<p>Frist</p>",
    });
    expect(posted.comments[0].bodyHtml).toContain("Frist");

    const edited = await editFaitComment(
      created.id,
      { timestamp: posted.comments[0].timestamp, authorEmail: RAY.email },
      "<p>First</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>First</p>");
  });

  it("rejects an update to something that isn't there", async () => {
    await expect(updateFaitFields(999_999, { Status: "Open" })).rejects.toThrow();
  });

  it("returns null for a FAIT that doesn't exist", async () => {
    expect(await getFait(999_999)).toBeNull();
  });

  // A FAIT records an inspection that happened. A superseded one is closed,
  // not removed — the absence from the module is what stops a future screen
  // quietly acquiring a delete.
  it("has no delete", () => {
    expect(Object.keys(faitsModule).filter((n) => /delete|remove/i.test(n))).toEqual([]);
  });
});
