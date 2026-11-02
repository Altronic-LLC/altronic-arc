import type { Comment, Person } from "@/types/task";
import type { Quote, QuoteAssembly } from "@/types/quote";
import type { ChangeEmail } from "./changeAlerts";
import { serializeComments } from "./communicationParser";
import { appItemPath } from "./appUrl";
import { ORIGIN_MARKER_CLASS } from "./commentMirror";
import { escapeHtml } from "./mentions";
import { revisionsOf } from "./quoteNumber";

// =============================================================================
// A WON Insourcing Quote → an Engineering or Operations task (Ray, 2026-10-30).
//
// The EIR → Task promotion, for quotes: the task carries the quote's
// discussion (original authors and times), its watchers, a description built
// from the quote, and its attachments; the quote records the task and project
// in its Linked work columns and says so in its own discussion. From then on
// a comment on either side is copied to the other (`useCommentMirror.ts`).
//
// **Only a task CREATED from the quote shares its conversation** (Ray: "only
// button links"). A task picked by hand under Linked work is a reference, not
// the quote's work. So the pair is proven from BOTH sides, the EIR rule:
//   - the task's thread holds the "Created from won quote" header, which
//     carries `data-created-from-quote` (the quote's id) and `data-quote-base`;
//   - the quote's EngineeringTaskId / OperationsTaskId names that task.
// No new column on any list: the marker is the header comment ARC writes
// anyway, and its ORIGIN banner makes its link route in-app.
//
// **Task → quote goes to the LATEST revision of the base** (Ray). A new
// revision copies the links forward, so R1 and R2 can both name the task; the
// conversation is the current rev's.
// =============================================================================

/** Which task list a quote's task lives on. */
export type QuoteTaskDepartment = "engineering" | "operations";

/** The comment-mirror kind of each department's task. */
export function quoteTaskKind(dept: QuoteTaskDepartment): "task" | "operationsTask" {
  return dept === "engineering" ? "task" : "operationsTask";
}

/** "Engineering" / "Operations". */
export function departmentLabel(dept: QuoteTaskDepartment): string {
  return dept === "engineering" ? "Engineering" : "Operations";
}

/** The quote's stored task id for a department. */
export function quoteTaskIdFor(quote: Pick<Quote, "engineeringTaskId" | "operationsTaskId">, dept: QuoteTaskDepartment): number | null {
  return dept === "engineering" ? quote.engineeringTaskId : quote.operationsTaskId;
}

// -----------------------------------------------------------------------------
// Who may create one
// -----------------------------------------------------------------------------

/**
 * Why a task can't be created from this quote for `dept`, or null when it
 * can. The ROLE half (quoter or manager) is `editQuoteGate`; this is the
 * quote's half, asked by the button AND inside the mutation against a fresh
 * read.
 */
export function quoteTaskRefusal(
  quote: Pick<Quote, "status" | "engineeringTaskId" | "operationsTaskId">,
  dept: QuoteTaskDepartment,
): string | null {
  if (quote.status !== "Won") return "A task can only be created once the quote is Won.";
  if (quoteTaskIdFor(quote, dept) !== null) {
    return `This quote is already linked to an ${departmentLabel(dept)} task.`;
  }
  return null;
}

// -----------------------------------------------------------------------------
// The marker
// -----------------------------------------------------------------------------

/** Where a task came from, read off its own thread. */
export interface QuoteOrigin {
  /** The quote revision the task was created from. */
  quoteId: number;
  quoteBase: string;
  quoteNumber: string;
}

const MARKER_TAG = /<span\b[^>]*\bdata-created-from-quote="(\d+)"[^>]*>/i;

function attr(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag);
  return m ? unescapeAttr(m[1]) : "";
}

function unescapeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * The quote a task was created from, or null. Read from the OLDEST comment
 * carrying the marker — the header ARC wrote at creation (comments arrive
 * newest-first).
 */
export function quoteOriginOfTask(
  comments: readonly Pick<Comment, "bodyHtml">[] | null | undefined,
): QuoteOrigin | null {
  if (!comments) return null;
  for (let i = comments.length - 1; i >= 0; i--) {
    const m = MARKER_TAG.exec(comments[i].bodyHtml);
    if (!m) continue;
    const quoteBase = attr(m[0], "data-quote-base");
    if (!quoteBase) continue;
    return { quoteId: parseInt(m[1], 10), quoteBase, quoteNumber: attr(m[0], "data-quote-number") };
  }
  return null;
}

/**
 * The quote revision a task's comments are copied to: the LATEST rev of the
 * base the task was created from, and only while that rev still names the
 * task in its link column. Null otherwise — copying onto the wrong record is
 * worse than not copying.
 */
export function linkedQuoteForTask(
  task: { id: number; comments: readonly Pick<Comment, "bodyHtml">[] },
  dept: QuoteTaskDepartment,
  quotes: readonly Quote[],
): Quote | null {
  const origin = quoteOriginOfTask(task.comments);
  if (!origin) return null;
  const latest = revisionsOf(origin.quoteBase, quotes)[0];
  if (!latest) return null;
  return quoteTaskIdFor(latest, dept) === task.id ? latest : null;
}

/**
 * The task a quote's comment is copied to for `dept`: the task its link
 * column names, and only when that task was created from this quote's base.
 */
