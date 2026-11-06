import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// BusinessIT#67: a task, EIR or build request email carries a CONTEXT, drawn
// as three blocks under the greeting — the card (with the parent / linked
// task above the title), What's new, then the description or details. Every
// other email keeps the single-message layout. Asserted on the real sendMail
// payloads, in real mode, across both send paths.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn(async (_path: string, _init?: RequestInit) => ({})));
const pushToast = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
vi.mock("@/components/Toast", () => ({ pushToast }));
vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  USE_MOCK: false,
  SHARED_MAILBOX: "automation@altronic-llc.com",
}));

const { notifyMentions, notifyChangeEmails, sendOpenAlert, firePromotionAlert } = await import("./email");
const { DESCRIPTION_EXCERPT_MAX_CHARS } = await import("@/lib/changeAlerts");

interface SentMessage {
  subject: string;
  body: { content: string };
  toRecipients?: Array<{ emailAddress: { address: string } }>;
  bccRecipients?: Array<{ emailAddress: { address: string } }>;
}

function messages(): SentMessage[] {
  return graphFetch.mock.calls
    .filter(([path]) => String(path).includes("/sendMail"))
    .map(([, init]) => JSON.parse(String(init?.body)).message);
}
const body = () => messages()[0].body.content;

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com" };
const TIM = { displayName: "Tim Webster", email: "tim.webster@altronic-llc.com" };

const TASK = {
  kind: "task" as const,
  id: 3344,
  title: "T188-321-CM4 BOM changes",
  context: {
    above: { label: "Parent task", title: "T12-321-Pump seal supplier change", url: "https://arc.example/task/3290" },
    description: "<p>Update the CM4 BOM for the Acme seal and re-release it as rev D.</p>",
  },
};

function statusEmail(target: Parameters<typeof notifyChangeEmails>[0]["target"]) {
  return notifyChangeEmails({
    target,
    emails: [
      {
        email: TIM.email,
        displayName: TIM.displayName,
        subject: `Status changed on ${target.title}`,
        headlineHtml: "<strong>Ray White</strong> changed the status of this task.",
        detailHtml: "In Progress &rarr; <strong>Complete</strong>",
      },
    ],
  });
}

beforeEach(() => {
  graphFetch.mockClear();
  pushToast.mockClear();
});

describe("the three-block layout", () => {
  it("puts the card, then What's new, then the description, in that order", async () => {
    await statusEmail(TASK);
    const html = body();
    const card = html.indexOf("T188-321-CM4 BOM changes</div>");
    const whatsNew = html.indexOf("What's new");
    const change = html.indexOf("In Progress &rarr;");
    const description = html.indexOf(">Description<");
    expect(card).toBeGreaterThan(-1);
    expect(whatsNew).toBeGreaterThan(card);
    // What changed comes before the description, so a phone shows it first.
    expect(change).toBeGreaterThan(whatsNew);
    expect(description).toBeGreaterThan(change);
    expect(html).toContain("Update the CM4 BOM for the Acme seal");
  });

  it("shows the parent task above the task, as a link", async () => {
    await statusEmail(TASK);
    expect(body()).toContain(
      'Parent task: <a href="https://arc.example/task/3290" style="color:#6b7280;">T12-321-Pump seal supplier change</a>',
    );
  });

  it("never puts the parent in the subject — it stays the task's own title", async () => {
    await statusEmail(TASK);
    expect(messages()[0].subject).toBe("T188-321-CM4 BOM changes");
  });

  it("puts the comment under What's new on a comment email, above the description", async () => {
    await notifyMentions({
      recipients: [{ ...TIM, reason: "watching" }],
      sender: RAY,
      target: TASK,
      commentExcerpt: "Acme confirmed 77-410 is in SAP.",
      attachments: [],
    });
    const html = body();
    expect(html.indexOf("Acme confirmed 77-410")).toBeGreaterThan(html.indexOf("What's new"));
    expect(html.indexOf(">Description<")).toBeGreaterThan(html.indexOf("Acme confirmed 77-410"));
  });

  it("cuts a long description at 600 characters and links to the rest", async () => {
    const long = `<p>${"Check the seal rating against the enclosure spec. ".repeat(30)}</p>`;
    await statusEmail({ ...TASK, context: { description: long } });
    const html = body();
    expect(html).toContain("Read the full description in ARC");
    const shown = /Description<\/div><div style="font-size:14px;">([^<]*)<\/div>/.exec(html)?.[1] ?? "";
    expect(shown.endsWith("…")).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(DESCRIPTION_EXCERPT_MAX_CHARS + 1);
  });

  it("offers no 'Read the full description' link when the description fits", async () => {
    await statusEmail(TASK);
    expect(body()).not.toContain("Read the full description");
  });

  it("shows no Description block for an empty description", async () => {
    await statusEmail({ ...TASK, context: { description: "<p> </p>" } });
    expect(body()).toContain("What's new");
    expect(body()).not.toContain(">Description<");
  });

  it("shows a build request's details, and its linked task, in place of a description", async () => {
    await statusEmail({
      kind: "buildRequest",
      id: 81,
      title: "BR_2026-0081 — CM4 seal change pilot build",
      context: {
        above: { label: "Task", title: "T188-321-CM4 BOM changes", url: "https://arc.example/task/3344" },
        details: [
          { label: "Product", value: "CM4 controller" },
          { label: "Customer", value: "Northwind & Co" },
        ],
      },
    });
    const html = body();
    expect(html).toContain('Task: <a href="https://arc.example/task/3344"');
    expect(html).toContain(">Details<");
    expect(html).toContain("Product: <strong>CM4 controller</strong>");
    // Escaped like every other value in an email.
    expect(html).toContain("Northwind &amp; Co");
  });

  it("leaves every other email in the single-message layout", async () => {
    await statusEmail({ kind: "fait", id: 52, title: "1003-0114-40 — Ignition coil bracket" });
    expect(body()).not.toContain("What's new");
    expect(body()).toContain("In Progress &rarr;");
  });
});

