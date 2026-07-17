import { graphFetch, GraphError } from "./graph";
import { SHARED_MAILBOX, USE_MOCK } from "./config";
import { getMsalInstance } from "@/auth/AuthProvider";

// =============================================================================
// Edit-failure recovery email.
//
// The transport layer (fetchWithRetry in graph.ts) already waits out
// throttling + network blips, so a write only lands here when it TRULY can't
// be saved — permission denied, validation rejected, or a prolonged outage
// that exhausted every retry. When that happens the optimistic UI rolls the
// edit back, which means the user's work would otherwise just vanish.
//
// To make sure the work is never lost, this emails the user who made the
// change a copy of exactly what they entered plus the reason it failed, so
// they can re-enter it. Fired from the GLOBAL MutationCache.onError in
// main.tsx, so every write — every department, every future feature — is
// covered by this one hook with no per-mutation wiring.
//
// Best-effort: the send itself goes through Graph, so a total tenant outage
// could also block the email. That's the inherent floor; the common real
// failures (403 permission, 400 validation) have working mail. The send is
// wrapped so it can never throw back into the mutation cache.
// =============================================================================

export interface EditFailureActor {
  displayName: string;
  email: string;
}

/** A single attempted-change row for the report table. */
export interface AttemptedChangeRow {
  label: string;
  value: string;
}

export interface AttemptedChange {
  /** Short noun for the subject/intro, e.g. "comment", "update", "new item". */
  summary: string;
  /** The item's SharePoint id, when the variables carried one (updates/comments). */
  itemId: number | null;
  /** Field-by-field record of what the user entered. */
  rows: AttemptedChangeRow[];
}

export interface EditFailureReason {
  /** One-line plain-language cause shown prominently. */
  headline: string;
  /** Raw technical detail (status + body) for the maintainer, may be empty. */
  detail: string;
}

/** True for the re-auth signal — NOT a lost edit, and the token's dead anyway. */
function isSessionExpired(error: unknown): boolean {
  return error instanceof Error && error.name === "SessionExpiredError";
}

/** Resolve the signed-in user from MSAL — no React context needed here. */
export function resolveEditFailureActor(): EditFailureActor | null {
  if (USE_MOCK) {
    return { displayName: "Demo User", email: "demo.user@altronic-llc.com" };
  }
  const account = getMsalInstance()?.getActiveAccount();
  if (!account?.username) return null;
  return { displayName: account.name ?? account.username, email: account.username };
}

// ---- turning raw mutation variables into a readable change record ----------

const HTMLISH_KEYS = new Set([
  "bodyHtml",
  "newBodyHtml",
  "Description",
  "TaskDescription",
  "OrderNotes",
  "Communication",
  "EngineeringResponse",
]);

/** Strip tags/entities from stored HTML so the report shows plain text. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** SharePoint internal name → friendly label ("TaskDescription" → "Task Description"). */
export function prettifyFieldName(raw: string): string {
  const decoded = raw
    .replace(/_x0020_/g, " ")
    .replace(/_x002f_/g, "/")
    .replace(/LookupId$/, "");
  const spaced = decoded.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  return spaced || raw;
}

/** Render one variable value as readable text. */
function stringifyValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "(cleared)";
  if (typeof value === "string") return HTMLISH_KEYS.has(key) ? htmlToText(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return (
      value
        .map((v) => {
          if (v && typeof v === "object") {
            const o = v as Record<string, unknown>;
            return String(o.displayName ?? o.title ?? o.LookupValue ?? o.email ?? JSON.stringify(o));
          }
          return String(v);
        })
        .join(", ") || "(none)"
    );
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const friendly = o.displayName ?? o.title ?? o.LookupValue ?? o.email;
    if (friendly !== undefined) return String(friendly);
    try {
      return JSON.stringify(value);
    } catch {
      return "(unreadable value)";
    }
  }
  return String(value);
}

/**
 * Turn a mutation's `variables` into a human-readable record of what the user
 * was trying to save. Handles the shapes used across the app — `{id, fields}`
 * updates, `{id, comment}` / `{newBodyHtml}` comments, `{id, people|person|
 * status|...}` single-field setters, and create-input objects — and falls
 * back to a generic key/value dump for anything unrecognised.
 */
