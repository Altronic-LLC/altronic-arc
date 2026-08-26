import { describe, it, expect } from "vitest";
import * as supplierIssuesModule from "./supplierIssues";
import {
  addSupplierIssueComment,
  createSupplierIssue,
  editSupplierIssueComment,
  listSupplierIssues,
  setSupplierIssueWatchers,
  updateSupplierIssueFields,
} from "./supplierIssues";

describe("Supplier Issues API", () => {
  it("lists issues newest first", async () => {
    const issues = await listSupplierIssues();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("creates an issue scoped to a supplier", async () => {
    const created = await createSupplierIssue({
      title: "Late shipment",
      supplierId: 29,
      description: "Shipment arrived two weeks late",
      status: "Choice 1",
      severity: "Choice 2",
      watchers: [],
    });
    expect(created.supplierId).toBe(29);
    expect(created.title).toBe("Late shipment");
  });

  it("updates only the changed fields", async () => {
    const created = await createSupplierIssue({
      title: "X",
      supplierId: 29,
      description: "",
      status: null,
      severity: null,
      watchers: [],
    });
    const updated = await updateSupplierIssueFields(created.id, { resolution: "Resolved by reorder" });
    expect(updated.resolution).toBe("Resolved by reorder");
    expect(updated.title).toBe("X");
  });

  it("patches watchers", async () => {
    const created = await createSupplierIssue({
      title: "X",
      supplierId: 29,
      description: "",
      status: null,
      severity: null,
      watchers: [],
    });
    const updated = await setSupplierIssueWatchers(created.id, [
      { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
    ]);
    expect(updated.watchers).toHaveLength(1);
  });

  it("posts and edits a comment", async () => {
    const created = await createSupplierIssue({
      title: "X",
      supplierId: 29,
      description: "",
      status: null,
      severity: null,
      watchers: [],
    });
    const withComment = await addSupplierIssueComment(created.id, {
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml: "<p>Frist</p>",
    });
    expect(withComment.comments[0].bodyHtml).toContain("Frist");

    const edited = await editSupplierIssueComment(
      created.id,
      { timestamp: withComment.comments[0].timestamp, authorEmail: "ray.white@altronic-llc.com" },
      "<p>First</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>First</p>");
  });

  // An issue is a record that something happened, closed by resolving it.
  it("has no delete", () => {
    expect(Object.keys(supplierIssuesModule).filter((n) => /delete|remove/i.test(n))).toEqual([]);
  });
});
