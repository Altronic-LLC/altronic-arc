import { describe, it, expect } from "vitest";
import {
  appendRecords,
  commentKey,
  commentsToCopy,
  planEirTaskBackfill,
  type BackfillEir,
  type BackfillTask,
} from "./eirTaskBackfill";
import { parseCommunication, serializeComment } from "./communicationParser";
import { isMirroredComment } from "./commentMirror";

// =============================================================================
// The one-time EIR ⇄ task backfill (2026-10-27). Shapes are the live ones:
// a Power Apps `ItemID=` Task Reference, a SharePoint form link on the task,
// an EIR re-created under a new id, a sentence typed into Task Reference, and
// two "Test" tasks claiming the same EIR.
// =============================================================================

const ARC = "https://altronic-llc.github.io/altronic-arc";
const FORM = (id: number) =>
  `https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering/Lists/EIREngineering%20Information%20Request/DispForm.aspx?ID=${id}`;
const POWER_APPS = (taskId: number) => `https://apps.powerapps.com/play/e/abc/a/def?ItemID=${taskId}`;

const rec = (iso: string, name: string, email: string, html: string) =>
  serializeComment({ timestamp: new Date(iso), authorName: name, authorEmail: email, bodyHtml: html });

function E(p: Partial<BackfillEir> & { id: number }): BackfillEir {
  return { eirNo: `EIR_2026-${String(p.id).padStart(4, "0")}`, title: "", resolution: "Promoted to Task",
    taskPromotedFlag: true, taskReference: "", communication: "", ...p };
}
function T(p: Partial<BackfillTask> & { id: number }): BackfillTask {
  return { title: "", numberedTitle: `T${p.id}-0001-x`, eirReference: null, communication: "", ...p };
}
const formLink = (id: number) => ({ url: FORM(id), label: FORM(id) });