export function describeAttemptedChange(variables: unknown): AttemptedChange {
  const rows: AttemptedChangeRow[] = [];
  let itemId: number | null = null;
  let summary = "change";

  if (variables && typeof variables === "object") {
    const v = variables as Record<string, unknown>;
    if (typeof v.id === "number") itemId = v.id;

    // Comment (new or edited).
    const comment = v.comment as Record<string, unknown> | undefined;
    if (comment && typeof comment.bodyHtml === "string") {
      summary = "comment";
      rows.push({ label: "Comment", value: htmlToText(comment.bodyHtml) });
    }
    if (typeof v.newBodyHtml === "string") {
      summary = "comment";
      rows.push({ label: "Comment", value: htmlToText(v.newBodyHtml) });
    }

    // Field-update bag: expand each field into its own row.
    const fields = v.fields as Record<string, unknown> | undefined;
    if (fields && typeof fields === "object") {
      summary = "update";
      for (const [key, value] of Object.entries(fields)) {
        if (key.endsWith("@odata.type")) continue; // Graph annotation, not user data
        rows.push({ label: prettifyFieldName(key), value: stringifyValue(key, value) });
      }
    }

    // Other top-level keys (single-field setters + create inputs). Skip the
    // structural/metadata keys already handled or not worth showing.
    const SKIP = new Set(["id", "fields", "comment", "newBodyHtml", "target", "renotify"]);
    for (const [key, value] of Object.entries(v)) {
      if (SKIP.has(key) || key.endsWith("@odata.type")) continue;
      if (key === "input" && value && typeof value === "object") {
        // e.g. updatePanelProject({ id, input: {...} }) — expand the input.
        summary = "update";
        for (const [k, val] of Object.entries(value as Record<string, unknown>)) {
          rows.push({ label: prettifyFieldName(k), value: stringifyValue(k, val) });
        }
        continue;
      }
      if (itemId === null) summary = "new item";
      rows.push({ label: prettifyFieldName(key), value: stringifyValue(key, value) });
    }
  }

  return { summary, itemId, rows };
}

// ---- turning the raw error into a plain-language reason --------------------

export function describeFailureReason(error: unknown): EditFailureReason {
  if (error instanceof GraphError) {
    const detail = `${error.status} ${error.statusText}${error.body ? ` — ${error.body}` : ""}`;
    switch (error.status) {
      case 403:
        return {
          headline: "You don't have permission to save this to SharePoint.",
          detail,
        };
      case 400:
        return {
          headline: "SharePoint rejected the change — a value may be invalid or out of range.",
          detail,
        };
      case 404:
        return {
          headline: "SharePoint couldn't find the item — it may have been deleted, or a required list isn't configured.",
          detail,
        };
      case 429:
      case 502:
      case 503:
      case 504:
        return {
          headline: "SharePoint was busy and stayed unavailable after several automatic retries.",
          detail,
        };
      default:
        return { headline: `SharePoint returned an error (${error.status}).`, detail };
    }
  }
  if (error instanceof Error) {
    // A network-level failure (fetch TypeError) reaches here after retries.
    if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
      return {
        headline: "Your device couldn't reach SharePoint (network connection lost).",
        detail: error.message,
      };
    }
    return { headline: error.message || "The change couldn't be saved.", detail: "" };
  }
  return { headline: "The change couldn't be saved.", detail: String(error ?? "") };
}

// ---- the public entry point -------------------------------------------------

/**
 * Fire-and-forget: email the signed-in user a recovery copy of a write that
 * failed. Safe to call from anywhere; never throws. No-ops for session-expiry
 * (that's a re-auth, handled separately) and when there's no signed-in user.
 */
export async function reportEditFailure(input: {
  error: unknown;
  variables: unknown;
  /** Best-effort page URL for context; defaults to the current location. */
  pageUrl?: string;
}): Promise<void> {
  try {
    if (isSessionExpired(input.error)) return;

    const actor = resolveEditFailureActor();
    if (!actor?.email) return;

    const change = describeAttemptedChange(input.variables);
    const reason = describeFailureReason(input.error);
    const pageUrl =
      input.pageUrl ?? (typeof window !== "undefined" ? window.location.href : "");
    const subject = "ARC couldn't save your change — here's what you entered";

    if (USE_MOCK) {
      // eslint-disable-next-line no-console
      console.info("[email mock] edit-failure report:", {
        to: actor.email,
        reason: reason.headline,
        summary: change.summary,
        rows: change.rows,
      });
      return;
    }

    if (!SHARED_MAILBOX) {
      console.warn(
        "[editFailureReport] VITE_SHARED_MAILBOX is not set — can't email the failed edit. " +
          "Dumping it to the console so it isn't lost:",
      );
      // eslint-disable-next-line no-console
      console.info("[editFailureReport] lost edit:", { reason, change });
      return;
    }

    const html = renderEditFailureEmail({ actor, reason, change, pageUrl });
    const message = {
      subject,
      body: { contentType: "HTML", content: html },
      toRecipients: [{ emailAddress: { address: actor.email, name: actor.displayName } }],
    };
    await graphFetch(`/users/${encodeURIComponent(SHARED_MAILBOX)}/sendMail`, {
      method: "POST",
      body: JSON.stringify({ message, saveToSentItems: false }),
    });
  } catch (err) {
    // Never let the recovery path itself throw back into the mutation cache.
    // eslint-disable-next-line no-console
    console.error("[editFailureReport] couldn't send the failure email:", err);
  }
}

