import { describe, expect, it } from "vitest";
import type { ProjectReference } from "@/types/task";
import { findScnProject, scnProjectOptions } from "./scnProjects";

const PROJECTS: ProjectReference[] = [
  { lookupId: 274, title: "0000-Engineering Apps" },
  { lookupId: 501, title: "0017-AMP-5000 Refresh" },
];

describe("findScnProject", () => {
  it("finds the project a stored title names, ignoring case and outer spaces", () => {
    expect(findScnProject(PROJECTS, "  0017-amp-5000 refresh ")?.lookupId).toBe(501);
  });

  it("is null for a blank value or a title no project carries", () => {
    expect(findScnProject(PROJECTS, "")).toBeNull();
    expect(findScnProject(PROJECTS, null)).toBeNull();
    expect(findScnProject(PROJECTS, "0099-Renamed Since")).toBeNull();
  });
});

describe("scnProjectOptions", () => {
  it("offers every project by title, the title as the stored value", () => {
    expect(scnProjectOptions(PROJECTS, "")).toEqual([
      { value: "0000-Engineering Apps", label: "0000-Engineering Apps" },
      { value: "0017-AMP-5000 Refresh", label: "0017-AMP-5000 Refresh" },
    ]);
  });

  it("keeps a stored value no project carries, so a save can't silently clear it", () => {
    const options = scnProjectOptions(PROJECTS, "0099-Renamed Since");
    expect(options[0]).toEqual({
      value: "0099-Renamed Since",
      label: "0099-Renamed Since (not an Engineering project)",
    });
    expect(options).toHaveLength(3);
  });

  it("doesn't duplicate a stored value that IS a project", () => {
    expect(scnProjectOptions(PROJECTS, "0000-Engineering Apps")).toHaveLength(2);
  });
});
