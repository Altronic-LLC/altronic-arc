import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// A threaded reply emails the person replied to "X replied to your comment"
// (BusinessIT#9). Real mode, so the actual sendMail payload is what's asserted.
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
  sender: { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
  target: { kind: "task" as const, id: 15, title: "T1-0017-Coil rework" },
  attachments: [],
};
const parentAuthor = {
  displayName: "Matthew Traina",
  email: "matthew.traina@altronic-llc.com",
  reason: "replied" as const,
};

beforeEach(() => graphFetch.mockClear());

describe("notifyMentions — a reply", () => {
  it("tells the parent's author that someone replied to them", async () => {
    await notifyMentions({ ...base, recipients: [parentAuthor], commentExcerpt: "On it." });
    const [mail] = sent();
    expect(mail.subject).toBe("Ray White replied to your comment on T1-0017-Coil rework");
    expect(mail.html).toContain("replied to your comment on");
  });

  it("an attachment-only reply still says it was in reply to them", async () => {
    await notifyMentions({ ...base, recipients: [parentAuthor], commentExcerpt: "📎 shot.png" });
    expect(sent()[0].html).toContain("in reply to your comment");
  });
});