function renderEditFailureEmail(ctx: {
  actor: EditFailureActor;
  reason: EditFailureReason;
  change: AttemptedChange;
  pageUrl: string;
}): string {
  const itemLine =
    ctx.change.itemId != null
      ? `<div style="color:#6b7280;font-size:12px;margin-bottom:12px;">Item #${ctx.change.itemId}</div>`
      : "";

  const rows =
    ctx.change.rows.length === 0
      ? `<tr><td style="padding:12px 14px;color:#9ca3af;font-style:italic;">(The specific values couldn't be captured — re-open ARC to re-enter your change.)</td></tr>`
      : ctx.change.rows
          .map(
            (r) => `<tr>
              <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;vertical-align:top;width:34%;color:#6b7280;font-size:12px;font-weight:700;">${escapeHtml(r.label)}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:13px;white-space:pre-wrap;">${escapeHtml(r.value)}</td>
            </tr>`,
          )
          .join("");

  const detailBlock = ctx.reason.detail
    ? `<pre style="margin:8px 0 0 0;padding:10px;background:#0f172a;color:#e5e7eb;font-size:11px;border-radius:4px;overflow:auto;white-space:pre-wrap;">${escapeHtml(ctx.reason.detail.slice(0, 1500))}</pre>`
    : "";

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f3f4f6;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:680px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <tr>
        <td style="background:#CB2C30;padding:22px 28px;">
          <div style="color:#ffffff;font-weight:800;font-size:18px;letter-spacing:0.18em;text-transform:uppercase;line-height:1.1;">Save Failed</div>
          <div style="color:#ffffff;margin-top:6px;font-size:12px;font-weight:600;">ARC — Altronic Resource Center</div>
          <div style="color:#fbdcdc;margin-top:4px;font-size:11px;font-style:italic;">Every team. One ARC. Always forward.</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px 8px 28px;color:#111827;font-size:14px;line-height:1.55;">
          <p style="margin:0 0 14px 0;">Hi ${escapeHtml(ctx.actor.displayName)},</p>
          <p style="margin:0 0 18px 0;">A change you just made in ARC <strong>didn't save to SharePoint</strong>, so we've undone it in the app to keep it honest. Here's exactly what you entered — copy anything you need and re-enter it in ARC.</p>
          <div style="margin-bottom:6px;"><span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">Why it failed</span></div>
          <div style="padding:14px 16px;background:#fef2f2;border-left:3px solid #CB2C30;border-radius:0 6px 6px 0;margin-bottom:20px;color:#7f1d1d;">
            ${escapeHtml(ctx.reason.headline)}
            ${detailBlock}
          </div>
          <div style="margin-bottom:8px;"><span style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">What you were saving</span></div>
          ${itemLine}
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 20px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;">
            ${rows}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 24px 28px;color:#374151;font-size:13px;line-height:1.55;">
          <p style="margin:0 0 6px 0;"><strong>What to do:</strong> open ARC and re-enter the change above. If it keeps failing, use the <strong>Report Issue</strong> button (life-buoy icon) in the header so the app manager can look into it.</p>
          ${ctx.pageUrl ? `<p style="margin:8px 0 0 0;font-size:12px;"><a href="${escapeHtml(ctx.pageUrl)}" style="color:#CB2C30;text-decoration:none;">Return to where you were &rarr;</a></p>` : ""}
        </td>
      </tr>
      <tr>
        <td style="padding:14px 28px;background:#fafafa;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;line-height:1.5;text-align:center;">
          ARC sends this automatically whenever a save can't reach SharePoint, so your work is never silently lost.
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
