import { describe, expect, it } from "vitest";
import { buildRequestEmailContext, eirEmailContext, taskEmailContext, taskEmailTarget } from "./emailContext";

describe("taskEmailContext", () => {
  it("names the parent task, as a link, above the task", () => {
    const ctx = taskEmailContext({
      parentTask: { id: 3290, numberedTitle: "T12-321-Pump seal supplier change", status: "In Progress" },
      description: "<p>Update the BOM.</p>",
    });
    expect(ctx.above).toEqual({
      label: "Parent task",
      title: "T12-321-Pump seal supplier change",
      url: expect.stringMatching(/\/task\/3290$/),
    });
    expect(ctx.description).toBe("<p>Update the BOM.</p>");
  });

  it("has no line above a task with no parent", () => {
    expect(taskEmailContext({ parentTask: null, description: "" }).above).toBeUndefined();
  });
});

describe("taskEmailTarget", () => {
  it("is the task's numbered title, and never the parent's — the subject stays the task's", () => {
    const target = taskEmailTarget({
      id: 3344,
      numberedTitle: "T188-321-CM4 BOM changes",
      title: "CM4 BOM changes",
      parentTask: { id: 3290, numberedTitle: "T12-321-Pump seal", status: "In Progress" },
      description: "",
    });
    expect(target).toMatchObject({ kind: "task", id: 3344, title: "T188-321-CM4 BOM changes" });
    expect(target.title).not.toContain("T12-321");
  });

  it("falls back to the plain title when there's no numbered one", () => {
    expect(
      taskEmailTarget({ id: 1, numberedTitle: "", title: "Plain", parentTask: null, description: "" }).title,
    ).toBe("Plain");
  });
});

describe("eirEmailContext", () => {
  it("carries the description and no parent", () => {
    expect(eirEmailContext({ description: "Seal LTB." })).toEqual({ description: "Seal LTB." });
  });
});

describe("buildRequestEmailContext", () => {
  const BR = {
    product: "CM4 controller",
    brType: "Pilot build",
    samplePhase: null,
    quotedShipDate: new Date(2026, 10, 20),
    customerName: "",
  } as unknown as Parameters<typeof buildRequestEmailContext>[0];

  it("names the linked task above the request", () => {
    const ctx = buildRequestEmailContext(BR, { id: 3344, title: "T188-321-CM4 BOM changes" });
    expect(ctx.above).toEqual({
      label: "Task",
      title: "T188-321-CM4 BOM changes",
      url: expect.stringMatching(/\/task\/3344$/),
    });
  });

  it("lists the details that are filled in, and drops the blanks", () => {
    const ctx = buildRequestEmailContext(BR, null);
    expect(ctx.above).toBeUndefined();
    expect(ctx.details).toEqual([
      { label: "Product", value: "CM4 controller" },
      { label: "Type", value: "Pilot build" },
      { label: "Quoted ship date", value: "Fri, Nov 20, 2026" },
    ]);
    expect(ctx.description).toBeUndefined();
  });
});
