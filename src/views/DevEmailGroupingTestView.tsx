import { useState } from "react";
import { SHARED_MAILBOX, USE_MOCK } from "@/api/config";
import { graphFetch } from "@/api/graph";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  notifyChangeEmails,
  notifyMentions,
  type MailSendResult,
  type MentionRecipient,
} from "@/api/email";
import {
  buildAssigneeChangeEmails,
  buildChecklistToggleEmails,
  buildFieldChangeEmails,
  type ChangeEmail,
  type ChangeTarget,
} from "@/lib/changeAlerts";
import type { Person } from "@/types/task";
import {
  CONVERSATION_INDEX_PROP,
  THREAD_INDEX_DATE,
  buildConversationIndex,
  previewLineHtml,
  threadGuid,
  toBase64,
} from "@/lib/emailThread";

/**
 * Dev-only page (never rendered in production — see the `import.meta.env.DEV`
 * guard around its route in App.tsx) for BusinessIT#7: do ARC's automated
 * emails about one item group into one Outlook conversation? Sends a handful
 * of test messages from the shared mailbox to the signed-in user through the
 * SAME `sendMail` path ARC uses, so it needs no permission ARC doesn't
 * already have. Reached at /dev/email-grouping-test while running
 * `npm run dev` with VITE_USE_MOCK=false.
 *
 * ARC holds Mail.Send.Shared but NOT Mail.Read, so this page can't read the
 * messages' conversationId back — the result is judged in Outlook itself,
 * which is the behaviour that matters anyway.
 */

/**
 * ROUND 1 (2026-10-12) — NOTHING grouped, in Outlook desktop with conversation
 * view on: not three messages with an identical subject, and not two with a
 * shared PidTagConversationIndex (0x0071) alone. So Exchange does NOT group
 * sendMail messages by subject; each one starts its own conversation.
 *
 * ROUND 2 — NOTHING grouped either. D (index + tracking flag), E (In-Reply-To
 * / References to a made-up root) and F (F1 carrying that root id). F2's
 * headers proved In-Reply-To and References DO reach the recipient — but its
 * Thread-Index was a FRESH 22-byte root, so Exchange started a new
 * conversation at send time regardless.
 *
 * The theory: Exchange assigns the conversation in the SENDING mailbox, by
 * finding the parent there. ARC sends with saveToSentItems: false, so the
 * shared mailbox never holds a parent, and every message is a new thread.
 *
 * ROUND 3 tested that, with every message SAVED to the shared mailbox's Sent
 * Items (G: same subject x3; H: H1 the root, H2/H3 replying). NOTHING grouped,
 * in the Inbox itself. So the theory was wrong — saving to Sent Items doesn't
 * help, and ARC can keep saveToSentItems: false.
 *
 * WHAT ROUND 2's HEADERS DID SHOW: D2's Thread-Index was D1's plus EXACTLY the
 * child block this page built (…ArAAAAQAQ). Exchange KEEPS a conversation
 * index set through singleValueExtendedProperties. D1 and D2 still didn't
 * group — and their Thread-Topic differed, because Exchange copies the topic
 * from the subject. A real Outlook reply matches on BOTH (same index root,
 * same topic: "RE: X" has topic "X").
 *
 * ROUND 4 — a shared index, each group its own GUID, sent the normal way:
 *   I — index + tracking + the same PidTagConversationTopic, DIFFERENT
 *       subjects: did NOT group. Exchange takes the topic from the subject.
 *   J — index + tracking + the same subject: GROUPED.
 *   K — index + the same subject, NO tracking flag: GROUPED.
 * So it takes BOTH a shared index root AND an identical subject; the tracking
 * flag isn't needed.
 *
 * ROUND 5 — exactly the shape production would send. ARC can't know which
 * email a recipient saw first, so EVERY email carries the IDENTICAL 22-byte
 * index (no child block), built only from the item: a fixed timestamp and a
 * GUID hashed from the item's key. No tracking flag.
 *   L — one item, three emails, same subject
 *   M — a second item, two emails — must group with each other, NOT with L
 * Result: L grouped as one conversation, M as another. That shape is what
 * production now sends (lib/emailThread.ts), and this page builds it from the
 * same code, so re-run it here before changing anything there.
 */

