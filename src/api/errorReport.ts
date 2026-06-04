import { graphFetch } from "./graph";
import { APP_MANAGER_EMAIL, SHARED_MAILBOX, USE_MOCK } from "./config";
import type { CapturedError } from "@/lib/errorBuffer";
import type { Person } from "@/types/task";

// =============================================================================
// "Notify app manager" report email. Sent FROM the shared mailbox (same
// pattern as @-mention notifications), TO the configured app-manager
// address, with the reporting user CC'd so they have a paper trail of what
// they actually sent.
//
// Mock mode logs to console and resolves. Real mode without
// VITE_SHARED_MAILBOX falls back to console.warn so the misconfiguration
// is loud — but the button doesn't throw, since the reporter probably
// doesn't care why the email won't go out, only that something is broken.
// =============================================================================

export interface SendErrorReportInput {
  description: string;
  reporter: Person | null;
  captured: CapturedError[];
  /** Where the user was when they hit the button (for context). */
  pageUrl: string;
  /** User agent string — useful for "only happens on Edge" reports. */
  userAgent: string;
}

export async function sendErrorReport(input: SendErrorReportInput): Promise<void> {
  const subject = `[ARC] Issue report${input.reporter ? ` from ${input.reporter.displayName}` : ""}`;
  const html = renderReportEmail(input);

  if (USE_MOCK) {
    // eslint-disable-next-line no-console
    console.info("[email mock] error report:", {
      to: APP_MANAGER_EMAIL,
      cc: input.reporter?.email ?? "(no reporter email)",
      capturedCount: input.captured.length,
      description: input.description,
    });
    return;
  }

  if (!SHARED_MAILBOX) {
    console.warn(
      "[errorReport] VITE_SHARED_MAILBOX is not set — cannot send report email. " +
        "Falling back to console dump for the maintainer to copy out.",
    );
    // eslint-disable-next-line no-console
    console.info("[errorReport] would have sent:", { html });
    return;
  }

  const toRecipients = [
    { emailAddress: { address: APP_MANAGER_EMAIL, name: "App Manager" } },
  ];
  const ccRecipients = input.reporter?.email
    ? [
        {
          emailAddress: {
            address: input.reporter.email,
            name: input.reporter.displayName,
          },
        },
      ]
    : [];

  const message: Record<string, unknown> = {
    subject,
    body: { contentType: "HTML", content: html },
    toRecipients,
    ccRecipients,
  };

  // saveToSentItems: false — same reasoning as src/api/email.ts: the
  // Sent-Items write requires FullAccess on the shared mailbox, which we
  // don't grant to all reporters. Send-As alone is enough to deliver mail
  // when this flag is false.
  await graphFetch(`/users/${encodeURIComponent(SHARED_MAILBOX)}/sendMail`, {
    method: "POST",
    body: JSON.stringify({ message, saveToSentItems: false }),
  });
}

function renderReportEmail(ctx: SendErrorReportInput): string {
  const reporterLine = ctx.reporter
    ? `<strong>${escapeHtml(ctx.reporter.displayName)}</strong>${
        ctx.reporter.email ? ` &lt;${escapeHtml(ctx.reporter.email)}&gt;` : ""
      }`
    : "<em>(unknown reporter)</em>";
  const description = ctx.description.trim()
    ? `<div style="white-space:pre-wrap;color:#374151;">${escapeHtml(ctx.description)}</div>`
    : "<em style=\"color:#9ca3af;\">(no description provided)</em>";

  const errorRows =
    ctx.captured.length === 0
      ? "<tr><td style=\"padding:12px 14px;color:#9ca3af;font-style:italic;\">No console errors were captured during this session.</td></tr>"
      : ctx.captured
          .map((e) => {
            const time = e.at.toISOString();
            const level = e.level.toUpperCase();
            const levelColor =
              e.level === "warn" ? "#b45309" :
              e.level === "uncaught" || e.level === "rejection" ? "#b91c1c" :
              "#374151";
            const stack = e.stack
              ? `<pre style="margin:6px 0 0 0;padding:8px;background:#0f172a;color:#e5e7eb;font-size:11px;border-radius:4px;overflow:auto;white-space:pre-wrap;">${escapeHtml(e.stack)}</pre>`
              : "";
            const source = e.source ? `<div style="color:#6b7280;font-size:11px;">${escapeHtml(e.source)}</div>` : "";
            return `<tr>
              <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:12px;line-height:1.45;">
                <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#6b7280;">
                  <span style="font-weight:700;color:${levelColor};">${level}</span>
                  <span>${escapeHtml(time)}</span>
                </div>
                <div style="color:#111827;margin-top:4px;white-space:pre-wrap;">${escapeHtml(e.message)}</div>
                ${source}${stack}
              </td>
            </tr>`;
          })
          .join("");

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f3f4f6;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:680px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <tr>
        <td style="background:#CB2C30;padding:22px 28px;">
          <div style="color:#ffffff;font-weight:800;font-size:18px;letter-spacing:0.18em;text-transform:uppercase;line-height:1.1;">Issue Report</div>
          <div style="color:#ffffff;margin-top:6px;font-size:12px;font-weight:600;">ARC — Altronic Resource Center</div>
          <div style="color:#fbdcdc;margin-top:4px;font-size:11px;font-style:italic;">Every team. One ARC. Always forward.</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px 8px 28px;color:#111827;font-size:14px;line-height:1.55;">
          <div style="margin-bottom:14px;"><span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">Reporter</span><br/>${reporterLine}</div>
          <div style="margin-bottom:14px;"><span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">Page</span><br/><a href="${escapeHtml(ctx.pageUrl)}" style="color:#CB2C30;text-decoration:none;">${escapeHtml(ctx.pageUrl)}</a></div>
          <div style="margin-bottom:14px;"><span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">Browser</span><br/><span style="color:#6b7280;font-size:12px;">${escapeHtml(ctx.userAgent)}</span></div>
          <div style="margin-bottom:6px;"><span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">Description</span></div>
          <div style="padding:14px 16px;background:#f9fafb;border-left:3px solid #CB2C30;border-radius:0 6px 6px 0;margin-bottom:20px;">${description}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 24px 28px;">
          <div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:8px;">Captured console output (${ctx.captured.length})</div>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;">
            ${errorRows}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 28px;background:#fafafa;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;line-height:1.5;text-align:center;">
          Sent via the "Notify app manager" button. Reporter is CC'd on this message.
        </td>
      </tr>
    </table>
  </td></tr>
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
