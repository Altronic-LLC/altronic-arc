import { graphFetch } from "./graph";
import { SHARED_MAILBOX, USE_MOCK } from "./config";
import type { CommentAttachment, Person } from "@/types/task";
import { appItemUrl } from "@/lib/appUrl";
import {
  buildAssigneeChangeEmails,
  buildChecklistToggleEmails,
  buildFieldChangeEmails,
  buildPromotionEmails,
  type ChangeEmail,
  type ChangeTarget,
} from "@/lib/changeAlerts";

// =============================================================================
// Email notifications via Microsoft Graph sendMail.
//
// One entry point: notifyMentions(). It takes the comment that was just posted
// on a task OR an EIR, the recipients (extracted from the mention chips in the
// body), the sender + item context, and any attachments from the comment. Mail
// goes out FROM the shared mailbox configured via VITE_SHARED_MAILBOX (requires
// Send-As permission for the signed-in user in Exchange).
//
// Mock mode logs to console instead of sending — useful for demos. Real mode
// without VITE_SHARED_MAILBOX set also falls back to console (loud warning so
// the misconfiguration is obvious).
// =============================================================================

export interface MentionRecipient {
  email: string;
  displayName: string;
  /**
   * Why they're being notified — "mentioned" or a "watching" comment alert,
   * or "edited" when the author checked "Notify everyone again" after
   * editing an existing comment.
   */
  reason: "mentioned" | "watching" | "edited";
}

/** What the mention is on — drives the wording, link, and button text. */
export interface MentionTarget {
  kind: "task" | "eir" | "operationsTask" | "buildRequest" | "buildRequestItem";
  id: number;
  title: string;
}

/** Per-kind copy for the email templates — one row per notification target type. */
const KIND_COPY: Record<
  MentionTarget["kind"],
  { phrase: string; calloutLabel: string; buttonText: string }
> = {
  task: { phrase: "a task", calloutLabel: "Task", buttonText: "Open this task" },
  eir: { phrase: "an EIR", calloutLabel: "EIR", buttonText: "Open this EIR" },
  operationsTask: { phrase: "a task", calloutLabel: "Task", buttonText: "Open this task" },
  buildRequest: {
    phrase: "a build request",
    calloutLabel: "Build Request",
    buttonText: "Open this build request",
  },
  buildRequestItem: {
    phrase: "a build request part",
    calloutLabel: "Build Request Part",
    buttonText: "Open this part",
  },
};

export interface NotifyMentionsInput {
  recipients: MentionRecipient[];
  sender: Person;
  target: MentionTarget;
  /** Plain-text excerpt of the comment for the email body. */
  commentExcerpt: string;
  attachments: CommentAttachment[];
}

/**
 * Send a "you were mentioned" email to each recipient. Best-effort:
 * we log + swallow per-recipient failures instead of aborting the batch.
 * Comment posting is the user-visible action; we don't want a flaky mail
 * server to make the comment look like it failed.
 */
