import { mailTipsScopes } from "@/auth/msalConfig";
import { awayRecipients, type GraphMailTips, type OutOfOffice } from "@/lib/outOfOffice";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import { USE_MOCK } from "./config";
import { resolveMyIdentity } from "./currentUser";
import { graphFetchScoped } from "./graph";

// =============================================================================
// Who is out of office — Graph getMailTips (Altronic-LLC/BusinessIT#4).
//
// POST /me/getMailTips with "automaticReplies" returns each address's automatic
// reply; Exchange answers it the way Outlook warns before Send. The scope is
// MailTips.ReadBasic.Shared — it reads mail TIPS, never mail. Mail.Read is the
// docs' "least privileged" choice and would let ARC read the signer's inbox.
//
// Asked when somebody becomes relevant (mentioned, or watching a page whose
// comment box is being written in), never as a company-wide sweep: replies
// change during the day, and a stored copy of everyone's reply would outlive
// the signed-in person on a shared PC. Each answer is kept IN MEMORY for
// CACHE_MS, so re-mentioning or a second comment doesn't ask again, and
// nothing is left behind when the tab closes.
//
// The scope is asked for SILENTLY, like the directory's: a person or tenant
// that hasn't consented gets no note, never a prompt. Every failure returns []
// and pauses asking for CACHE_MS, so an unconsented scope isn't retried on
// every keystroke's mention.
// =============================================================================

/** Addresses per request. Graph documents no limit; this keeps a request small. */
export const MAIL_TIPS_BATCH = 50;

/** How long an answer (or a failure) is trusted. */
export const MAIL_TIPS_CACHE_MS = 15 * 60 * 1000;

/**
 * A synthetic demo person who is always away, so the note can be seen in mock
 * mode. Not a real colleague (rule 8) — Marcus Webb is a mock directory name.
 */
const MOCK_AWAY: Record<string, string> = {
  "marcus.webb@altronic-llc.com":
    "I'm out of the office this week with limited access to email. For anything urgent please contact the Engineering team.",
};

export interface Recipient {
  email?: string;
  displayName: string;
}

/** Address (lower-cased) → who is away, or null for "not away", and when asked. */
const cache = new Map<string, { away: OutOfOffice | null; at: number }>();
let failedAt: number | null = null;

/** Tests only — forget every cached answer and failure. */
export function __resetMailTipsCache(): void {
  cache.clear();
  failedAt = null;
}

/**
 * The people in `recipients` who are out of office now — never the signed-in
 * person, who is writing the comment. Never throws.
 */
export async function findOutOfOffice(
  recipients: Recipient[],
  now: Date = new Date(),
): Promise<OutOfOffice[]> {
  // Every address the signer answers to (a UPN is not a mailbox), read once
  // per session; an empty identity on failure just means nobody is skipped.
  const mine = (await resolveMyIdentity()).all;
  const names = new Map<string, string>();
  for (const r of recipients) {
    const email = r.email?.trim().toLowerCase();
    if (email && !names.has(email) && !matchesAnyEmail(mine, email)) names.set(email, r.displayName);
  }
  const emails = [...names.keys()];
  if (emails.length === 0) return [];

  const fresh = (at: number) => now.getTime() - at < MAIL_TIPS_CACHE_MS;
  const toAsk = emails.filter((e) => {
    const hit = cache.get(e);
    return !hit || !fresh(hit.at);
  });

  if (toAsk.length > 0 && !(failedAt !== null && fresh(failedAt))) {
    const tips = await askExchange(toAsk);
    if (tips) {
      failedAt = null;
      const away = new Map(awayRecipients(tips, names, now).map((p) => [p.email.toLowerCase(), p]));
      // Everyone asked gets an answer, so "not away" is cached too.
      for (const e of toAsk) cache.set(e, { away: away.get(e) ?? null, at: now.getTime() });
    } else {
      failedAt = now.getTime();
    }
  }

  const result: OutOfOffice[] = [];
  for (const e of emails) {
    const hit = cache.get(e);
    if (!hit?.away || !fresh(hit.at)) continue;
    // A reply whose schedule ended since it was cached no longer counts.
    if (hit.away.until && hit.away.until <= now) continue;
    result.push({ ...hit.away, displayName: names.get(e) || hit.away.displayName });
  }
  return result;
}

/** Exchange's answer for these addresses, or null when it couldn't be asked. */
async function askExchange(emails: string[]): Promise<GraphMailTips[] | null> {
  if (USE_MOCK) {
    return emails.map((address) => ({
      emailAddress: { address },
      automaticReplies: { message: MOCK_AWAY[address] ?? "" },
    }));
  }
  try {
    const tips: GraphMailTips[] = [];
    for (let i = 0; i < emails.length; i += MAIL_TIPS_BATCH) {
      const res = await graphFetchScoped<{ value?: GraphMailTips[] }>("/me/getMailTips", mailTipsScopes, {
        method: "POST",
        // Scheduled times in UTC, so "has it started" compares like with like.
        headers: { Prefer: 'outlook.timezone="UTC"' },
        body: JSON.stringify({
          EmailAddresses: emails.slice(i, i + MAIL_TIPS_BATCH),
          MailTipsOptions: "automaticReplies",
        }),
      });
      tips.push(...(res.value ?? []));
    }
    return tips;
  } catch (err) {
    // Expected until MailTips.ReadBasic.Shared is on the app registration and
    // consented. A warn, not an error: nothing the person did failed.
    console.warn(
      "[mailTips] Couldn't check who is out of office — no note shown. " +
        "Needs MailTips.ReadBasic.Shared on ARC's app registration.",
      err,
    );
    return null;
  }
}
