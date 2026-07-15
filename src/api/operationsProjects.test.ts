import { describe, it, expect } from "vitest";
import { createOperationsProject, listOperationsProjects, updateOperationsProject } from "./operationsProjects";

// USE_MOCK is true under Vitest — these exercise the in-memory project store.
describe("createOperationsProject / updateOperationsProject (mock)", () => {
  it("creates a project with an optional description", async () => {
    const created = await createOperationsProject({
      projectNumber: "0900",
      title: "Temp Project",
      description: "What this project is for.",
    });
    expect(created.title).toBe("0900-Temp Project");
    expect(created.description).toBe("What this project is for.");
  });

  it("creates a project with no description", async () => {
    const created = await createOperationsProject({ projectNumber: "0901", title: "No Desc" });
    expect(created.description).toBeUndefined();
  });

  it("updates a project's description without changing its number/name identity", async () => {
    const created = await createOperationsProject({ projectNumber: "0902", title: "Renamable" });
    const updated = await updateOperationsProject(created.lookupId, {
      projectNumber: "0902",
      title: "Renamable",
      description: "Added after the fact.",
    });
    expect(updated.title).toBe("0902-Renamable");
    expect(updated.description).toBe("Added after the fact.");

    const all = await listOperationsProjects();
    const found = all.find((p) => p.lookupId === created.lookupId);
    expect(found?.description).toBe("Added after the fact.");
  });

  it("clears a description by updating with an empty string", async () => {
    const created = await createOperationsProject({
      projectNumber: "0903",
      title: "Clearable",
      description: "Will be cleared.",
    });
    const cleared = await updateOperationsProject(created.lookupId, {
      projectNumber: "0903",
      title: "Clearable",
      description: "",
    });
    expect(cleared.description).toBeUndefined();
  });

  it("throws for an unknown project id", async () => {
    await expect(
      updateOperationsProject(99999999, { projectNumber: "0", title: "x" }),
    ).rejects.toThrow(/not found/);
  });
});