export async function notifyMentions(input: NotifyMentionsInput): Promise<void> {
  // Send to every mention, including self-mentions — some users like to
  // @-themselves as a "remind me later" mechanism that lands in their inbox.
  const recipients = input.recipients.filter((r) => !!r.email);
  if (recipients.length === 0) return;

  // Mock mode: no real send. Log so the user can verify in console.
  if (USE_MOCK) {
    // eslint-disable-next-line no-console
    console.info("[email mock] @-mention notifications:", {
      from: SHARED_MAILBOX ?? "(no shared mailbox configured)",
      to: recipients.map((r) => r.email),
      sender: input.sender.displayName,
      kind: input.target.kind,
      item: input.target.title,
      url: itemUrl(input.target.kind, input.target.id),
      attachmentCount: input.attachments.length,
    });
    return;
  }

  if (!SHARED_MAILBOX) {
    console.warn(
      "[email] VITE_SHARED_MAILBOX is not set — skipping @-mention emails. " +
        "Set it to a mailbox that the signed-in user has Send-As permission on.",
    );
    return;
  }

  // Encode each attachment to base64 once (rather than per-recipient).
  const encoded = await Promise.all(
    input.attachments.map((a) => encodeAttachment(a)),
  ).catch((err) => {
    console.warn("[email] Failed to encode attachments — sending without them.", err);
    return [] as GraphFileAttachment[];
  });

  for (const recipient of recipients) {
    try {
      await sendOne({
        recipient,
        sender: input.sender,
        target: input.target,
        commentExcerpt: input.commentExcerpt,
        attachments: encoded,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[email] Failed to notify ${recipient.email}:`, err);
    }
  }
}

interface GraphFileAttachment {
  "@odata.type": "#microsoft.graph.fileAttachment";
  name: string;
  contentBytes: string;
  contentType: string;
}

async function sendOne(input: {
  recipient: MentionRecipient;
  sender: Person;
  target: MentionTarget;
  commentExcerpt: string;
  attachments: GraphFileAttachment[];
}): Promise<void> {
  const { target } = input;
  const reason = input.recipient.reason;
  const subject =
    reason === "mentioned"
      ? `You were mentioned in ${target.title}`
      : reason === "edited"
        ? `Updated comment on ${target.title}`
        : `New comment on ${target.title}`;
  const url = itemUrl(target.kind, target.id);
  const bodyHtml = renderMentionEmail({
    recipientName: input.recipient.displayName,
    senderName: input.sender.displayName,
    kind: target.kind,
    reason,
    itemTitle: target.title,
    commentExcerpt: input.commentExcerpt,
    url,
  });

  const message: Record<string, unknown> = {
    subject,
    body: { contentType: "HTML", content: bodyHtml },
    toRecipients: [
      { emailAddress: { address: input.recipient.email, name: input.recipient.displayName } },
    ],
  };
  if (input.attachments.length > 0) {
    message.attachments = input.attachments;
  }

  // saveToSentItems: false is deliberate.
  //
  // saveToSentItems: true would have Graph write a copy of the message into
  // the shared mailbox's Sent Items folder — which requires the signed-in
  // user to hold FullAccess on the shared mailbox. We only require Send-As
  // (granted broadly to ~175 commenters). Forcing FullAccess on top would
  // mean every commenter can also read the shared mailbox's inbox, which
  // we don't want. Setting this to false lets Send-As alone send the mail.
  // The shared mailbox simply won't accumulate copies of every notification
  // — arguably better for an internal notification system anyway.
  await graphFetch(`/users/${encodeURIComponent(SHARED_MAILBOX!)}/sendMail`, {
    method: "POST",
    body: JSON.stringify({ message, saveToSentItems: false }),
  });
}

async function encodeAttachment(att: CommentAttachment): Promise<GraphFileAttachment> {
  if (!att.objectUrl) {
    throw new Error(`Attachment ${att.filename} has no objectUrl to encode`);
  }
  const blob = await fetch(att.objectUrl).then((r) => r.blob());
  const contentBytes = await blobToBase64(blob);
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: att.filename,
    contentBytes,
    contentType: att.contentType || "application/octet-stream",
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:<mime>;base64,<data>" — Graph wants just the data.
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Absolute URL to an item's detail page. Thin re-export of the shared
 * `appItemUrl` helper so this module's existing call sites keep working.
 */
function itemUrl(kind: MentionTarget["kind"], id: number): string {
  return appItemUrl(kind, id);
}

// =============================================================================
// Change alerts — status / EIR-resolution / assignee changes.
//
// Same delivery path as mentions (shared mailbox, mock-logs in demo). The
// recipient math + wording is built in src/lib/changeAlerts.ts; here we just
// render + send. The `fire*` wrappers are the convenience entry points the
// mutation hooks call in onSuccess (fire-and-forget).
// =============================================================================

/** Send a batch of pre-built change-alert emails for one item. Best-effort. */
export async function notifyChangeEmails(input: {
  target: ChangeTarget;
  emails: ChangeEmail[];
}): Promise<void> {
  const emails = input.emails.filter((e) => !!e.email);
  if (emails.length === 0) return;

  if (USE_MOCK) {
    // eslint-disable-next-line no-console
    console.info("[email mock] change alerts:", {
      from: SHARED_MAILBOX ?? "(no shared mailbox configured)",
      kind: input.target.kind,
      item: input.target.title,
      url: appItemUrl(input.target.kind, input.target.id),
      to: emails.map((e) => ({ email: e.email, subject: e.subject })),
    });
    return;
  }

  if (!SHARED_MAILBOX) {
    console.warn(
      "[email] VITE_SHARED_MAILBOX is not set — skipping change-alert emails. " +
        "Set it to a mailbox that the signed-in user has Send-As permission on.",
    );
    return;
  }

  const url = appItemUrl(input.target.kind, input.target.id);
  for (const e of emails) {
    try {
      const bodyHtml = renderChangeEmail({
        recipientName: e.displayName,
        headlineHtml: e.headlineHtml,
        detailHtml: e.detailHtml,
        kind: input.target.kind,
        itemTitle: input.target.title,
        url,
      });
      const message = {
        subject: e.subject,
        body: { contentType: "HTML", content: bodyHtml },
        toRecipients: [{ emailAddress: { address: e.email, name: e.displayName } }],
      };
      await graphFetch(`/users/${encodeURIComponent(SHARED_MAILBOX)}/sendMail`, {
        method: "POST",
        body: JSON.stringify({ message, saveToSentItems: false }),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[email] Failed to send change alert to ${e.email}:`, err);
    }
  }
}

/**
 * Fire-and-forget alert for a single-value field change (Status / Resolution).
 * No-ops silently when the value didn't change or nobody needs notifying.
 */
export function fireFieldChangeAlert(args: {
  target: ChangeTarget;
  fieldLabel: string;
  from: string;
  to: string;
  actor: Person;
  watchers: Person[];
  assignees: Person[];
  reporter?: Person | null;
}): void {
  const emails = buildFieldChangeEmails(args);
  if (emails.length === 0) return;
  void notifyChangeEmails({ target: args.target, emails });
}

/**
 * Fire-and-forget alert for Description-checklist toggles (box checked /
 * unchecked). No-ops silently when nothing flipped or nobody needs notifying.
 */
export function fireChecklistToggleAlert(args: {
  target: ChangeTarget;
  toggles: Array<{ text: string; checked: boolean }>;
  actor: Person;
  watchers: Person[];
  assignees: Person[];
  reporter?: Person | null;
}): void {
  const emails = buildChecklistToggleEmails(args);
  if (emails.length === 0) return;
  void notifyChangeEmails({ target: args.target, emails });
}

/** Fire-and-forget alert for an assignee change (added / removed / broadcast). */
export function fireAssigneeChangeAlert(args: {
  target: ChangeTarget;
  prev: Person[];
  next: Person[];
  actor: Person;
  watchers: Person[];
  reporter?: Person | null;
}): void {
  const emails = buildAssigneeChangeEmails(args);
  if (emails.length === 0) return;
  void notifyChangeEmails({ target: args.target, emails });
}

/**
 * Fire-and-forget alert when an EIR is promoted to a task. Goes to the EIR's
 * watchers + reporter (minus the actor); the email links to the NEW TASK, so
 * we send it with a task-kind target.
 */
export function firePromotionAlert(args: {
  eir: { id: number; eirNo: string; title: string; watchers: Person[]; reporter?: Person | null };
  task: { id: number; numberedTitle: string; title: string };
  actor: Person;
}): void {
  const emails = buildPromotionEmails({
    eirLabel: args.eir.eirNo || `EIR #${args.eir.id}`,
    watchers: args.eir.watchers,
    reporter: args.eir.reporter,
    actor: args.actor,
  });
  if (emails.length === 0) return;
  void notifyChangeEmails({
    target: {
      kind: "task",
      id: args.task.id,
      title: args.task.numberedTitle || args.task.title,
    },
    emails,
  });
}

interface MentionEmailContext {
  recipientName: string;
  senderName: string;
  kind: MentionTarget["kind"];
  reason: "mentioned" | "watching" | "edited";
  itemTitle: string;
  commentExcerpt: string;
  url: string;
}

/**
 * Shared branded email shell. Table-based layout with inline styles only, so
 * Outlook (which ignores most modern CSS) renders cleanly.
 *
 * The header bar uses Cooper Red (`#CB2C30`) with the ARC wordmark in white.
 * Red is deliberate: a near-black header gets remapped to a muddy grey by
 * Outlook's dark mode, whereas the saturated brand red survives intact in
 * both light and dark. The same red drives the call-to-action button. The
 * wordmark is styled text (not an image) so it renders identically everywhere
 * without blocked-image problems.
 *
 * `introHtml` and `messageHtml` are TRUSTED HTML — callers must escape any
 * dynamic content they interpolate. `recipientName`, `calloutTitle`, and
 * `url` are escaped here.
 */
function renderEmailShell(ctx: {
  recipientName: string;
  introHtml: string;
  calloutLabel: string;
  calloutTitle: string;
  messageHtml?: string;
  buttonText: string;
  url: string;
}): string {
  const recipient = escapeHtml(ctx.recipientName);
  const calloutTitle = escapeHtml(ctx.calloutTitle);
  const url = escapeHtml(ctx.url);
  const messageBlock = ctx.messageHtml
    ? `<div style="margin:0 0 22px 0;padding:14px 16px;background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;color:#374151;">
              ${ctx.messageHtml}
            </div>`
    : "";

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f3f4f6;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="background:#CB2C30;padding:22px 28px;">
            <div style="color:#ffffff;font-weight:800;font-size:20px;letter-spacing:0.18em;text-transform:uppercase;line-height:1.1;">ARC</div>
            <div style="color:#ffffff;font-size:12px;font-weight:600;letter-spacing:0.04em;margin-top:6px;">Altronic Resource Center — every team's tools in one place.</div>
            <div style="color:#fbdcdc;font-size:12px;font-style:italic;margin-top:5px;">Every team. One ARC. Always forward.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 28px 8px 28px;color:#111827;font-size:15px;line-height:1.55;">
            <p style="margin:0 0 14px 0;font-size:16px;">Hello <strong>${recipient}</strong>,</p>
            <p style="margin:0 0 18px 0;">${ctx.introHtml}</p>
            <div style="margin:0 0 18px 0;padding:14px 16px;background:#f9fafb;border-left:3px solid #CB2C30;border-radius:0 6px 6px 0;">
              <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">${escapeHtml(ctx.calloutLabel)}</div>
              <div style="font-weight:600;color:#111827;">${calloutTitle}</div>
            </div>
            ${messageBlock}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 28px 28px 28px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td align="center" style="background:#CB2C30;border-radius:6px;">
                  <a href="${url}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.01em;">${ctx.buttonText}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 28px;background:#fafafa;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;line-height:1.5;text-align:center;">
            Do not reply to this email &mdash; it was automatically sent via ARC (Altronic Resource Center).
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();
}

/** Build the @-mention / watching comment email body from the shared shell. */
function renderMentionEmail(ctx: MentionEmailContext): string {
  const sender = escapeHtml(ctx.senderName);
  const excerpt = escapeHtml(ctx.commentExcerpt).replace(/\n/g, "<br/>");
  const copy = KIND_COPY[ctx.kind];
  const intro =
    ctx.reason === "mentioned"
      ? `You were mentioned in ${copy.phrase} by <strong>${sender}</strong>.`
      : ctx.reason === "edited"
        ? `<strong>${sender}</strong> updated a comment on ${copy.phrase} you're following — here's the latest version:`
        : `<strong>${sender}</strong> commented on ${copy.phrase} you're watching.`;

  return renderEmailShell({
    recipientName: ctx.recipientName,
    introHtml: intro,
    calloutLabel: copy.calloutLabel,
    calloutTitle: ctx.itemTitle,
    messageHtml: excerpt || '<em style="color:#9ca3af;">(no message body)</em>',
    buttonText: copy.buttonText,
    url: ctx.url,
  });
}

/** Build a change-alert email body (status / resolution / assignee) via the shell. */
function renderChangeEmail(ctx: {
  recipientName: string;
  headlineHtml: string;
  detailHtml?: string;
  kind: MentionTarget["kind"];
  itemTitle: string;
  url: string;
}): string {
  const copy = KIND_COPY[ctx.kind];
  return renderEmailShell({
    recipientName: ctx.recipientName,
    introHtml: ctx.headlineHtml,
    calloutLabel: copy.calloutLabel,
    calloutTitle: ctx.itemTitle,
    messageHtml: ctx.detailHtml,
    buttonText: copy.buttonText,
    url: ctx.url,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
