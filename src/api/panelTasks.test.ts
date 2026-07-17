import { describe, it, expect } from "vitest";
import {
  addPanelTaskComment,
  createPanelTask,
  editPanelTaskComment,
  listPanelTasks,
  setPanelTaskAssigned,
  setPanelTaskProject,
  setPanelTaskWatchers,
  unwatchPanelTask,
  updatePanelTaskFields,
  watchPanelTask,
} from "./panelTasks";

// USE_MOCK is true under Vitest — these exercise the in-memory store.

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 36 };
const SARAH = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com", lookupId: 46 };

describe("panelTasks mock CRUD", () => {
  it("creates a task with defaults and lists it", async () => {
    const created = await createPanelTask({
      title: "Draw layout",
      taskType: "Drawings",
      projectLookupId: 1,
    });
    expect(created.status).toBe("Pending");
    expect(created.taskType).toBe("Drawings");
    expect(created.projectRef?.title).toBe("P-0001");

    const all = await listPanelTasks();
    expect(all.some((t) => t.id === created.id)).toBe(true);
  });

  it("updates fields (status + description)", async () => {
    const created = await createPanelTask({ title: "To Update" });
    const updated = await updatePanelTaskFields(created.id, {
      Status: "In Process",
      Description: "- [ ] step one",
    });
    expect(updated.status).toBe("In Process");
    expect(updated.description).toBe("- [ ] step one");
  });

  it("sets and clears the single-person assignee", async () => {
    const created = await createPanelTask({ title: "Assignable" });
    const assigned = await setPanelTaskAssigned(created.id, RAY);
    expect(assigned.assigned?.lookupId).toBe(36);
    const cleared = await setPanelTaskAssigned(created.id, null);
    expect(cleared.assigned).toBeNull();
  });

  it("changes and clears the project reference", async () => {
    const created = await createPanelTask({ title: "Movable", projectLookupId: 1 });
    const moved = await setPanelTaskProject(created.id, 2);
    expect(moved.projectRef?.title).toBe("P-0002");
    const cleared = await setPanelTaskProject(created.id, null);
    expect(cleared.projectRef).toBeNull();
  });

  it("watch / unwatch round-trip and wholesale replace", async () => {
    const created = await createPanelTask({ title: "Watchable" });
    const watched = await watchPanelTask(created.id, SARAH);
    expect(watched.watchers.some((w) => w.lookupId === 46)).toBe(true);
    const again = await watchPanelTask(created.id, SARAH);
    expect(again.watchers.filter((w) => w.lookupId === 46)).toHaveLength(1);
    const unwatched = await unwatchPanelTask(created.id, SARAH);
    expect(unwatched.watchers.some((w) => w.lookupId === 46)).toBe(false);
    const replaced = await setPanelTaskWatchers(created.id, [RAY, SARAH]);
    expect(replaced.watchers).toHaveLength(2);
  });

  it("appends and edits comments (newest first)", async () => {
    const created = await createPanelTask({ title: "Commentable" });
    const withComment = await addPanelTaskComment(created.id, {
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml: "<p>first</p>",
    });
    expect(withComment.comments[0].bodyHtml).toBe("<p>first</p>");

    const edited = await editPanelTaskComment(
      created.id,
      {
        timestamp: withComment.comments[0].timestamp,
        authorEmail: "ray.white@altronic-llc.com",
      },
      "<p>edited</p>",
    );
    expect(edited.comments[0].bodyHtml).toBe("<p>edited</p>");
  });
});