export interface ExtendedProperty {
  id: string;
  value: string;
}

export interface GroupingTestMessage {
  /** Which group the message belongs to (L / M) and its order in it. */
  label: string;
  subject: string;
  /** MAPI properties sent as `singleValueExtendedProperties`. */
  props: ExtendedProperty[];
  /** Graph's own `internetMessageId`, or null to let Exchange assign one. */
  internetMessageId: string | null;
  /** Keep a copy in the shared mailbox's Sent Items (ARC sends false today). */
  saveToSentItems: boolean;
}

export interface GroupingTestGroup {
  key: "L" | "M";
  title: string;
  expect: string;
}

export const GROUPING_TEST_GROUPS: GroupingTestGroup[] = [
  {
    key: "L",
    title: "One item, three emails — identical ID and subject on every one",
    expect: "Should show as ONE conversation of 3. This is exactly what production would send.",
  },
  {
    key: "M",
    title: "A second item, two emails",
    expect: "Should be its own conversation of 2 — NOT merged into L.",
  },
];

/** The item keys for one run — the run tag keeps them apart from earlier runs. */
export function groupingTestItemKeys(tag: string): { L: string; M: string } {
  return { L: `arc-grouping-test:${tag}:L`, M: `arc-grouping-test:${tag}:M` };
}

/**
 * The test messages for one run, tagged so each run's subjects are unique.
 * `guids` are each item's `threadGuid`; every email about an item carries the
 * IDENTICAL index built from it — the same code production sends with
 * (lib/emailThread.ts).
 */
export function buildGroupingTestMessages(
  tag: string,
  guids: { L: Uint8Array; M: Uint8Array },
): GroupingTestMessage[] {
  const marker = `[ARC grouping test ${tag}]`;
  const index = (guid: Uint8Array): ExtendedProperty[] => [
    {
      id: CONVERSATION_INDEX_PROP,
      value: toBase64(buildConversationIndex(THREAD_INDEX_DATE, guid)),
    },
  ];
  const msg = (label: string, subject: string, props: ExtendedProperty[]): GroupingTestMessage => ({
    label,
    subject,
    props,
    internetMessageId: null,
    saveToSentItems: false,
  });
  const subjectL = `EIR_TEST-L - Pump seal supplier change ${marker}`;
  const subjectM = `EIR_TEST-M - Coil potting cure time ${marker}`;
  return [
    msg("L1", subjectL, index(guids.L)),
    msg("M1", subjectM, index(guids.M)),
    msg("L2", subjectL, index(guids.L)),
    msg("M2", subjectM, index(guids.M)),
    msg("L3", subjectL, index(guids.L)),
  ];
}

/** The Graph `message` for one test email. */
export function buildGroupingTestPayload(
  msg: GroupingTestMessage,
  to: { address: string; name: string },
  tag: string,
): Record<string, unknown> {
  const message: Record<string, unknown> = {
    subject: msg.subject,
    body: {
      contentType: "HTML",
      // The hidden preview line production sends: Outlook should show THIS under
      // the subject, not the visible text below it.
      content:
        previewLineHtml(`${msg.label}: hidden preview line — what happened goes here`) +
        `<p><b>${msg.label}</b> — BusinessIT#7 Outlook conversation-grouping test (run ${tag}).</p>` +
        `<p>Safe to delete.</p>`,
    },
    toRecipients: [{ emailAddress: to }],
  };
  if (msg.props.length > 0) message.singleValueExtendedProperties = msg.props;
  if (msg.internetMessageId) message.internetMessageId = msg.internetMessageId;
  return message;
}

// =============================================================================
// REAL ARC emails, to yourself. ARC never emails you about your own action, so
// the in-app way to see a status or assignment email is somebody else making
// the change. These steps call the REAL builders and the REAL send path
// (notifyMentions / notifyChangeEmails — templates, subject, conversation index
// and preview line exactly as production) with a made-up TEST ACTOR as the
// person acting, so nothing is suppressed.
// =============================================================================