describe("planEirTaskBackfill — pairing", () => {
  it("pairs a Power Apps promotion and leaves both of its links alone", () => {
    const plan = planEirTaskBackfill({
      eirs: [E({ id: 768, taskReference: POWER_APPS(1663) })],
      tasks: [T({ id: 1663, eirReference: formLink(768) })],
      arcUrl: ARC,
    });
    expect(plan.pairs).toHaveLength(1);
    const [p] = plan.pairs;
    expect(p.foundBy).toBe("both records");
    // The task's link is a Hyperlink column Graph can't write; it's reported only.
    expect(p).not.toHaveProperty("taskLink");
    expect(p.taskLinkBefore?.url).toBe(FORM(768));
    // The Power Apps link already resolves in ARC — left exactly as it is.
    expect(p.eirTaskReference).toBeNull();
    expect(p.setPromotedFlag).toBe(false);
  });

  it("re-pairs an EIR re-created under a new id through the number in the task's title", () => {
    const plan = planEirTaskBackfill({
      eirs: [E({ id: 1492, eirNo: "EIR_2024-0396", taskReference: POWER_APPS(1680) })],
      tasks: [T({ id: 1680, numberedTitle: "T40-0003-EIR_2024-0396 | Test sheets", eirReference: formLink(396) })],
      arcUrl: ARC,
    });
    expect(plan.pairs.map((p) => [p.eirId, p.taskId, p.foundBy])).toEqual([[1492, 1680, "both records"]]);
  });

  it("links from the task side when the EIR names nothing, and writes the numbered title on the EIR", () => {
    const plan = planEirTaskBackfill({
      eirs: [E({ id: 1069, taskReference: "" })],
      tasks: [T({ id: 2711, numberedTitle: "T1-219-EIR_2026-0103 | VSM", eirReference: formLink(1069) })],
      arcUrl: ARC,
    });
    expect(plan.pairs[0].foundBy).toBe("task's EIR link");
    expect(plan.pairs[0].eirTaskReference).toBe("T1-219-EIR_2026-0103 | VSM");
  });

  it("writes an ARC task link when the numbered title is shared with another task", () => {
    const plan = planEirTaskBackfill({
      eirs: [E({ id: 1, taskReference: "" })],
      tasks: [
        T({ id: 10, numberedTitle: "T1-0001-same", eirReference: formLink(1) }),
        T({ id: 11, numberedTitle: "T1-0001-same" }),
      ],
      arcUrl: ARC,
    });
    expect(plan.pairs[0].eirTaskReference).toBe(`${ARC}/task/10`);
  });

  it("reports a second task claiming an already-paired EIR, and never links it", () => {
    const plan = planEirTaskBackfill({
      eirs: [E({ id: 768, taskReference: POWER_APPS(1663) })],
      tasks: [T({ id: 1663, eirReference: formLink(768) }), T({ id: 1630, eirReference: formLink(768) })],
      arcUrl: ARC,
    });
    expect(plan.pairs.map((p) => p.taskId)).toEqual([1663]);
    expect(plan.conflicts.map((c) => c.taskId)).toEqual([1630]);
  });

  it("lists a promoted EIR it can't link, with the tasks naming its number as candidates", () => {
    const plan = planEirTaskBackfill({
      eirs: [E({ id: 1873, eirNo: "EIR_2026-0257", resolution: "Resolved", taskPromotedFlag: false,
        taskReference: "An alternate part has been added to AVL." })],
      tasks: [T({ id: 50, numberedTitle: "T2-0001-EIR_2026-0257 follow-up" })],
      arcUrl: ARC,
    });
    expect(plan.pairs).toEqual([]);
    expect(plan.unlinked).toHaveLength(1);
    expect(plan.unlinked[0].reason).toMatch(/doesn't name a task/);
    expect(plan.unlinked[0].candidates.map((c) => c.taskId)).toEqual([50]);
  });

  it("takes Ray's list over everything, and sets the promoted flag that was off", () => {
    const plan = planEirTaskBackfill({
      eirs: [E({ id: 1873, taskPromotedFlag: false, resolution: "Resolved", taskReference: "a sentence" })],
      tasks: [T({ id: 50 })],
      overrides: [{ eirId: 1873, taskId: 50 }],
      arcUrl: ARC,
    });
    expect(plan.pairs[0]).toMatchObject({ eirId: 1873, taskId: 50, foundBy: "your list", setPromotedFlag: true });
    expect(plan.unlinked).toEqual([]);
  });

  it("only SUGGESTS a task whose title merely names an EIR", () => {
    const plan = planEirTaskBackfill({
      eirs: [E({ id: 863, eirNo: "EIR_2025-0286", resolution: "Resolved", taskPromotedFlag: false })],
      tasks: [T({ id: 2056, numberedTitle: "T3-2001-ECN for EIR_2025-0286 | McLoone" })],
      arcUrl: ARC,
    });
    expect(plan.pairs).toEqual([]);
    expect(plan.suggestions.map((s) => [s.eirId, s.taskId])).toEqual([[863, 2056]]);
  });
});

describe("commentsToCopy", () => {
  const eirComments = [
    rec("2026-01-05T15:00:00Z", "Glenn Terry", "glenn.terry@altronic-llc.com", "<p>Original question</p>"),
    rec("2026-01-06T15:00:00Z", "Sheila Horn", "sheila.horn@altronic-llc.com", "<p>Second note</p>"),
  ].join("\n");

  it("copies each comment under the origin banner, keeping author and time", () => {
    const out = commentsToCopy(eirComments, "", { kind: "eir", id: 768, label: "EIR_2025-0191" });
    const parsed = parseCommunication(out.join("\n"));
    expect(parsed).toHaveLength(2);
    expect(parsed.every((c) => isMirroredComment(c.bodyHtml))).toBe(true);
    expect(parsed.map((c) => c.authorName).sort()).toEqual(["Glenn Terry", "Sheila Horn"]);
    expect(parsed.find((c) => c.authorName === "Glenn Terry")!.timestamp.toISOString()).toBe("2026-01-05T15:00:00.000Z");
    expect(parsed[0].bodyHtml).toContain('href="/eir/768"');
  });

  it("skips a comment already carried over by ARC's promotion", () => {
    const task = rec("2026-02-01T10:00:00Z", "Glenn Terry", "glenn.terry@altronic-llc.com",
      "<p>Original question</p><p><em>— carried over from EIR EIR_2025-0191</em></p>");
    const out = commentsToCopy(eirComments, task, { kind: "eir", id: 768, label: "EIR_2025-0191" });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Second note");
  });

  it("never copies copies: the promotion note, carried-over comments and mirrors stay put", () => {
    const task = [
      rec("2026-02-01T10:00:00Z", "Ray White", "ray.white@altronic-llc.com", "<p><em>Promoted from EIR <strong>EIR_2025-0191</strong>.</em></p>"),
      rec("2026-02-01T10:00:01Z", "Glenn Terry", "glenn.terry@altronic-llc.com", "<p>x</p><p><em>— carried over from EIR EIR_2025-0191</em></p>"),
      rec("2026-02-02T10:00:00Z", "Amy", "amy@altronic-llc.com", '<p><span class="comment-origin" data-origin-kind="buildRequest" data-origin-id="9"><em>Posted on build request BR-1.</em></span></p><p>br</p>'),
      rec("2026-02-03T10:00:00Z", "Amy", "amy@altronic-llc.com", "<p>Real task comment</p>"),
    ].join("\n");
    const out = commentsToCopy(task, eirComments, { kind: "task", id: 1663, label: "T41" });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Real task comment");
  });

  it("plans nothing on a second run (the copies are recognised)", () => {
    const origin = { kind: "eir" as const, id: 768, label: "EIR_2025-0191" };
    const firstRun = commentsToCopy(eirComments, "", origin);
    const taskAfter = appendRecords("", firstRun);
    expect(commentsToCopy(eirComments, taskAfter, origin)).toEqual([]);
  });

  it("treats the same words from the same person as one comment, whatever the markup", () => {
    expect(commentKey({ authorEmail: "A@x.com", authorName: "", bodyHtml: "<p>Hello   world</p>" }))
      .toBe(commentKey({ authorEmail: "a@x.com", authorName: "", bodyHtml: "<div>Hello world</div>" }));
  });
});

describe("appendRecords", () => {
  it("appends on a new line, and starts an empty thread cleanly", () => {
    expect(appendRecords("a\n\n", ["b", "c"])).toBe("a\nb\nc");
    expect(appendRecords("", ["b"])).toBe("b");
    expect(appendRecords("a", [])).toBe("a");
  });
});
