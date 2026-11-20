// =============================================================================
// Grouping ARC's emails into one Outlook conversation per item (BusinessIT#7).
//
// What groups, measured against Exchange Online + new Outlook on 2026-10-12
// over five rounds of test sends from the shared mailbox (see
// views/DevEmailGroupingTestView.tsx, which still sends the final shape):
//
//   same subject alone ............................................ NO
//   a shared PidTagConversationIndex alone, different subjects .... NO
//   ... even with a shared PidTagConversationTopic (0x0070) ....... NO
//   In-Reply-To / References to a root, saved to Sent Items or not  NO
//   a shared conversation index AND an identical subject .......... YES
//
// Exchange copies the conversation topic from the SUBJECT whatever is sent, and
// groups on index + topic together — so BOTH have to match. That is why every
// email about an item now carries:
//
//   * the item's own SUBJECT — its title, the same on every email, whatever
//     happened (`EIR_2026-0245 — Pump seal supplier change`);
//   * the same CONVERSATION INDEX, a pure function of the item (a SHA-256 of its
//     key, a fixed date, no reply block), so any sender produces the same bytes
//     without knowing what was sent before; and
//   * what HAPPENED ("Status changed on …") moved into a hidden preview line at
//     the top of the body, which is what Outlook shows under the subject.
//
// Renaming an item changes its subject, so later emails start a new
// conversation. Accepted (Tim, 2026-10-12): the alternative, a bare id as the
// subject, never splits but is much harder to scan.
// =============================================================================

/** Which conversation an email belongs to. */
export interface EmailThread {
  /** Stable identity of the conversation — `kind:id`. Never shown. */
  key: string;
  /** The subject every email in the conversation carries. */
  subject: string;
}

/** The fields of a mention / change target that decide its conversation. */
export interface ThreadableTarget {
  kind: string;
  id: number;
  title: string;
  /**
   * Overrides the default conversation (`kind:id`, subject = title):
   * an EmailThread to file the email under ANOTHER item's conversation (a
   * quote component's comments go to the quote), or `null` for an email that
   * isn't about one item and keeps its own subject.
   */
  thread?: EmailThread | null;
}

/**
 * The conversation an email to this target belongs to, or null when it should
 * keep its own subject. A target with id 0 is not an item (the parts-list
 * requests use it), so it never threads.
 */
export function emailThreadFor(target: ThreadableTarget): EmailThread | null {
  if (target.thread !== undefined) return target.thread;
  const subject = oneLine(target.title);
  if (!target.id || !subject) return null;
  return { key: `${target.kind}:${target.id}`, subject };
}

/** A subject is one line; a title pasted with a newline in it must not break it. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * The timestamp in every conversation index. Fixed, so the index is a pure
 * function of the item. Exchange orders a conversation by received time, not
 * by this, so its value is otherwise irrelevant — don't "update" it, or every
 * open conversation splits in two.
 */
export const THREAD_INDEX_DATE = new Date(Date.UTC(2026, 0, 1));

/**
 * A PidTagConversationIndex header block (MS-OXOMSG 2.2.1.3): one reserved
 * byte (0x01), the high five bytes of a FILETIME, then a 16-byte GUID.
 * `replies` appends that many five-byte child blocks, as a reply would — ARC
 * sends none; the dev test page uses them.
 */
export function buildConversationIndex(
  date: Date,
  guid: Uint8Array,
  replies = 0,
): Uint8Array {
  // FILETIME = 100ns ticks since 1601-01-01.
  const ticks = (BigInt(date.getTime()) + 11644473600000n) * 10000n;
  const out = new Uint8Array(22 + 5 * replies);
  out[0] = 0x01;
  for (let i = 0; i < 5; i++) {
    out[1 + i] = Number((ticks >> BigInt(56 - 8 * i)) & 0xffn);
  }
  out.set(guid.subarray(0, 16), 6);
  for (let r = 0; r < replies; r++) {
    out.set([0x00, 0x00, 0x01 + r, 0x00, 0x10], 22 + 5 * r);
  }
  return out;
}

/** A 16-byte GUID hashed from a key (the first half of its SHA-256). */
export async function threadGuid(key: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`arc:${key}`));
  return new Uint8Array(digest).slice(0, 16);
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** The MAPI property Graph's `singleValueExtendedProperties` sets the index through. */
export const CONVERSATION_INDEX_PROP = "Binary 0x0071";

/** The extended property that puts a message in `thread`'s conversation. */
export async function conversationIndexProperty(
  thread: EmailThread,
): Promise<{ id: string; value: string }> {
  const index = buildConversationIndex(THREAD_INDEX_DATE, await threadGuid(thread.key));
  return { id: CONVERSATION_INDEX_PROP, value: toBase64(index) };
}

/**
 * The hidden preview line at the top of an email body. Outlook shows the first
 * text of the body under the subject; with the subject fixed per item, this is
 * where "what happened" is read from the inbox. Hidden in the body itself so the
 * visible email is unchanged.
 *
 * Outlook's preview then reads on into the red banner ("ARC Altronic Resource
 * Center — every team's tools…"). Accepted as is (Tim, 2026-10-12): a block of
 * invisible spacer characters after this line, and a shorter banner, were both
 * tried or offered and turned down.
 */
export function previewLineHtml(text: string): string {
  const safe = oneLine(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return (
    `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;` +
    `opacity:0;overflow:hidden;mso-hide:all;">${safe}</div>`
  );
}
