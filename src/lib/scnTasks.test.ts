import { describe, expect, it } from "vitest";
import { linkedScnTaskId, scnTaskLink } from "./scnTasks";

describe("scnTaskLink", () => {
  it("links to the task in ARC, its numbered title as the link text", () => {
    const link = scnTaskLink({ id: 15, numberedTitle: "T0-335-Purchase Order" });
    expect(link.url).toMatch(/\/task\/15$/);
    expect(link.description).toBe("T0-335-Purchase Order");
  });
});

describe("linkedScnTaskId", () => {
  it("reads the task id back out of an ARC task link — round trip", () => {
    expect(linkedScnTaskId(scnTaskLink({ id: 3347, numberedTitle: "x" }))).toBe(3347);
  });

  it("reads a production ARC link too", () => {
    expect(
      linkedScnTaskId({ url: "https://altronic-llc.github.io/altronic-arc/task/88", description: "" }),
    ).toBe(88);
  });

  it("is null for a legacy Planner link, even one with a task-looking path", () => {
    expect(
      linkedScnTaskId({
        url: "https://tasks.office.com/hoerbigergroup.onmicrosoft.com/Home/PlanViews/IyvWHk7AIk?Type=PlanLink",
        description: "Task List 2022-012",
      }),
    ).toBeNull();
    expect(linkedScnTaskId({ url: "https://tasks.office.com/x/task/12", description: "" })).toBeNull();
  });

  it("is null for nothing, a malformed URL, or some other page", () => {
    expect(linkedScnTaskId(null)).toBeNull();
    expect(linkedScnTaskId({ url: "not a url", description: "" })).toBeNull();
    expect(linkedScnTaskId({ url: "https://example.com/task/12/comments", description: "" })).toBeNull();
  });
});