export function linkedTaskForQuote<T extends { id: number; comments: readonly Pick<Comment, "bodyHtml">[] }>(
  quote: Pick<Quote, "quoteBase" | "engineeringTaskId" | "operationsTaskId">,
  dept: QuoteTaskDepartment,
  tasks: readonly T[],
): T | null {
  const id = quoteTaskIdFor(quote, dept);
  if (id === null) return null;
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;
  const origin = quoteOriginOfTask(task.comments);
  return origin && origin.quoteBase.trim().toUpperCase() === quote.quoteBase.trim().toUpperCase()
    ? task
    : null;
}

// -----------------------------------------------------------------------------
// What the task carries
// -----------------------------------------------------------------------------

/** The new task's description — plain text, built from the quote. */
export function buildQuoteTaskDescription(args: {
  quote: Pick<Quote, "quoteNumber" | "customerReference" | "projectContext">;
  customerName: string | null;
  lines: readonly Pick<QuoteAssembly, "lineNo" | "altronicPartNumber" | "description" | "quotedQty">[];
}): string {
  const { quote, customerName, lines } = args;
  const out: string[] = [`Won quote ${quote.quoteNumber}${customerName ? ` — ${customerName}` : ""}`];
  if (quote.customerReference.trim()) out.push(`Customer reference: ${quote.customerReference.trim()}`);
  if (quote.projectContext.trim()) out.push("", "Project context:", quote.projectContext.trim());
  if (lines.length > 0) {
    out.push("", "Lines:");
    for (const l of [...lines].sort((a, b) => a.lineNo - b.lineNo)) {
      const name = [l.altronicPartNumber, l.description].filter((s) => s.trim()).join(" — ") || `Line ${l.lineNo}`;
      out.push(`${l.lineNo}. ${name} × ${l.quotedQty}`);
    }
  }
  return out.join("\n");
}

/** The header comment that marks a task as created from a quote. */
export function quoteOriginHeaderHtml(quote: Pick<Quote, "id" | "quoteBase" | "quoteNumber">, hasDiscussion: boolean): string {
  const number = escapeHtml(quote.quoteNumber);
  return (
    `<p><span class="${ORIGIN_MARKER_CLASS}" data-origin-kind="quote" data-origin-id="${quote.id}"` +
    ` data-created-from-quote="${quote.id}" data-quote-base="${escapeHtml(quote.quoteBase)}"` +
    ` data-quote-number="${number}">` +
    `<em>Created from won quote <strong>${number}</strong>.</em> ` +
    `<a href="${escapeHtml(appItemPath("quote", quote.id))}">Open the quote</a>` +
    `</span></p>` +
    (hasDiscussion ? "<p><em>The quote's discussion is carried over below.</em></p>" : "")
  );
}

/**
 * The new task's `Communication`: the marker header, then every quote
 * comment oldest-first with its original author and time, tagged — the
 * `buildPromotedCommunication` layout.
 */
export function buildQuoteTaskCommunication(args: {
  quote: Pick<Quote, "id" | "quoteBase" | "quoteNumber" | "comments">;
  createdBy: { displayName: string; email: string };
  now: Date;
}): string {
  const { quote, createdBy, now } = args;
  const number = escapeHtml(quote.quoteNumber);
  const header = {
    timestamp: now,
    authorName: createdBy.displayName || "ARC",
    authorEmail: createdBy.email || "",
    bodyHtml: quoteOriginHeaderHtml(quote, quote.comments.length > 0),
  };
  const carried = [...quote.comments]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map((c) => ({
      timestamp: c.timestamp,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      bodyHtml: `${c.bodyHtml}<p><em>— carried over from quote ${number}</em></p>`,
    }));
  return serializeComments([header, ...carried]);
}

/**
 * The note posted on the QUOTE naming the new task. It carries the origin
 * banner, so its link routes in-app and the mirror never copies it back.
 */
export function quoteTaskCreatedCommentHtml(
  dept: QuoteTaskDepartment,
  task: { id: number; label: string },
  project: string,
): string {
  const kind = quoteTaskKind(dept);
  return (
    `<p><span class="${ORIGIN_MARKER_CLASS}" data-origin-kind="${kind}" data-origin-id="${task.id}">` +
    `<em>${departmentLabel(dept)} task <strong>${escapeHtml(task.label)}</strong> was created from this quote` +
    `${project ? ` under project ${escapeHtml(project)}` : ""}. Comments here and on the task are now shared.</em> ` +
    `<a href="${escapeHtml(appItemPath(kind, task.id))}">Open the task</a>` +
    `</span></p>`
  );
}

/** Email to the quote's watchers (minus whoever created the task). */
export function buildQuoteTaskEmails(args: {
  quoteNumber: string;
  dept: QuoteTaskDepartment;
  taskLabel: string;
  watchers: readonly Person[];
  actor: Person;
}): ChangeEmail[] {
  const actorEmail = (args.actor.email ?? "").trim().toLowerCase();
  const seen = new Set<string>();
  const recipients: Person[] = [];
  for (const p of args.watchers) {
    const key = (p.email ?? "").trim().toLowerCase();
    if (!key || key === actorEmail || seen.has(key)) continue;
    seen.add(key);
    recipients.push(p);
  }
  const actorName = escapeHtml(args.actor.displayName || "Someone");
  const dept = departmentLabel(args.dept);
  return recipients.map((p) => ({
    email: p.email ?? "",
    displayName: p.displayName,
    subject: `${dept} task created from ${args.quoteNumber}`,
    headlineHtml: `<strong>${actorName}</strong> created ${dept} task <strong>${escapeHtml(args.taskLabel)}</strong> from won quote <strong>${escapeHtml(args.quoteNumber)}</strong>.`,
    detailHtml:
      '<div style="font-size:14px;">Comments on the quote and on the task are now copied to each other — open the task below.</div>',
  }));
}