describe("the EIR promotion email", () => {
  it("is the EIR's card and description, names the new task as a link, and its button opens the task", async () => {
    firePromotionAlert({
      eir: {
        id: 245,
        eirNo: "EIR_2026-0245",
        title: "Pump seal supplier change",
        description: "<p>Garlock has issued a last-time-buy notice.</p>",
        watchers: [TIM],
      },
      task: { id: 3344, numberedTitle: "T188-321-Pump seal supplier change", title: "Pump seal supplier change" },
      actor: RAY,
    });
    await vi.waitFor(() => expect(messages()).toHaveLength(1));
    const [m] = messages();
    const html = m.body.content;
    // Filed under the EIR's conversation, as before.
    expect(m.subject).toBe("EIR_2026-0245 — Pump seal supplier change");
    expect(html).toMatch(/>EIR<\/div>/);
    expect(html).toContain("promoted this EIR to task");
    expect(html).toMatch(/href="[^"]*\/task\/3344"[^>]*>T188-321-Pump seal supplier change<\/a>/);
    expect(html).toContain("Garlock has issued a last-time-buy notice.");
    expect(html).toMatch(/href="[^"]*\/task\/3344"[^>]*>Open the new task<\/a>/);
  });
});

describe("sendOpenAlert (the potting sample alert)", () => {
  const input = {
    subject: "[ARC] Coil potting sample above upper limit — weight 412",
    recipients: [RAY, TIM],
    calloutLabel: "Potting Sample",
    calloutTitle: "Weight 412 — Nov 5, 2026, 9:20 AM",
    introHtml: "A recorded coil potting sample weight is <strong>above the upper spec limit</strong>.",
    messageHtml: "Weight: <strong>412</strong>",
  };

  it("puts everyone in To, so Reply all reaches the whole list", async () => {
    await sendOpenAlert(input);
    const [m] = messages();
    expect(messages()).toHaveLength(1);
    expect(m.toRecipients?.map((r) => r.emailAddress.address)).toEqual([RAY.email, TIM.email]);
    expect(m.bccRecipients).toBeUndefined();
    expect(m.subject).toBe(input.subject);
  });

  it("uses the ARC layout with no button, and a footer that invites Reply all", async () => {
    await sendOpenAlert(input);
    const html = body();
    expect(html).toContain("Altronic Resource Center");
    expect(html).toContain("Potting Sample");
    expect(html).toContain("Weight: <strong>412</strong>");
    expect(html).not.toContain("<a href");
    expect(html).toContain("Reply all to discuss it with everyone on the list");
    expect(html).not.toContain("Do not reply");
  });

  it("says so when the send fails, instead of failing silently", async () => {
    graphFetch.mockRejectedValueOnce(new Error("Graph 500"));
    const result = await sendOpenAlert(input);
    expect(result.sent).toEqual([]);
    expect(result.failed.map((f) => f.email)).toEqual([RAY.email, TIM.email]);
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: expect.stringContaining("The sample saved") }),
    );
  });
});
