import { describe, expect, it } from "vitest";
import type { Task } from "@/types/task";
import { matchEirTaskReference, resolveEirTaskReference, taskIdFromLink } from "./eirTaskReference";

/** Only the two fields the resolver reads. */
function task(id: number, numberedTitle: string): Task {
  return { id, numberedTitle } as Task;
}

// The live T188s at the time EIR_2026-0270 was reported (2026-10-08). The
// numbers restart per project, so all three are real and distinct, and the
// wrong one (2142) comes FIRST in list order — exactly what the old
// prefix-only match picked.
const T188_SAVES = task(2142, "T188-328-SAVeS Thermal Isolation Prototype Plate");
const T188_AUDIT = task(2788, "T188-0001-Annual Chemical Audit");
const T188_CM4 = task(3344, "T188-321--CM4 BOM changes  1013-8626-00");
const T115 = task(115, "T115-0000-Potential for Broken links when system migrates");
const TASKS = [T188_SAVES, T188_AUDIT, T188_CM4, T115];

describe("EIR_2026-0270 — the reported bug", () => {
  it("links the full numbered title ARC's promotion wrote to THAT task, not the first T188", () => {
    expect(resolveEirTaskReference("T188-321--CM4 BOM changes  1013-8626-00", TASKS)).toBe(T188_CM4);
  });

  it("links the ARC task URL Brandon pasted to fix it by hand", () => {
    expect(
      resolveEirTaskReference("https://altronic-llc.github.io/altronic-arc/task/3344", TASKS),
    ).toBe(T188_CM4);
  });
});

describe("matchEirTaskReference — a full numbered title", () => {
  it("matches exactly, ignoring case and runs of spaces", () => {
    expect(resolveEirTaskReference("t188-321--cm4 bom changes 1013-8626-00", TASKS)).toBe(T188_CM4);
  });

  it("never falls back to the T-number for a title no task carries", () => {
    // Renamed since, or a typo: it must not turn into "the first T188".
    expect(matchEirTaskReference("T188-999-Something else entirely", TASKS)).toEqual({
      task: null,
      ambiguous: [],
    });
  });
});

describe("matchEirTaskReference — a short T-number", () => {
  it("links a bare T-number when exactly one task carries it", () => {
    expect(resolveEirTaskReference("T115", TASKS)).toBe(T115);
  });

  it("links NOTHING when the T-number repeats across projects, and offers every match", () => {
    const match = matchEirTaskReference("T188", TASKS);
    expect(match.task).toBeNull();
    expect(match.ambiguous).toEqual([T188_SAVES, T188_AUDIT, T188_CM4]);
  });

  it("a T-number plus project code narrows it to one", () => {
    expect(resolveEirTaskReference("T188-321", TASKS)).toBe(T188_CM4);
    expect(resolveEirTaskReference("T188-0001", TASKS)).toBe(T188_AUDIT);
  });

  it("doesn't let T18 match T188", () => {
    expect(matchEirTaskReference("T18", TASKS)).toEqual({ task: null, ambiguous: [] });
  });
});

describe("matchEirTaskReference — links and ids", () => {
  it("reads a Power Apps ItemID deep link", () => {
    expect(
      resolveEirTaskReference("https://apps.powerapps.com/play/e/abc?tenantId=x&ItemID=2788", TASKS),
    ).toBe(T188_AUDIT);
  });

  it("reads an ARC task link from any origin, with or without a trailing part", () => {
    expect(resolveEirTaskReference("http://localhost:5173/task/115", TASKS)).toBe(T115);
    expect(resolveEirTaskReference("https://x.example/altronic-arc/task/115?tab=1", TASKS)).toBe(T115);
  });

  it("a link to a task that isn't loaded links nothing, rather than guessing", () => {
    expect(resolveEirTaskReference("https://x.example/altronic-arc/task/9999", TASKS)).toBeNull();
  });

  it("reads a bare item id", () => {
    expect(resolveEirTaskReference("2142", TASKS)).toBe(T188_SAVES);
  });

  it("is null for blank, whitespace or unrelated text", () => {
    expect(resolveEirTaskReference("", TASKS)).toBeNull();
    expect(resolveEirTaskReference("   ", TASKS)).toBeNull();
    expect(resolveEirTaskReference(null, TASKS)).toBeNull();
    expect(resolveEirTaskReference("see Brandon", TASKS)).toBeNull();
  });
});

describe("taskIdFromLink", () => {
  it("is the id only for a link to a task", () => {
    expect(taskIdFromLink("https://a.example/altronic-arc/task/3344")).toBe(3344);
    expect(taskIdFromLink("https://apps.powerapps.com/x?ItemID=12")).toBe(12);
    expect(taskIdFromLink("T188")).toBeNull();
    expect(taskIdFromLink("https://a.example/altronic-arc/eir/3344")).toBeNull();
    expect(taskIdFromLink("https://a.example/task/3344/comments")).toBe(3344);
  });
});
