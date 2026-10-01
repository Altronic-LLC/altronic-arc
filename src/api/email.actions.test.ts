import { describe, it, expect, vi, beforeEach } from "vitest";

// =============================================================================
// Answer buttons in a change email (the SAP admin's three, Tim 2026-09-29).
//
// Each is a LINK to the item's page with its query appended — never a
// one-click write (see EmailAction). Only Graph is stubbed, so this is the
// real renderer.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn(async (_path: string, _init?: RequestInit) => ({})));

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

const { notifyChangeEmails } = await import("./email");
const { SAP_ACTIONS } = await import("@/lib/partsAlerts");

function sentHtml(): string {
  const call = graphFetch.mock.calls.find(([path]) => String(path).includes("/sendMail"));
  if (!call) throw new Error("no sendMail call");
  return JSON.parse(String(call[1]?.body)).message.body.content;
}

beforeEach(() => graphFetch.mockClear());

describe("change email answer buttons", () => {
  it("renders each action as a link to the item with its query, above the Open button", async () => {
    await notifyChangeEmails({
      target: { kind: "altronicPart", id: 23, title: "604612" },
      emails: [
        { email: "sheila.horn@altronic-llc.com", displayName: "Sheila Horn", subject: "s", headlineHtml: "h", actions: SAP_ACTIONS },
      ],
    });
    const html = sentHtml();
    const base = `${window.location.origin}/engineering/parts/part/23`;
    expect(html).toContain(`href="${base}?sap=added"`);
    expect(html).toContain(`href="${base}?sap=not-needed"`);
    expect(html).toContain(`href="${base}?sap=more-info"`);
    expect(html).toContain("Will be added to SAP but requires more information &gt;");
    // The plain Open link is still there, after the answers.
    expect(html.indexOf(`href="${base}"`)).toBeGreaterThan(html.indexOf("sap=more-info"));
  });

  it("renders no answer buttons for an email without actions", async () => {
    await notifyChangeEmails({
      target: { kind: "altronicPart", id: 23, title: "604612" },
      emails: [{ email: "sheila.horn@altronic-llc.com", displayName: "Sheila Horn", subject: "s", headlineHtml: "h" }],
    });
    expect(sentHtml()).not.toContain("?sap=");
  });
});