/** Who "did" each thing — never a real mailbox, so the actor rules exclude nobody real. */
export const TEST_ACTOR: Person = {
  displayName: "Test Actor",
  email: "arc-test-actor@example.invalid",
};

export interface RealEmailStep {
  label: string;
  send: () => Promise<MailSendResult>;
}

/**
 * Six emails about ONE made-up task, then one about a second — the first six
 * should land in a single conversation and the last in its own. The ids are
 * passed in (random per run) so a run can't join an earlier run's conversation.
 */
export function realEmailSteps(me: Person, tag: string, ids: { a: number; b: number }): RealEmailStep[] {
  const target: ChangeTarget = {
    kind: "task",
    id: ids.a,
    title: `T0-TEST-Email grouping check ${tag}`,
  };
  const other: ChangeTarget = {
    kind: "task",
    id: ids.b,
    title: `T0-TEST-A different item ${tag}`,
  };
  const comment = (
    reason: MentionRecipient["reason"],
    text: string,
    on: ChangeTarget = target,
  ): Promise<MailSendResult> =>
    notifyMentions({
      recipients: [{ email: me.email!, displayName: me.displayName, reason }],
      sender: TEST_ACTOR,
      target: on,
      commentExcerpt: text,
      attachments: [],
    });
  const change = (emails: ChangeEmail[]): Promise<MailSendResult> =>
    notifyChangeEmails({ target, emails });

  return [
    {
      label: "You were assigned",
      send: () =>
        change(
          buildAssigneeChangeEmails({ target, prev: [], next: [me], actor: TEST_ACTOR, watchers: [] }),
        ),
    },
    {
      label: "A comment you're watching",
      send: () => comment("watching", "First pass at the grouping test — this is a comment."),
    },
    {
      label: "You were @-mentioned",
      send: () => comment("mentioned", "@you can you take a look at this one?"),
    },
    {
      label: "Status changed",
      send: () =>
        change(
          buildFieldChangeEmails({
            target,
            fieldLabel: "status",
            from: "BACKLOG",
            to: "In Progress",
            actor: TEST_ACTOR,
            watchers: [me],
            assignees: [],
          }),
        ),
    },
    {
      label: "Checklist box ticked",
      send: () =>
        change(
          buildChecklistToggleEmails({
            target,
            toggles: [{ text: "Order the test parts", checked: true }],
            actor: TEST_ACTOR,
            watchers: [me],
            assignees: [],
          }),
        ),
    },
    {
      label: "A reply to your comment",
      send: () => comment("replied", "Replying to you — done."),
    },
    {
      label: "A comment on a DIFFERENT item (should NOT join)",
      send: () => comment("watching", "This one is about another task.", other),
    },
  ];
}

type Result = { label: string; ok: boolean; error?: string };

// Long enough for each saved copy to land in Sent Items before the next send
// goes looking for it.
const DELAY_MS = 5_000;
// Spaced so the real emails arrive in order, like events would.
const REAL_DELAY_MS = 3_000;

