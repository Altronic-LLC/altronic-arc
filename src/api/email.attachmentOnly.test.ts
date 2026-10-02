import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// A comment that is ONLY attached files is emailed as "X added an attachment",
// not as a "New comment" whose body is a paperclip (Ray, 2026-10-02). Real
// mode, so the actual sendMail payload is what's asserted.
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

const { notifyMentions } = await import("./email");

function sent(): { subject: string; html: string }[] {
  return graphFetch.mock.calls
    .filter(([path]) => String(path).includes("/sendMail"))
    .map(([, init]) => {
      const m = JSON.parse(String(init?.body)).message;
      return { subject: m.subject, html: m.body.content };
    });
}

const base = {
  sender: { displayName: "Jerrod Waldron", email: "jerrod.waldron@altronic-llc.com" },
  target: { kind: "eir" as const, id: 42, title: "EIR_2026-0042 — Coil" },
  attachments: [],
};
const watcher = { displayName: "Ray White", email: "ray.white@altronic-llc.com", reason: "watching" as const };

beforeEach(() => graphFetch.mockClear());

describe("notifyMentions — attachment-only comment", () => {
  it("says the sender added an attachment, and names the file", async () => {
    await notifyMentions({ ...base, recipients: [watcher], commentExcerpt: "📎 shot.png" });
    const [mail] = sent();
    expect(mail.subject).toBe("Jerrod Waldron added an attachment to EIR_2026-0042 — Coil");
    expect(mail.html).toContain("added an attachment to an EIR you're watching");
    expect(mail.html).toContain("shot.png");
    expect(mail.html).not.toContain("commented on");
  });

  it("counts several files", async () => {
    await notifyMentions({
      ...base,
      recipients: [{ ...watcher, reason: "assigned" }],
      commentExcerpt: "📎 a.pdf\n\n📎 b.png",
    });
    const [mail] = sent();
    expect(mail.subject).toBe("Jerrod Waldron added 2 attachments to EIR_2026-0042 — Coil");
    expect(mail.html).toContain("assigned to you");
  });

  it("a comment with text keeps the normal wording", async () => {
    await notifyMentions({ ...base, recipients: [watcher], commentExcerpt: "See this\n\n📎 a.pdf" });
    expect(sent()[0].subject).toBe("New comment on EIR_2026-0042 — Coil");
  });

  it("an edited comment keeps its own wording", async () => {
    await notifyMentions({
      ...base,
      recipients: [{ ...watcher, reason: "edited" }],
      commentExcerpt: "📎 shot.png",
    });
    expect(sent()[0].subject).toBe("Updated comment on EIR_2026-0042 — Coil");
  });
});
