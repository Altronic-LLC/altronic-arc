import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapturedError } from "@/lib/errorBuffer";

// =============================================================================
// errorReport tests — verify the Graph sendMail payload shape (subject, body
// includes the description, To = app manager, CC = reporter) and that
// fallbacks fire when the shared mailbox is missing or USE_MOCK is on.
// =============================================================================

const graphFetchMock = vi.fn();

vi.mock("./graph", () => ({
  graphFetch: (...args: unknown[]) => graphFetchMock(...args),
}));

const configMock = vi.hoisted(() => ({
  USE_MOCK: false,
  SHARED_MAILBOX: "engineering-tasks@altronic-llc.com" as string | undefined,
  APP_MANAGER_EMAIL: "ray.white@altronic-llc.com",
}));

vi.mock("./config", () => configMock);

const sample: CapturedError[] = [
  {
    at: new Date("2026-05-21T10:00:00Z"),
    level: "error",
    message: "Something broke",
    stack: "Error: Something broke\n    at foo",
  },
];

const reporter = {
  displayName: "Ray White",
  email: "ray.white@altronic-llc.com",
  lookupId: 12,
};

async function loadSubject() {
  const mod = await import("./errorReport");
  return mod.sendErrorReport;
}

beforeEach(() => {
  graphFetchMock.mockReset();
  graphFetchMock.mockResolvedValue(undefined);
  configMock.USE_MOCK = false;
  configMock.SHARED_MAILBOX = "engineering-tasks@altronic-llc.com";
});

afterEach(() => {
  vi.resetModules();
});

describe("sendErrorReport", () => {
  it("posts a sendMail request with the app manager as To and reporter as CC", async () => {
    const send = await loadSubject();
    await send({
      description: "drag-and-drop blew up",
      reporter,
      captured: sample,
      pageUrl: "https://app.example/kanban",
      userAgent: "TestAgent/1.0",
    });

    expect(graphFetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = graphFetchMock.mock.calls[0]!;
    expect(path).toBe(
      "/users/engineering-tasks%40altronic-llc.com/sendMail",
    );
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.saveToSentItems).toBe(true);
    expect(body.message.toRecipients[0].emailAddress.address).toBe(
      "ray.white@altronic-llc.com",
    );
    expect(body.message.ccRecipients[0].emailAddress.address).toBe(
      "ray.white@altronic-llc.com",
    );
    expect(body.message.subject).toContain("Ray White");
    expect(body.message.body.contentType).toBe("HTML");
    expect(body.message.body.content).toContain("drag-and-drop blew up");
    expect(body.message.body.content).toContain("Something broke");
    expect(body.message.body.content).toContain("TestAgent/1.0");
  });

  it("omits the CC when no reporter is provided", async () => {
    const send = await loadSubject();
    await send({
      description: "",
      reporter: null,
      captured: [],
      pageUrl: "https://app.example/",
      userAgent: "TestAgent/1.0",
    });
    const body = JSON.parse(graphFetchMock.mock.calls[0]![1].body as string);
    expect(body.message.ccRecipients).toEqual([]);
    expect(body.message.body.content).toContain("(no description provided)");
    expect(body.message.body.content).toContain(
      "No console errors were captured",
    );
  });

  it("does not call Graph in mock mode", async () => {
    configMock.USE_MOCK = true;
    vi.resetModules();
    const send = await loadSubject();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await send({
      description: "test",
      reporter,
      captured: [],
      pageUrl: "/",
      userAgent: "TestAgent",
    });
    expect(graphFetchMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });

  it("falls back to console.warn when SHARED_MAILBOX is unset", async () => {
    configMock.SHARED_MAILBOX = undefined;
    vi.resetModules();
    const send = await loadSubject();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await send({
      description: "no mailbox",
      reporter,
      captured: [],
      pageUrl: "/",
      userAgent: "TestAgent",
    });
    expect(graphFetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    info.mockRestore();
  });
});
