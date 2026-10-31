import { describe, expect, it } from "vitest";
import { MOCK_QUOTES } from "@/data/quoteMockData";
import type { Quote } from "@/types/quote";
import { parseCommunication } from "./communicationParser";
import { isMirroredComment, mirrorTargetsFor } from "./commentMirror";
import {
  buildQuoteTaskCommunication,
  buildQuoteTaskDescription,
  buildQuoteTaskEmails,
  linkedQuoteForTask,
  linkedTaskForQuote,
  quoteOriginHeaderHtml,
  quoteOriginOfTask,
  quoteTaskCreatedCommentHtml,
  quoteTaskRefusal,
} from "./quoteToTask";

const WON: Quote = {
  ...MOCK_QUOTES.find((q) => q.status === "Won")!,
  id: 30,
  quoteNumber: "IQ-WAB-0002-R1",
  quoteBase: "IQ-WAB-0002",
  rev: 1,
  engineeringTaskId: null,
  operationsTaskId: null,
  comments: [
    { timestamp: new Date("2026-10-02T15:00:00Z"), authorName: "Bob", authorEmail: "bob@x.com", bodyHtml: "<p>second</p>", attachments: [] },
    { timestamp: new Date("2026-10-01T15:00:00Z"), authorName: "Ann", authorEmail: "ann@x.com", bodyHtml: "<p>first</p>", attachments: [] },
  ],
};

/** A task's thread as ARC writes it when created from `quote`. */
function threadFrom(quote: Quote) {
  return parseCommunication(
    buildQuoteTaskCommunication({ quote, createdBy: { displayName: "Ray", email: "ray@x.com" }, now: new Date("2026-10-30T12:00:00Z") }),
  );
}

describe("quoteTaskRefusal", () => {
  it("only a Won quote, and only once per department", () => {
    expect(quoteTaskRefusal(WON, "engineering")).toBeNull();
    expect(quoteTaskRefusal({ ...WON, status: "Sent" }, "engineering")).toMatch(/once the quote is Won/);
    const linked = { ...WON, engineeringTaskId: 9 };
    expect(quoteTaskRefusal(linked, "engineering")).toMatch(/already linked to an Engineering task/);
    expect(quoteTaskRefusal(linked, "operations")).toBeNull();
  });
});

describe("the task's Communication", () => {
  it("leads with the marker header, then the quote's comments oldest-first with their authors", () => {
    const thread = threadFrom(WON); // newest first — the header, stamped now, is on top
    const header = thread[0];
    expect(header.authorName).toBe("Ray");
    expect(header.bodyHtml).toContain('data-created-from-quote="30"');
    expect(header.bodyHtml).toContain("carried over below");
    const carried = thread.slice(1).reverse();
    expect(carried.map((c) => c.authorName)).toEqual(["Ann", "Bob"]);
    expect(carried[0].timestamp.toISOString()).toBe("2026-10-01T15:00:00.000Z");
    expect(carried[0].bodyHtml).toContain("carried over from quote IQ-WAB-0002-R1");
  });

  it("the header is an origin banner, so it is never mirrored and its link routes", () => {
    const html = quoteOriginHeaderHtml(WON, false);
    expect(isMirroredComment(html)).toBe(true);
    expect(html).toContain('href="/sales/quotes/30"');
    expect(html).not.toContain("carried over");
  });

  it("the marker reads back the quote", () => {
    expect(quoteOriginOfTask(threadFrom(WON))).toEqual({
      quoteId: 30,
      quoteBase: "IQ-WAB-0002",
      quoteNumber: "IQ-WAB-0002-R1",
    });
    expect(quoteOriginOfTask([{ bodyHtml: "<p>no marker</p>" }])).toBeNull();
  });
});

