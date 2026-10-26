import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// One email per reason, Bcc'd — not one per person.
//
// A comment used to send one email per recipient, one after another, so
// closing the tab part-way lost the rest (EIR 1205, 2026-10-26: the first
// watcher heard, the two people @-mentioned didn't). These tests run the real
// notifyMentions / notifyChangeEmails with only Graph stubbed.
// =============================================================================

const graphFetch = vi.hoisted(() =>
  vi.fn(async (_path: string, _init?: RequestInit): Promise<unknown> => ({})),
);

vi.mock("./graph", () => ({
  graphFetch,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, SHARED_MAILBOX: "automation@altronic-llc.com" };
});

const email = await import("./email");

type Addr = { emailAddress: { address: string } };
interface Sent {
  to: string[];
  bcc: string[];
  html: string;
}

function sent(): Sent[] {
  return graphFetch.mock.calls
    .filter(([path]) => String(path).includes("/sendMail"))
    .map(([, init]) => {
      const m = JSON.parse(String(init?.body)).message;
      return {
        to: (m.toRecipients ?? []).map((r: Addr) => r.emailAddress.address),
        bcc: (m.bccRecipients ?? []).map((r: Addr) => r.emailAddress.address),
        html: m.body.content,
      };
    });
}

const SENDER = { displayName: "Alexandra Russell", email: "alexandra.russell@altronic-llc.com" };
const TARGET = { kind: "eir" as const, id: 1205, title: "EIR_2026-0300 — Coil supplier" };

function person(n: number, reason: "mentioned" | "watching" = "watching") {
  return { email: `person${n}@altronic-llc.com`, displayName: `Person ${n}`, reason };
}

function notify(recipients: ReturnType<typeof person>[]) {
  return email.notifyMentions({
    recipients,
    sender: SENDER,
    target: TARGET,
    commentExcerpt: "Can you two look at this?",
    attachments: [],
  });
}

beforeEach(() => {
  graphFetch.mockReset();
  graphFetch.mockImplementation(async () => ({}));
});

describe("notifyMentions — one email per reason", () => {
  it("sends a dozen watchers and two mentions as TWO emails, mentions first", async () => {
    const watchers = Array.from({ length: 11 }, (_, i) => person(i + 1));
    const mentioned = [person(20, "mentioned"), person(21, "mentioned")];
    // Watchers come first in the recipient list, as commentNotifyRecipients
    // builds it — the order that lost the mentions on EIR 1205.
    const result = await notify([...watchers, ...mentioned]);

    const mails = sent();
    expect(mails).toHaveLength(2);
    expect(mails[0].bcc).toEqual(mentioned.map((p) => p.email));
    expect(mails[0].html).toContain("You were mentioned");
    expect(mails[1].bcc).toEqual(watchers.map((p) => p.email));
    expect(mails[1].html).toContain("you're watching");
    expect(result.sent).toHaveLength(13);
  });

  it("puts several people in Bcc only, greeted without a name", async () => {
    await notify([person(1), person(2)]);
    const [mail] = sent();
    expect(mail.to).toEqual([]);
    expect(mail.bcc).toEqual(["person1@altronic-llc.com", "person2@altronic-llc.com"]);
    expect(mail.html).toContain(">Hello,</p>");
    expect(mail.html).not.toContain("Person 1");
  });

  it("keeps ONE person in To, greeted by name", async () => {
    await notify([person(1, "mentioned")]);
    const [mail] = sent();
    expect(mail.to).toEqual(["person1@altronic-llc.com"]);
    expect(mail.bcc).toEqual([]);
    expect(mail.html).toContain("Hello <strong>Person 1</strong>,");
  });

  it(`never puts more than ${email.MAX_RECIPIENTS_PER_MESSAGE} people on one email`, async () => {
    const many = Array.from({ length: email.MAX_RECIPIENTS_PER_MESSAGE + 5 }, (_, i) => person(i));
    await notify(many);
    expect(sent().map((m) => m.bcc.length)).toEqual([email.MAX_RECIPIENTS_PER_MESSAGE, 5]);
  });

  it("reports everyone on a failed email as not notified, and still sends the others", async () => {
    graphFetch.mockImplementationOnce(async () => {
      throw new Error("Throttled");
    });
    const result = await notify([person(1), person(2), person(3, "mentioned")]);
    // The mention group goes first and is the one that failed.
    expect(result.failed.map((f) => f.email)).toEqual(["person3@altronic-llc.com"]);
    expect(result.sent).toEqual(["person1@altronic-llc.com", "person2@altronic-llc.com"]);
  });
});

describe("notifyChangeEmails — the same email to several people is one email", () => {
  const change = (n: number, headlineHtml: string) => ({
    email: `person${n}@altronic-llc.com`,
    displayName: `Person ${n}`,
    subject: "Status changed on EIR_2026-0300",
    headlineHtml,
  });

  it("merges identical emails and keeps differently worded ones apart", async () => {
    await email.notifyChangeEmails({
      target: TARGET,
      emails: [
        change(1, "Status moved to Closed."),
        change(2, "Please close it."),
        change(3, "Status moved to Closed."),
      ],
    });
    const mails = sent();
    expect(mails.map((m) => [...m.to, ...m.bcc])).toEqual([
      ["person1@altronic-llc.com", "person3@altronic-llc.com"],
      ["person2@altronic-llc.com"],
    ]);
    expect(mails[0].bcc).toHaveLength(2);
    expect(mails[1].to).toEqual(["person2@altronic-llc.com"]);
    expect(mails[1].html).toContain("Hello <strong>Person 2</strong>,");
  });
});

describe("leaving the page while email is still going out", () => {
  it("asks before unload only while a send is in flight", async () => {
    let release: () => void = () => {};
    graphFetch.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({}))),
    );
    const sending = notify([person(1, "mentioned")]);
    await vi.waitFor(() => expect(graphFetch).toHaveBeenCalled());

    expect(email.isSendingMail()).toBe(true);
    const during = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    email.warnIfSendingOnUnload(during);
    expect(during.defaultPrevented).toBe(true);

    release();
    await sending;
    expect(email.isSendingMail()).toBe(false);
    const after = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    email.warnIfSendingOnUnload(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("is listening on the window", async () => {
    let release: () => void = () => {};
    graphFetch.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({}))),
    );
    const sending = notify([person(1, "mentioned")]);
    await vi.waitFor(() => expect(graphFetch).toHaveBeenCalled());
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    release();
    await sending;
  });
});
