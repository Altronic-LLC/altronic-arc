import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// BusinessIT#7: every email about one item lands in ONE Outlook conversation.
// Measured against Exchange (lib/emailThread.ts): that takes the SAME subject
// AND the SAME conversation index on every email — so this asserts the actual
// sendMail payloads, in real mode, across BOTH send paths. A comment and a
// status alert about one item must agree with each other, not just each be
// well-formed.
// =============================================================================

const graphFetch = vi.hoisted(() =>
  vi.fn(async (_path: string, _init?: RequestInit) => ({})),
);

vi.mock("./graph", () => ({
  graphFetch,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  USE_MOCK: false,
  SHARED_MAILBOX: "automation@altronic-llc.com",
}));

const { notifyMentions, notifyChangeEmails } = await import("./email");

interface Sent {
  subject: string;
  index: string | undefined;
  preview: string | undefined;
}

function sent(): Sent[] {
  return graphFetch.mock.calls
    .filter(([path]) => String(path).includes("/sendMail"))
    .map(([, init]) => {
      const m = JSON.parse(String(init?.body)).message;
      return {
        subject: m.subject,
        index: m.singleValueExtendedProperties?.find(
          (p: { id: string }) => p.id === "Binary 0x0071",
        )?.value,
        preview: /^<div style="display:none;[^"]*">([^<]*)<\/div>/.exec(m.body.content)?.[1],
      };
    });
}

const EIR = { kind: "eir" as const, id: 245, title: "EIR_2026-0245 — Pump seal" };
const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };
const TIM = { displayName: "Tim Webster", email: "tim.webster@altronic-llc.com" };

function comment(target: Parameters<typeof notifyMentions>[0]["target"]) {
  return notifyMentions({
    recipients: [{ ...TIM, reason: "watching" }],
    sender: RAY,
    target,
    commentExcerpt: "Looks good.",
    attachments: [],
  });
}

function changeAlert(target: Parameters<typeof notifyChangeEmails>[0]["target"], subject: string) {
  return notifyChangeEmails({
    target,
    emails: [{ ...TIM, subject, headlineHtml: "x" }],
  });
}

beforeEach(() => graphFetch.mockClear());

describe("one Outlook conversation per item", () => {
  it("a comment and a status alert on one item share the subject AND the index", async () => {
    await comment(EIR);
    await changeAlert(EIR, "Status changed on EIR_2026-0245 — Pump seal");
    const [a, b] = sent();
    expect(a.subject).toBe("EIR_2026-0245 — Pump seal");
    expect(b.subject).toBe(a.subject);
    expect(a.index).toBeDefined();
    expect(b.index).toBe(a.index);
  });

  it("what happened becomes the hidden preview line, per email", async () => {
    await comment(EIR);
    await changeAlert(EIR, "Status changed on EIR_2026-0245 — Pump seal");
    expect(sent().map((m) => m.preview)).toEqual([
      "New comment on EIR_2026-0245 — Pump seal",
      "Status changed on EIR_2026-0245 — Pump seal",
    ]);
  });

  it("a different item gets a different conversation", async () => {
    await comment(EIR);
    await comment({ kind: "eir", id: 246, title: "EIR_2026-0246 — Other" });
    const [a, b] = sent();
    expect(a.index).toBeDefined();
    expect(b.index).not.toBe(a.index);
  });

  it("the same id under another kind is another item", async () => {
    await comment(EIR);
    await comment({ kind: "task", id: 245, title: "EIR_2026-0245 — Pump seal" });
    const [a, b] = sent();
    expect(a.index).toBeDefined();
    expect(b.index).not.toBe(a.index);
  });

  it("an override files the email under another item's conversation", async () => {
    await comment({ kind: "quote", id: 7, title: "IQ-COO-0042-R1" });
    await comment({
      kind: "quote",
      id: 7,
      title: "IQ-COO-0042-R1 — component 1003-0114-40",
      thread: { key: "quote:7", subject: "IQ-COO-0042-R1" },
    });
    const [quote, component] = sent();
    expect(component.subject).toBe(quote.subject);
    expect(quote.index).toBeDefined();
    expect(component.index).toBe(quote.index);
  });

  it("an email that isn't about one item keeps its own subject and no conversation", async () => {
    await changeAlert(
      { kind: "altronicPart", id: 0, title: "New list 411", thread: null },
      "New parts list requested: 411",
    );
    const [mail] = sent();
    expect(mail.subject).toBe("New parts list requested: 411");
    expect(mail.index).toBeUndefined();
    expect(mail.preview).toBeUndefined();
  });
});