describe("who shares a conversation", () => {
  const task = { id: 77, comments: threadFrom(WON) };

  it("a task goes to the LATEST revision of its quote, while that rev still names it", () => {
    const r1 = { ...WON, engineeringTaskId: 77 };
    const r2 = { ...WON, id: 31, rev: 2, quoteNumber: "IQ-WAB-0002-R2", engineeringTaskId: 77 };
    expect(linkedQuoteForTask(task, "engineering", [r1, r2])?.id).toBe(31);
    // R2 unlinked it: nothing, never the old rev.
    expect(linkedQuoteForTask(task, "engineering", [r1, { ...r2, engineeringTaskId: null }])).toBeNull();
    // The Operations column doesn't count for an Engineering task.
    expect(linkedQuoteForTask(task, "operations", [r1, r2])).toBeNull();
  });

  it("a task linked BY HAND (no marker) shares nothing", () => {
    const manual = { id: 77, comments: [] };
    expect(linkedQuoteForTask(manual, "engineering", [{ ...WON, engineeringTaskId: 77 }])).toBeNull();
    expect(linkedTaskForQuote({ ...WON, engineeringTaskId: 77 }, "engineering", [manual])).toBeNull();
  });

  it("a quote goes to the task its column names, when that task came from this base", () => {
    expect(linkedTaskForQuote({ ...WON, engineeringTaskId: 77 }, "engineering", [task])?.id).toBe(77);
    expect(linkedTaskForQuote({ ...WON, quoteBase: "IQ-ZZZ-0009", engineeringTaskId: 77 }, "engineering", [task])).toBeNull();
  });

  it("mirror routing: quote → both tasks; each task → the quote; nothing chains", () => {
    const origin = { kind: "quote" as const, id: 30, label: "IQ" };
    expect(
      mirrorTargetsFor({ kind: "quote", origin, taskId: 77, buildRequestId: 5, eirId: 6, operationsTaskId: 88 }).map(
        (t) => `${t.kind}:${t.id}`,
      ),
    ).toEqual(["task:77", "operationsTask:88"]);
    expect(
      mirrorTargetsFor({ kind: "operationsTask", origin: { ...origin, kind: "operationsTask" }, taskId: null, buildRequestId: null, quoteId: 30 }).map(
        (t) => `${t.kind}:${t.id}`,
      ),
    ).toEqual(["quote:30"]);
    expect(
      mirrorTargetsFor({ kind: "task", origin: { ...origin, kind: "task" }, taskId: 77, buildRequestId: null, quoteId: 30 }).map(
        (t) => `${t.kind}:${t.id}`,
      ),
    ).toEqual(["quote:30"]);
    // A build request's comment reaches its task, never the quote behind it.
    expect(
      mirrorTargetsFor({ kind: "buildRequest", origin: { ...origin, kind: "buildRequest" }, taskId: 77, buildRequestId: 5, quoteId: 30 }).map(
        (t) => t.kind,
      ),
    ).toEqual(["task"]);
  });
});

describe("what's written", () => {
  it("the description names the quote, customer, reference, context and lines", () => {
    const text = buildQuoteTaskDescription({
      quote: { quoteNumber: "IQ-WAB-0002-R1", customerReference: "RFQ 4471", projectContext: "Retrofit for 2027." },
      customerName: "Wabtec",
      lines: [
        { lineNo: 2, altronicPartNumber: "593027-15", description: "Harness", quotedQty: 120 },
        { lineNo: 1, altronicPartNumber: "", description: "", quotedQty: 1 },
      ],
    });
    expect(text).toBe(
      "Won quote IQ-WAB-0002-R1 — Wabtec\nCustomer reference: RFQ 4471\n\nProject context:\nRetrofit for 2027.\n\nLines:\n1. Line 1 × 1\n2. 593027-15 — Harness × 120",
    );
  });

  it("the quote's note links to the task and is never mirrored back", () => {
    const html = quoteTaskCreatedCommentHtml("operations", { id: 88, label: "Task 0035-4" }, "0035-Aqueous");
    expect(html).toContain('href="/operations/task/88"');
    expect(html).toContain("Operations task <strong>Task 0035-4</strong>");
    expect(html).toContain("0035-Aqueous");
    expect(isMirroredComment(html)).toBe(true);
  });

  it("emails the quote's watchers, never the actor, once each", () => {
    const actor = { displayName: "Ray", email: "RAY@x.com" };
    const out = buildQuoteTaskEmails({
      quoteNumber: "IQ-WAB-0002-R1",
      dept: "engineering",
      taskLabel: "T5-0017-Retrofit",
      watchers: [{ displayName: "Bob", email: "bob@x.com" }, { displayName: "Bob", email: "BOB@x.com" }, { displayName: "Ray", email: "ray@x.com" }, { displayName: "Ghost" }],
      actor,
    });
    expect(out.map((e) => e.email)).toEqual(["bob@x.com"]);
    expect(out[0].headlineHtml).toContain("Engineering task <strong>T5-0017-Retrofit</strong>");
  });
});
