import { describe, it, expect } from "vitest";
import { createProject, listProjects, updateProject } from "./tasks";

// USE_MOCK is true under Vitest — these exercise the in-memory project store.
describe("updateProject (mock)", () => {
  it("renames a project (number + name live in the title)", async () => {
    const created = await createProject({ title: "0900-Temp Name" });
    const renamed = await updateProject(created.lookupId, "0901-Renamed Project");
    expect(renamed).toEqual({ lookupId: created.lookupId, title: "0901-Renamed Project" });

    const all = await listProjects();
    const found = all.find((p) => p.lookupId === created.lookupId);
    expect(found?.title).toBe("0901-Renamed Project");
  });

  it("throws for an unknown project id", async () => {
    await expect(updateProject(99999999, "x")).rejects.toThrow(/not found/);
  });
});
