import { describe, it, expect } from "vitest";
import {
  addPanelOrderComment,
  createPanelOrder,
  editPanelOrderComment,
  getPanelOrderChoices,
  listPanelOrders,
  resolvePanelSiteUserLookupId,
  setPanelOrderEngineer,
  setPanelOrderProject,
  setPanelOrderWatchers,
  unwatchPanelOrder,
  updatePanelOrderFields,
  watchPanelOrder,
} from "./panelOrders";
import { createPanelProject, listPanelProjects, updatePanelProject } from "./panelProjects";
import { addPanelRole, listPanelRoles, removePanelRole, updatePanelRole } from "./panelRoles";

// USE_MOCK is true under Vitest — these exercise the in-memory stores.

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 36 };
const SARAH = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com", lookupId: 46 };

describe("panelOrders mock CRUD", () => {
  it("creates an order with defaults and lists it", async () => {
    const created = await createPanelOrder({
      title: "Test panel order",
      projectLookupId: 1,
      customer: "Archrock",
    });
    expect(created.status).toBe("Submitted");
    expect(created.projectRef?.lookupId).toBe(1);
    expect(created.projectRef?.title).toBe("P-0001");

    const all = await listPanelOrders();
    expect(all.some((o) => o.id === created.id)).toBe(true);
  });

  it("updates fields (status + sales order)", async () => {
    const created = await createPanelOrder({ title: "To Update" });
    const updated = await updatePanelOrderFields(created.id, {
      Status: "In Production",
      SalesOrder: "SO-42",
    });
    expect(updated.status).toBe("In Production");
    expect(updated.salesOrder).toBe("SO-42");
  });

  it("sets and clears the single-person engineer", async () => {
    const created = await createPanelOrder({ title: "Assignable" });
    const assigned = await setPanelOrderEngineer(created.id, RAY);
    expect(assigned.engineerAssigned?.lookupId).toBe(36);
    const cleared = await setPanelOrderEngineer(created.id, null);
    expect(cleared.engineerAssigned).toBeNull();
  });

  it("changes and clears the project reference", async () => {
    const created = await createPanelOrder({ title: "Movable", projectLookupId: 1 });
    const moved = await setPanelOrderProject(created.id, 2);
    expect(moved.projectRef?.title).toBe("P-0002");
    const cleared = await setPanelOrderProject(created.id, null);
    expect(cleared.projectRef).toBeNull();
  });

  it("watch / unwatch round-trip", async () => {
    const created = await createPanelOrder({ title: "Watchable" });
    const watched = await watchPanelOrder(created.id, SARAH);
    expect(watched.watchers.some((w) => w.lookupId === 46)).toBe(true);
    // Watching twice is a no-op.
    const again = await watchPanelOrder(created.id, SARAH);
    expect(again.watchers.filter((w) => w.lookupId === 46)).toHaveLength(1);
    const unwatched = await unwatchPanelOrder(created.id, SARAH);
    expect(unwatched.watchers.some((w) => w.lookupId === 46)).toBe(false);
  });

  it("replaces the watcher list wholesale", async () => {
    const created = await createPanelOrder({ title: "Watchers", watchers: [RAY] });
    const updated = await setPanelOrderWatchers(created.id, [RAY, SARAH]);
    expect(updated.watchers).toHaveLength(2);
  });

  it("appends and edits comments (newest first)", async () => {
    const created = await createPanelOrder({ title: "Commentable" });
    const withComment = await addPanelOrderComment(created.id, {
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml: "<p>first</p>",
    });
    expect(withComment.comments[0].bodyHtml).toBe("<p>first</p>");

    const edited = await editPanelOrderComment(
      created.id,
      {
        timestamp: withComment.comments[0].timestamp,
        authorEmail: "ray.white@altronic-llc.com",
      },
      "<p>edited</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>edited</p>");
  });

  it("resolves a mock site user by email (cold-start auto-watch)", async () => {
    const id = await resolvePanelSiteUserLookupId("sarah.shaffer@altronic-llc.com");
    expect(id).toBe(46);
    // An unknown email now falls back to ensureuser (mock mode returns a
    // deterministic positive id) so anyone from the directory can be resolved.
    expect(await resolvePanelSiteUserLookupId("nobody@nowhere.example")).toBeGreaterThan(0);
  });

  it("returns the confirmed statuses + a customer list from choice discovery", async () => {
    const choices = await getPanelOrderChoices();
    expect(choices.status).toContain("In Production");
    expect(choices.status).toContain("Shipped");
    expect(choices.customer.length).toBeGreaterThan(0);
  });
});

describe("panelProjects mock CRUD", () => {
  it("lists projects sorted by reference number", async () => {
    const all = await listPanelProjects();
    expect(all.length).toBeGreaterThan(0);
    const titles = all.map((p) => p.title);
    expect([...titles].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))).toEqual(
      titles,
    );
  });

  it("creates and updates a project", async () => {
    const created = await createPanelProject({
      title: "P-9001",
      projectType: "MSC-Misc",
      description: "Test project",
      dwgNo: "DWG-1",
      customer: "Altronic",
      department: "Engineering",
    });
    expect(created.title).toBe("P-9001");

    const updated = await updatePanelProject(created.id, {
      title: "P-9001",
      projectType: "PRG-Programming",
      description: "Renamed",
      dwgNo: "DWG-2",
      customer: "Altronic",
      department: "Operations",
    });
    expect(updated.projectType).toBe("PRG-Programming");
    expect(updated.description).toBe("Renamed");

    const all = await listPanelProjects();
    expect(all.find((p) => p.id === created.id)?.description).toBe("Renamed");
  });
});

describe("panelRoles mock CRUD", () => {
  it("lists seeded roles", async () => {
    const all = await listPanelRoles();
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((e) => e.role === "Super User")).toBe(true);
  });

  it("adds, updates, and removes a role row", async () => {
    const added = await addPanelRole({ user: SARAH, role: "Viewer", note: "temp" });
    expect(added.user?.lookupId).toBe(46);
    expect(added.role).toBe("Viewer");

    await updatePanelRole({ id: added.id, role: "Engineer" });
    let all = await listPanelRoles();
    expect(all.find((e) => e.id === added.id)?.role).toBe("Engineer");

    await removePanelRole(added.id);
    all = await listPanelRoles();
    expect(all.some((e) => e.id === added.id)).toBe(false);
  });
});
