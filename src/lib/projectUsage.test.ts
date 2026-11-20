import { describe, expect, it } from "vitest";
import { describeProjectUsage, projectUsage, type ProjectUsageSources } from "./projectUsage";

// The sources are cast: projectUsage reads ONLY the project fields, and a full
// fixture of eight record types would bury what each case is about.
const p = (lookupId: number) => ({ lookupId, title: `P${lookupId}` });

function sources(over: Partial<Record<keyof ProjectUsageSources, unknown[]>> = {}) {
  return {
    tasks: [],
    eirs: [],
    ecns: [],
    testSheets: [],
    buildRequests: [],
    buildRequestItems: [],
    faits: [],
    projectFolders: [],
    ...over,
  } as unknown as ProjectUsageSources;
}

describe("projectUsage", () => {
  it("is empty when nothing points at the project", () => {
    expect(projectUsage(7, sources())).toEqual([]);
  });

  it("counts a task by its parent project OR a related project", () => {
    const tasks = [
      { parentProject: p(7), relatedProjects: [] },
      { parentProject: p(1), relatedProjects: [p(7)] },
      { parentProject: p(1), relatedProjects: [p(2)] },
    ];
    expect(projectUsage(7, sources({ tasks }))).toEqual([{ label: "tasks", count: 2 }]);
  });

  it("counts a task once when it names the project as parent AND related", () => {
    const tasks = [{ parentProject: p(7), relatedProjects: [p(7)] }];
    expect(projectUsage(7, sources({ tasks }))).toEqual([{ label: "task", count: 1 }]);
  });

  it("covers every list that looks up into Projects", () => {
    const usage = projectUsage(
      7,
      sources({
        eirs: [{ parentProjects: [p(1), p(7)] }],
        ecns: [{ parentProject: p(7) }],
        testSheets: [{ parentProject: p(7) }],
        buildRequests: [{ parentProjects: [p(7)] }],
        buildRequestItems: [{ projectRef: p(7) }, { projectRef: null }],
        faits: [{ parentProject: p(7) }],
        projectFolders: [{ projectLookupId: 7 }, { projectLookupId: 0 }],
      }),
    );
    expect(usage.map((u) => u.label)).toEqual([
      "EIR",
      "ECN",
      "test sheet",
      "build request",
      "build request part",
      "FAIT",
      "project folder",
    ]);
  });

  it("ignores records on other projects and null references", () => {
    const usage = projectUsage(
      7,
      sources({
        ecns: [{ parentProject: null }, { parentProject: p(8) }],
        faits: [{ parentProject: null }],
      }),
    );
    expect(usage).toEqual([]);
  });
});

describe("describeProjectUsage", () => {
  it("joins with commas and a final 'and'", () => {
    expect(
      describeProjectUsage([
        { label: "tasks", count: 3 },
        { label: "EIR", count: 1 },
        { label: "project folders", count: 2 },
      ]),
    ).toBe("3 tasks, 1 EIR and 2 project folders");
  });

  it("handles one and none", () => {
    expect(describeProjectUsage([{ label: "ECN", count: 1 }])).toBe("1 ECN");
    expect(describeProjectUsage([])).toBe("");
  });
});
