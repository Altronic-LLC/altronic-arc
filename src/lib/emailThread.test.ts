import { describe, expect, it } from "vitest";
import {
  CONVERSATION_INDEX_PROP,
  THREAD_INDEX_DATE,
  buildConversationIndex,
  conversationIndexProperty,
  emailThreadFor,
  previewLineHtml,
  threadGuid,
  toBase64,
} from "./emailThread";

const GUID = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const bytes = (b64: string) => Array.from(atob(b64), (c) => c.charCodeAt(0));

describe("emailThreadFor", () => {
  it("files an item's emails under `kind:id`, with its title as the subject", () => {
    expect(emailThreadFor({ kind: "eir", id: 245, title: "EIR_2026-0245 — Pump seal" })).toEqual({
      key: "eir:245",
      subject: "EIR_2026-0245 — Pump seal",
    });
  });

  it("puts the subject on one line — a pasted newline must not break it", () => {
    expect(emailThreadFor({ kind: "task", id: 1, title: "  T1-0001-Fix\n the  pump  " })?.subject).toBe(
      "T1-0001-Fix the pump",
    );
  });

  it("honours an override — an email filed under ANOTHER item's conversation", () => {
    const thread = { key: "quote:7", subject: "IQ-COO-0042-R1" };
    expect(emailThreadFor({ kind: "quote", id: 7, title: "IQ-COO-0042-R1 — component 1", thread })).toBe(
      thread,
    );
  });

  it("null opts out: an email that isn't about one item keeps its own subject", () => {
    expect(emailThreadFor({ kind: "altronicPart", id: 5, title: "x", thread: null })).toBeNull();
  });

  it("id 0 is not an item, and a blank title has no subject — neither threads", () => {
    expect(emailThreadFor({ kind: "altronicPart", id: 0, title: "New list 411" })).toBeNull();
    expect(emailThreadFor({ kind: "task", id: 3, title: "   " })).toBeNull();
  });
});

describe("buildConversationIndex", () => {
  const NOW = new Date(Date.UTC(2026, 9, 12));

  it("is a 22-byte header: 0x01, the high five FILETIME bytes, then the GUID", () => {
    const idx = buildConversationIndex(NOW, GUID);
    expect(idx).toHaveLength(22);
    expect(idx[0]).toBe(0x01);

    const ticks = (BigInt(NOW.getTime()) + 11644473600000n) * 10000n;
    const be = new Uint8Array(8);
    new DataView(be.buffer).setBigUint64(0, ticks);
    expect(Array.from(idx.subarray(1, 6))).toEqual(Array.from(be.subarray(0, 5)));

    expect(Array.from(idx.subarray(6))).toEqual(Array.from(GUID));
  });

  it("a reply keeps the parent's header and appends a five-byte child block", () => {
    const reply = buildConversationIndex(NOW, GUID, 1);
    expect(reply).toHaveLength(27);
    expect(Array.from(reply.subarray(0, 22))).toEqual(Array.from(buildConversationIndex(NOW, GUID)));
  });
});

describe("threadGuid", () => {
  it("is 16 bytes, the same for the same key, and different for another key", async () => {
    const a = await threadGuid("eir:245");
    expect(a).toHaveLength(16);
    expect(Array.from(await threadGuid("eir:245"))).toEqual(Array.from(a));
    expect(Array.from(await threadGuid("eir:246"))).not.toEqual(Array.from(a));
  });
});

describe("conversationIndexProperty", () => {
  // The whole design: every email about an item carries the SAME bytes,
  // whoever sends it and whenever — so it can't depend on the clock.
  it("is a pure function of the thread key — identical every time", async () => {
    const thread = { key: "eir:245", subject: "x" };
    const a = await conversationIndexProperty(thread);
    const b = await conversationIndexProperty({ ...thread, subject: "renamed" });
    expect(b).toEqual(a);
    expect(a.id).toBe(CONVERSATION_INDEX_PROP);
    expect(a.id).toBe("Binary 0x0071");
  });

  it("is the 22-byte header for the key's GUID at the fixed date, with no reply block", async () => {
    const prop = await conversationIndexProperty({ key: "task:12", subject: "x" });
    expect(prop.value).toBe(toBase64(buildConversationIndex(THREAD_INDEX_DATE, await threadGuid("task:12"))));
    expect(bytes(prop.value)).toHaveLength(22);
  });

  it("two items get two different conversations", async () => {
    const a = await conversationIndexProperty({ key: "eir:245", subject: "x" });
    const b = await conversationIndexProperty({ key: "task:245", subject: "x" });
    expect(a.value).not.toBe(b.value);
  });
});

describe("previewLineHtml", () => {
  it("is hidden in the body, escaped, and on one line", () => {
    const html = previewLineHtml("Status changed on <T1>\n& more");
    expect(html).toMatch(/^<div style="display:none;[^"]*mso-hide:all;">/);
    expect(html).toContain("Status changed on &lt;T1&gt; &amp; more</div>");
  });

  it("is the line alone — no spacer block after it (tried and turned down)", () => {
    expect(previewLineHtml("Status changed")).toMatch(/^<div[^>]*>Status changed<\/div>$/);
  });
});
