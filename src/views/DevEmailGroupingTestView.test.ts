import { describe, expect, it, vi } from "vitest";

const email = vi.hoisted(() => ({
  notifyMentions: vi.fn(async (_input: unknown) => ({ sent: ["x"], failed: [] })),
  notifyChangeEmails: vi.fn(async (_input: unknown) => ({ sent: ["x"], failed: [] })),
}));
vi.mock("@/api/email", () => email);

import {
  TEST_ACTOR,
  buildGroupingTestMessages,
  buildGroupingTestPayload,
  groupingTestItemKeys,
  realEmailSteps,
  type GroupingTestMessage,
} from "./DevEmailGroupingTestView";
import { conversationIndexProperty, emailThreadFor, threadGuid } from "@/lib/emailThread";
import type { ChangeEmail, ChangeTarget } from "@/lib/changeAlerts";

describe("realEmailSteps", () => {
  const me = { displayName: "Tim Webster", email: "tim.webster@altronic-llc.com" };

  it("sends seven real emails — six about one item, then one about another", async () => {
    const steps = realEmailSteps(me, "101500", { a: 900000001, b: 900000002 });
    expect(steps).toHaveLength(7);
    for (const s of steps) await s.send();

    const targets: ChangeTarget[] = [
      ...email.notifyMentions.mock.calls.map(([i]) => (i as { target: ChangeTarget }).target),
      ...email.notifyChangeEmails.mock.calls.map(([i]) => (i as { target: ChangeTarget }).target),
    ];
    expect(targets).toHaveLength(7);
    const keys = targets.map((t) => emailThreadFor(t)?.key);
    expect(keys.filter((k) => k === "task:900000001")).toHaveLength(6);
    expect(keys.filter((k) => k === "task:900000002")).toHaveLength(1);
  });

  it("every change email reaches ME — the made-up actor suppresses nobody real", async () => {
    email.notifyChangeEmails.mockClear();
    for (const s of realEmailSteps(me, "101500", { a: 1, b: 2 })) await s.send();
    const batches = email.notifyChangeEmails.mock.calls.map(([i]) => (i as { emails: ChangeEmail[] }).emails);
    expect(batches).toHaveLength(3);
    for (const emails of batches) {
      expect(emails.map((e) => e.email)).toEqual([me.email]);
    }
    expect(TEST_ACTOR.email).toMatch(/\.invalid$/);
  });

  it("comment emails are sent by the test actor, to me, with the right reasons", async () => {
    email.notifyMentions.mockClear();
    for (const s of realEmailSteps(me, "101500", { a: 1, b: 2 })) await s.send();
    const calls = email.notifyMentions.mock.calls.map(
      ([i]) => i as { sender: unknown; recipients: { email: string; reason: string }[] },
    );
    expect(calls.map((c) => c.recipients[0].reason)).toEqual(["watching", "mentioned", "replied", "watching"]);
    for (const c of calls) {
      expect(c.sender).toBe(TEST_ACTOR);
      expect(c.recipients[0].email).toBe(me.email);
    }
  });
});

// The index maths itself is tested in lib/emailThread.test.ts; this covers
// that the page sends exactly what production does.

describe("buildGroupingTestMessages", async () => {
  const keys = groupingTestItemKeys("101500");
  const guids = { L: await threadGuid(keys.L), M: await threadGuid(keys.M) };
  const msgs = buildGroupingTestMessages("101500", guids);
  const group = (g: string) => msgs.filter((m) => m.label.startsWith(g));
  const index = (m: GroupingTestMessage) => m.props.find((p) => p.id === "Binary 0x0071")?.value;

  it("every subject carries the run tag, so a run can be searched for", () => {
    for (const m of msgs) expect(m.subject).toContain("ARC grouping test 101500");
  });

  it("every email about an item carries the IDENTICAL subject and index", () => {
    for (const g of ["L", "M"]) {
      const items = group(g);
      expect(new Set(items.map((m) => m.subject)).size).toBe(1);
      expect(new Set(items.map(index)).size).toBe(1);
    }
    expect(group("L")).toHaveLength(3);
    expect(group("M")).toHaveLength(2);
  });

  it("the index is the one production builds for that key", async () => {
    const prod = await conversationIndexProperty({ key: keys.L, subject: "x" });
    expect(index(group("L")[0])).toBe(prod.value);
  });

  it("two items get different subjects and different indexes", () => {
    expect(group("L")[0].subject).not.toBe(group("M")[0].subject);
    expect(index(group("L")[0])).not.toBe(index(group("M")[0]));
  });

  it("is sent the normal way, with only the index — no tracking flag, no topic", () => {
    for (const m of msgs) {
      expect(m.saveToSentItems).toBe(false);
      expect(m.props.map((p) => p.id)).toEqual(["Binary 0x0071"]);
    }
  });
});

describe("buildGroupingTestPayload", async () => {
  const to = { address: "tim.webster@altronic-llc.com", name: "Tim Webster" };
  const msgs = buildGroupingTestMessages("101500", {
    L: await threadGuid("a"),
    M: await threadGuid("b"),
  });
  const l1 = msgs.find((m) => m.label === "L1")!;

  it("sends a message's MAPI properties as singleValueExtendedProperties", () => {
    expect(buildGroupingTestPayload(l1, to, "101500").singleValueExtendedProperties).toEqual(l1.props);
  });

  it("starts the body with the hidden preview line production sends", () => {
    const body = buildGroupingTestPayload(l1, to, "101500").body as { content: string };
    expect(body.content).toMatch(/^<div style="display:none;[^"]*">L1: hidden preview line/);
  });

  it("sets internetMessageId only on a message that carries one", () => {
    expect(buildGroupingTestPayload(l1, to, "101500")).not.toHaveProperty("internetMessageId");
    const withId = { ...l1, internetMessageId: "<x@altronic-llc.com>" };
    expect(buildGroupingTestPayload(withId, to, "101500").internetMessageId).toBe("<x@altronic-llc.com>");
  });

  it("leaves the extended properties off a message with none", () => {
    expect(buildGroupingTestPayload({ ...l1, props: [] }, to, "101500")).not.toHaveProperty(
      "singleValueExtendedProperties",
    );
  });
});
