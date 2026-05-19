import { graphFetch } from "./graph";
import { SHARED_MAILBOX, USE_MOCK } from "./config";
import type { CommentAttachment, Person, Task } from "@/types/task";

// =============================================================================
// Email notifications via Microsoft Graph sendMail.
//
// All notifications go through one entry point: notifyMentions(). It takes
// the comment that was just posted, the recipients (extracted from the
// mention chips in the body), the sender + task context, and any attachments
// from the comment. Mail goes out FROM the shared mailbox configured via
// VITE_SHARED_MAILBOX (requires Send-As permission for the signed-in user
// in Exchange).
//
// Mock mode logs to console instead of sending — useful for demos. Real
// mode without VITE_SHARED_MAILBOX set also falls back to console (loud
// warning so the misconfiguration is obvious).
// =============================================================================

export interface MentionRecipient {
  email: string;
  displayName: string;
}

export interface NotifyMentionsInput {
  recipients: MentionRecipient[];
  sender: Person;
  task: Task;
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
      task: input.task.numberedTitle || input.task.title,
      url: taskUrl(input.task.id),
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
        task: input.task,
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
  task: Task;
  commentExcerpt: string;
  attachments: GraphFileAttachment[];
}): Promise<void> {
  const taskTitle = input.task.numberedTitle || input.task.title;
  const subject = `You were mentioned in ${taskTitle}`;
  const url = taskUrl(input.task.id);
  const excerptHtml = escapeHtml(input.commentExcerpt).replace(/\n/g, "<br/>");

  const bodyHtml = `
    <p>Hello ${escapeHtml(input.recipient.displayName)},</p>
    <p>You were mentioned in a comment by <strong>${escapeHtml(
      input.sender.displayName,
    )}</strong> on <strong>${escapeHtml(taskTitle)}</strong>:</p>
    <blockquote style="border-left:3px solid #ccc;padding:0.25rem 0.75rem;margin:0.5rem 0;color:#555;">
      ${excerptHtml || "<em>(no message body)</em>"}
    </blockquote>
    <p><a href="${escapeHtml(url)}">Open this task →</a></p>
    <hr/>
    <p style="font-size:11px;color:#888;">Altronic Engineering Task System</p>
  `;

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

  await graphFetch(`/users/${encodeURIComponent(SHARED_MAILBOX!)}/sendMail`, {
    method: "POST",
    body: JSON.stringify({ message, saveToSentItems: true }),
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

function taskUrl(taskId: number): string {
  // Match what the app's router uses. window.location is available in
  // the browser; if for some reason it isn't, fall back to a relative URL.
  if (typeof window === "undefined") return `/task/${taskId}`;
  return `${window.location.origin}${window.location.pathname.replace(
    /\/(list|task|kanban|test-sheets?|admin|about)?.*$/,
    "",
  )}/task/${taskId}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
