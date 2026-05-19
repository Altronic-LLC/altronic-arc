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
  const bodyHtml = renderMentionEmail({
    recipientName: input.recipient.displayName,
    senderName: input.sender.displayName,
    taskTitle,
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

interface MentionEmailContext {
  recipientName: string;
  senderName: string;
  taskTitle: string;
  commentExcerpt: string;
  url: string;
}

/**
 * Build the full HTML email body. Table-based layout so Outlook (which
 * ignores most modern CSS) still renders cleanly. Inline styles only.
 * Cooper Red `#CB2C30` is the brand accent. The wordmark is rendered as
 * styled text rather than an image so email clients without remote-image
 * loading still see the branding.
 */
function renderMentionEmail(ctx: MentionEmailContext): string {
  const recipient = escapeHtml(ctx.recipientName);
  const sender = escapeHtml(ctx.senderName);
  const taskTitle = escapeHtml(ctx.taskTitle);
  const excerpt = escapeHtml(ctx.commentExcerpt).replace(/\n/g, "<br/>");
  const url = escapeHtml(ctx.url);

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="background:#CB2C30;padding:20px 28px;">
            <div style="color:#ffffff;font-weight:800;font-size:18px;letter-spacing:0.18em;text-transform:uppercase;line-height:1;">ALTRONIC</div>
            <div style="color:rgba(255,255,255,0.85);font-weight:600;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;margin-top:6px;">Engineering Task System</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 28px 8px 28px;color:#1f2937;font-size:15px;line-height:1.55;">
            <p style="margin:0 0 14px 0;font-size:16px;">Hello <strong>${recipient}</strong>,</p>
            <p style="margin:0 0 18px 0;">You were mentioned in a task by <strong>${sender}</strong>.</p>
            <div style="margin:0 0 18px 0;padding:14px 16px;background:#fafafa;border-left:3px solid #CB2C30;border-radius:0 6px 6px 0;">
              <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Task</div>
              <div style="font-weight:600;color:#111827;">${taskTitle}</div>
            </div>
            <div style="margin:0 0 22px 0;padding:14px 16px;background:#fafafa;border:1px solid #e5e7eb;border-radius:6px;color:#374151;">
              ${excerpt || "<em style=\"color:#9ca3af;\">(no message body)</em>"}
            </div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 28px 28px 28px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td align="center" style="background:#CB2C30;border-radius:6px;">
                  <a href="${url}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.01em;">Open this task</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;line-height:1.5;text-align:center;">
            Do not reply to this email &mdash; it was automatically sent via the Engineering Task System.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
