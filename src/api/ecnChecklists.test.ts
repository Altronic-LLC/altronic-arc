import { describe, expect, it, beforeEach } from "vitest";
import * as api from "./ecnChecklists";
import {
  __resetEcnChecklistMockStore,
  createEcnChecklist,
  getChecklistForEcn,
  getEcnChecklist,
  listEcnChecklists,
  saveChecklistAnswers,
  setChecklistCompletedBy,
} from "./ecnChecklists";
import { parseAnswers, progressFor } from "@/lib/ecnChecklist";
import { ECN_CHECKLIST_ITEMS } from "@/lib/ecnChecklistTemplate";

const KEY_A = ECN_CHECKLIST_ITEMS[0].key;
const KEY_B = ECN_CHECKLIST_ITEMS[1].key;

beforeEach(() => {
  __resetEcnChecklistMockStore();
});

describe("the module's shape", () => {
  it("exports NO delete — a checklist records a review that was done", () => {
    // Same call as the ECNs list it hangs off, which has no delete either.
    const offenders = Object.keys(api).filter((k) => /delete|remove/i.test(k));
    expect(offenders).toEqual([]);
  });
});

describe("reading", () => {
  it("lists the seeded checklists", async () => {
    const all = await listEcnChecklists();
    expect(all.length).toBeGreaterThan(0);
  });

  it("finds the checklist for an ECN, and null for one without", async () => {
    const found = await getChecklistForEcn(1);
    expect(found?.ecnId).toBe(1);
    // ECN 4 deliberately has no checklist, so the Create button is reachable.
    expect(await getChecklistForEcn(4)).toBeNull();
  });

  it("returns null for a checklist id that doesn't exist", async () => {
    expect(await getEcnChecklist(9999)).toBeNull();
  });

  it("seeds one checklist at each stage, so every state is visible in mock mode", async () => {
    const all = await listEcnChecklists();
    const statuses = all.map((c) => c.status);
    expect(statuses).toContain("In Progress");
    expect(statuses).toContain("Complete");
    expect(statuses).toContain("Not Started");
  });
});

describe("creating", () => {
  it("creates an empty checklist for an ECN that has none", async () => {
    const created = await createEcnChecklist(4, "260057");
    expect(created.ecnId).toBe(4);
    expect(created.status).toBe("Not Started");
    expect(created.itemsTotal).toBe(84);
    expect(parseAnswers(created.answersJson).items).toEqual({});
  });

  it("adds the creator as a watcher", async () => {
    const actor = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };
    const created = await createEcnChecklist(4, "260057", actor);
    expect(created.watchers.map((w) => w.email)).toContain(actor.email);
  });

  it("returns the EXISTING checklist rather than creating a second", async () => {
    const before = await listEcnChecklists();
    const again = await createEcnChecklist(1, "260062");
    const after = await listEcnChecklists();
    expect(again.ecnId).toBe(1);
    expect(after).toHaveLength(before.length);
  });
});

describe("saving answers", () => {
  it("records a tick and its findings", async () => {
    const saved = await saveChecklistAnswers(3, {
      [KEY_A]: { status: "complete", findings: "Checked the log." },
    });
    const answers = parseAnswers(saved.answersJson);
    expect(answers.items[KEY_A]).toEqual({ status: "complete", findings: "Checked the log." });
  });

  it("keeps answers already recorded on other items", async () => {
    await saveChecklistAnswers(3, { [KEY_A]: { status: "complete", findings: "" } });
    const saved = await saveChecklistAnswers(3, { [KEY_B]: { status: "na", findings: "" } });
    const answers = parseAnswers(saved.answersJson);
    expect(answers.items[KEY_A]?.status).toBe("complete");
    expect(answers.items[KEY_B]?.status).toBe("na");
  });

  it("moves the rollups in step with the blob", async () => {
    const saved = await saveChecklistAnswers(3, {
      [KEY_A]: { status: "complete", findings: "" },
      [KEY_B]: { status: "flagged", findings: "Needs Compliance" },
    });
    expect(saved.itemsComplete).toBe(1);
    expect(saved.itemsFlagged).toBe(1);
    expect(saved.status).toBe("In Progress");
    // And the rollups agree with the blob they summarise.
    const p = progressFor(parseAnswers(saved.answersJson));
    expect(p.complete).toBe(saved.itemsComplete);
    expect(p.flagged).toBe(saved.itemsFlagged);
  });

  it("clears an answer back to untouched", async () => {
    await saveChecklistAnswers(3, { [KEY_A]: { status: "complete", findings: "" } });
    const saved = await saveChecklistAnswers(3, {
      [KEY_A]: { status: "notStarted", findings: "" },
    });
    expect(parseAnswers(saved.answersJson).items[KEY_A]).toBeUndefined();
    expect(saved.itemsComplete).toBe(0);
  });
});

describe("the sign-off", () => {
  it("stamps who finished it, and when", async () => {
    const saved = await setChecklistCompletedBy(3, {
      displayName: "Ray White",
      email: "ray.white@altronic-llc.com",
    });
    expect(saved.completedBy?.displayName).toBe("Ray White");
    expect(saved.completedDate).toBeInstanceOf(Date);
  });

  it("clears the sign-off when set back to nobody", async () => {
    await setChecklistCompletedBy(3, { displayName: "Ray White" });
    const saved = await setChecklistCompletedBy(3, null);
    expect(saved.completedBy).toBeNull();
    expect(saved.completedDate).toBeNull();
  });
});