export function DevEmailGroupingTestView() {
  const user = useCurrentUser();
  const [busy, setBusy] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [realTag, setRealTag] = useState<string | null>(null);
  const [realResults, setRealResults] = useState<Result[]>([]);

  const to = user.email ?? "";
  const blocked = USE_MOCK
    ? "VITE_USE_MOCK is on — nothing would be sent. Set VITE_USE_MOCK=false in .env.local and restart the dev server."
    : !SHARED_MAILBOX
      ? "VITE_SHARED_MAILBOX isn't set."
      : !to
        ? "Waiting for your mailbox address…"
        : null;

  async function handleSend() {
    const runTag = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
    const keys = groupingTestItemKeys(runTag);
    const messages = buildGroupingTestMessages(runTag, {
      L: await threadGuid(keys.L),
      M: await threadGuid(keys.M),
    });
    setTag(runTag);
    setResults([]);
    setBusy(true);
    for (const msg of messages) {
      try {
        await graphFetch(`/users/${encodeURIComponent(SHARED_MAILBOX!)}/sendMail`, {
          method: "POST",
          body: JSON.stringify({
            message: buildGroupingTestPayload(msg, { address: to, name: user.displayName }, runTag),
            saveToSentItems: msg.saveToSentItems,
          }),
        });
        setResults((r) => [...r, { label: msg.label, ok: true }]);
      } catch (err) {
        setResults((r) => [
          ...r,
          { label: msg.label, ok: false, error: err instanceof Error ? err.message : String(err) },
        ]);
      }
      // Spaced out so they arrive in order, like real events would.
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
    setBusy(false);
  }

  async function handleSendReal() {
    const runTag = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
    // Random, far above any real task id, so a run never joins a real item's
    // conversation or an earlier run's.
    const base = 900_000_000 + Math.floor(Math.random() * 90_000_000);
    const steps = realEmailSteps(user, runTag, { a: base, b: base + 1 });
    setRealTag(runTag);
    setRealResults([]);
    setBusy(true);
    for (const step of steps) {
      try {
        const res = await step.send();
        const ok = res.sent.length > 0;
        setRealResults((r) => [
          ...r,
          {
            label: step.label,
            ok,
            error: ok ? undefined : (res.failed[0]?.reason ?? "nothing was sent"),
          },
        ]);
      } catch (err) {
        setRealResults((r) => [
          ...r,
          { label: step.label, ok: false, error: err instanceof Error ? err.message : String(err) },
        ]);
      }
      await new Promise((resolve) => setTimeout(resolve, REAL_DELAY_MS));
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 p-8">
      <section className="space-y-3 rounded-md border border-border bg-surface p-4">
        <h1 className="text-lg font-semibold text-fg">Real ARC emails, to you</h1>
        <p className="text-sm text-fg-muted">
          Sends 7 real ARC notification emails to <b>{to || "you"}</b> — the actual templates, subjects and
          grouping production sends — with a made-up <b>Test Actor</b> as the person acting, so none are
          suppressed. The first six are about one test task and should land in <b>one conversation</b>; the last
          is about a different task and should sit on its own. Their buttons link to a task that doesn't exist.
        </p>
        <button
          type="button"
          disabled={busy || !!blocked}
          onClick={handleSendReal}
          className="rounded-md bg-cooper-red px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cooper-red/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Sending…" : "Send real ARC emails to me"}
        </button>
        {realTag && (
          <div className="space-y-1 text-sm">
            <p className="text-fg-muted">
              Run <b>{realTag}</b> — search Outlook for <code>Email grouping check {realTag}</code>.
            </p>
            <ul className="space-y-1">
              {realResults.map((r) => (
                <li key={r.label} className={r.ok ? "text-cooper-green" : "text-cooper-red"}>
                  {r.label}: {r.ok ? "sent" : `failed — ${r.error}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div>
        <h1 className="text-lg font-semibold text-fg">Email conversation-grouping test</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Dev-only — this page doesn't exist in the deployed app. Sends 5 test emails from{" "}
          <b>{SHARED_MAILBOX ?? "(no shared mailbox)"}</b> to <b>{to || "you"}</b>, then you check how Outlook
          groups them with conversation view turned on (desktop and the PWA).
        </p>
      </div>

      <ul className="space-y-2 text-sm">
        {GROUPING_TEST_GROUPS.map((g) => (
          <li key={g.key} className="rounded-md border border-border bg-surface px-3 py-2">
            <div className="font-medium text-fg">
              {g.key}. {g.title}
            </div>
            <div className="text-xs text-fg-muted">{g.expect}</div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={busy || !!blocked}
        onClick={handleSend}
        className="rounded-md bg-cooper-red px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cooper-red/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Sending…" : "Send test emails"}
      </button>

      {blocked && <p className="text-xs text-cooper-red">{blocked}</p>}

      {tag && (
        <div className="space-y-1 text-sm">
          <p className="text-fg-muted">
            Run <b>{tag}</b> — search Outlook for <code>ARC grouping test {tag}</code>.
          </p>
          <ul className="space-y-1">
            {results.map((r) => (
              <li key={r.label} className={r.ok ? "text-cooper-green" : "text-cooper-red"}>
                {r.label}: {r.ok ? "sent" : `failed — ${r.error}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
