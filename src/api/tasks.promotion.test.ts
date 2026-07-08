import { describe, it, expect } from "vitest";
import { createTask } from "./tasks";
import { serializeComments } from "@/lib/communicationParser";

// USE_MOCK is true by default under Vitest, so createTask hits the in-memory
// mock branch — these assert the EIR-promotion inputs land on the new task.
describe("createTask (mock) — EIR promotion fields", () => {
  it("stores the eirReference hyperlink and seeds comments from communication", async () => {
    const communication = serializeComments([
      {
        timestamp: new Date(2026, 4, 11, 9, 15, 0),
        authorName: "Sarah",
        authorEmail: "s@e.com",
        bodyHtml: "<p>carried</p>",
      },
    ]);
    const task = await createTask({
      title: "Promoted task",
      eirReference: { url: "https://x/eir/1", label: "EIR_2026-0042" },
      communication,
    });
    expect(task.eirReference).toEqual({ url: "https://x/eir/1", label: "EIR_2026-0042" });
    expect(task.comments).toHaveLength(1);
    expect(task.comments[0].authorName).toBe("Sarah");
    expect(task.comments[0].bodyHtml).toBe("<p>carried</p>");
  });

  it("defaults eirReference to null and no comments for a plain task", async () => {
    const task = await createTask({ title: "Plain task" });
    expect(task.eirReference).toBeNull();
    expect(task.comments).toEqual([]);
  });
});
