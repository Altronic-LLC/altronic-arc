import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// Mock current user — swap implementation in individual tests to simulate
// the unauthenticated sign-in-screen case.
const currentUserMock = vi.fn(() => ({
  displayName: "Ray White",
  email: "ray.white@altronic-llc.com",
  lookupId: 12,
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => currentUserMock(),
}));

// Capture sends without actually hitting Graph.
const sendMock = vi.fn();
vi.mock("@/api/errorReport", () => ({
  sendErrorReport: (...args: unknown[]) => sendMock(...args),
}));

// Stub config so the button label paragraph is stable.
vi.mock("@/api/config", () => ({
  APP_MANAGER_EMAIL: "ray.white@altronic-llc.com",
}));

// Control what the console-error buffer hands the modal. Defaults to empty so
// the existing expectations (Send disabled with nothing to report) still hold.
const capturedMock = vi.fn<() => CapturedError[]>(() => []);
const clearMock = vi.fn();
vi.mock("@/lib/errorBuffer", () => ({
  getRecentErrors: () => capturedMock(),
  clearRecentErrors: () => clearMock(),
}));

import type { CapturedError } from "@/lib/errorBuffer";
import {
  NotifyAppManagerButton,
  buildMailtoBody,
  formatCapturedEntry,
} from "./NotifyAppManagerButton";

function entry(n: number, extra: Partial<CapturedError> = {}): CapturedError {
  return {
    at: new Date(Date.UTC(2026, 6, 30, 12, 0, n % 60)),
    level: "error",
    message: `boom number ${n} — a message long enough that a single line of a narrow preview box would clip it well before the useful part`,
    ...extra,
  };
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue(undefined);
  capturedMock.mockReset();
  capturedMock.mockReturnValue([]);
  clearMock.mockReset();
  currentUserMock.mockReturnValue({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 12,
  });
});

describe("NotifyAppManagerButton", () => {
  it("opens the modal when clicked", async () => {
    renderWithProviders(<NotifyAppManagerButton />);
    fireEvent.click(screen.getByRole("button", { name: /notify app manager/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/report an issue/i)).toBeInTheDocument();
  });

  it("sends the report with the typed description and closes on success", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotifyAppManagerButton />);
    fireEvent.click(screen.getByRole("button", { name: /notify app manager/i }));

    const textarea = await screen.findByPlaceholderText(/I tried to drag/i);
    await user.type(textarea, "tried to drag and the page reloaded");
    await user.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledTimes(1);
    });
    const arg = sendMock.mock.calls[0]![0];
    expect(arg.description).toBe("tried to drag and the page reloaded");
    expect(arg.reporter).toEqual({
      displayName: "Ray White",
      email: "ray.white@altronic-llc.com",
      lookupId: 12,
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("disables send when description is empty and there are no captured errors", async () => {
    renderWithProviders(<NotifyAppManagerButton />);
    fireEvent.click(screen.getByRole("button", { name: /notify app manager/i }));
    const sendBtn = await screen.findByRole("button", { name: /send report/i });
    expect(sendBtn).toBeDisabled();
  });

  it("closes on a clean click on the backdrop", async () => {
    renderWithProviders(<NotifyAppManagerButton />);
    fireEvent.click(screen.getByRole("button", { name: /notify app manager/i }));
    const backdrop = (await screen.findByRole("dialog")).parentElement!;

    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("keeps the typed description when a selection drag ends on the backdrop", async () => {
    renderWithProviders(<NotifyAppManagerButton />);
    fireEvent.click(screen.getByRole("button", { name: /notify app manager/i }));
    const dialog = await screen.findByRole("dialog");
    const backdrop = dialog.parentElement!;
    const textarea = screen.getByPlaceholderText(/I tried to drag/i);
    fireEvent.change(textarea, { target: { value: "half a bug report" } });

    // Highlight the text backwards: press inside the field, release out on the
    // backdrop. The browser fires the click on the backdrop, which used to
    // dismiss the modal and lose the report.
    fireEvent.mouseDown(textarea);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/I tried to drag/i)).toHaveValue(
      "half a bug report",
    );
  });

  it("shows every captured entry in the preview, wrapped rather than clipped", async () => {
    capturedMock.mockReturnValue([entry(1), entry(2), entry(3)]);
    renderWithProviders(<NotifyAppManagerButton />);
    fireEvent.click(screen.getByRole("button", { name: /notify app manager/i }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    for (const li of items) {
      // The message must be readable in full — no line clamping.
      expect(li.className).not.toContain("truncate");
      expect(li.className).toContain("whitespace-pre-wrap");
    }
    expect(items[0]!.textContent).toContain("boom number 1");
    expect(items[2]!.textContent).toContain("well before the useful part");
  });

  it("sends every captured entry to Graph — nothing is trimmed on the way", async () => {
    const all = Array.from({ length: 60 }, (_, i) => entry(i));
    capturedMock.mockReturnValue(all);
    const user = userEvent.setup();
    renderWithProviders(<NotifyAppManagerButton />);
    fireEvent.click(screen.getByRole("button", { name: /notify app manager/i }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect(sendMock.mock.calls[0]![0].captured).toHaveLength(60);
  });

  it("closes the modal when Cancel is clicked", async () => {
    renderWithProviders(<NotifyAppManagerButton />);
    fireEvent.click(screen.getByRole("button", { name: /notify app manager/i }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("falls back to a mailto: draft when Graph send fails (e.g. shared mailbox 404)", async () => {
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error("Graph 404 ErrorItemNotFound"), { name: "GraphError" }),
    );
    const hrefSetter = vi.fn();
    const locationStub = {} as Location;
    Object.defineProperty(locationStub, "href", {
      configurable: true,
      get: () => "",
      set: (v: string) => hrefSetter(v),
    });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: locationStub,
    });
    // Silence the deliberate console.error so it doesn't clutter output.
    const origErr = console.error;
    console.error = vi.fn();

    try {
      const user = userEvent.setup();
      renderWithProviders(<NotifyAppManagerButton />);
      fireEvent.click(screen.getByRole("button", { name: /notify app manager/i }));
      await screen.findByRole("dialog");

      const textarea = await screen.findByPlaceholderText(/I tried to drag/i);
      await user.type(textarea, "mailbox is broken");
      await user.click(screen.getByRole("button", { name: /send report/i }));

      // Graph was tried first…
      await waitFor(() => {
        expect(sendMock).toHaveBeenCalledTimes(1);
      });
      // …and then the mailto: draft opened as fallback.
      await waitFor(() => {
        expect(hrefSetter).toHaveBeenCalledTimes(1);
      });
      const href = hrefSetter.mock.calls[0]![0] as string;
      expect(href.startsWith("mailto:ray.white@altronic-llc.com")).toBe(true);
      expect(decodeURIComponent(href)).toContain("mailbox is broken");
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    } finally {
      console.error = origErr;
    }
  });

  it("falls back to a mailto: draft when not signed in", async () => {
    currentUserMock.mockReturnValue({
      displayName: "Unknown user",
      email: "",
      lookupId: 0,
    });
    // window.location.href is read-only in jsdom; replace the whole
    // location object with a plain stub whose href setter we can spy on.
    const hrefSetter = vi.fn();
    const locationStub = {} as Location;
    Object.defineProperty(locationStub, "href", {
      configurable: true,
      get: () => "",
      set: (v: string) => hrefSetter(v),
    });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: locationStub,
    });

    const user = userEvent.setup();
    renderWithProviders(<NotifyAppManagerButton />);
    fireEvent.click(screen.getByRole("button", { name: /notify app manager/i }));
    await screen.findByRole("dialog");

    // Send button label flips to "Open email draft" when unauthenticated.
    expect(
      screen.getByText(/not signed in.*draft email/i),
    ).toBeInTheDocument();

    const textarea = await screen.findByPlaceholderText(/I tried to drag/i);
    await user.type(textarea, "stuck on sign-in");
    await user.click(screen.getByRole("button", { name: /open email draft/i }));

    expect(sendMock).not.toHaveBeenCalled();
    expect(hrefSetter).toHaveBeenCalledTimes(1);
    const href = hrefSetter.mock.calls[0]![0] as string;
    expect(href.startsWith("mailto:ray.white@altronic-llc.com")).toBe(true);
    expect(decodeURIComponent(href)).toContain("stuck on sign-in");
  });
});

describe("formatCapturedEntry", () => {
  it("keeps the level, timestamp, message, source and stack", () => {
    const text = formatCapturedEntry(
      entry(7, {
        message: "Cannot read properties of undefined",
        stack: "at doThing (app.js:1:2)\nat next (app.js:3:4)",
        source: "app.js:1:2",
      }),
    );
    expect(text).toContain("[ERROR]");
    expect(text).toContain("2026-07-30T12:00:07.000Z");
    expect(text).toContain("Cannot read properties of undefined");
    expect(text).toContain("at doThing (app.js:1:2)");
    expect(text).toContain("at next (app.js:3:4)");
    expect(text).toContain("app.js:1:2");
  });
});

describe("buildMailtoBody", () => {
  const base = {
    description: "the kanban reloaded",
    pageUrl: "https://altronic-llc.github.io/altronic-arc/",
    userAgent: "Mozilla/5.0 (Windows NT 10.0)",
  };

  it("includes the description, page and browser", () => {
    const body = buildMailtoBody({ ...base, captured: [] });
    expect(body).toContain("the kanban reloaded");
    expect(body).toContain(base.pageUrl);
    expect(body).toContain(base.userAgent);
    expect(body).toContain("No console errors were captured");
  });

  it("includes EVERY captured entry when they fit — no silent truncation", () => {
    const captured = Array.from({ length: 25 }, (_, i) => ({
      at: new Date(Date.UTC(2026, 6, 30, 12, 0, i)),
      level: "warn" as const,
      message: `short warning ${i}`,
    }));
    const body = buildMailtoBody({ ...base, captured });

    for (let i = 0; i < 25; i++) {
      expect(body).toContain(`short warning ${i}`);
    }
    expect(body).toContain("Captured console output (25)");
    expect(body).not.toContain("not pasted above");
  });

  it("keeps entries whole and says exactly how many were left out when the URL can't carry them", () => {
    // Deliberately enormous: far more than any mailto link can hold.
    const captured = Array.from({ length: 100 }, (_, i) =>
      entry(i, { message: `entry ${i} ${"x".repeat(400)}` }),
    );
    const body = buildMailtoBody({ ...base, captured });

    // Newest first, and whatever is included is included in full.
    expect(body).toContain("entry 99");
    expect(body).toContain("x".repeat(400));
    // The shortfall is stated, with a count and where to find the rest.
    const match = body.match(/of 100 below/);
    expect(match).not.toBeNull();
    expect(body).toMatch(/NOTE: \d+ older entr(y|ies) would push this draft/);
    expect(body).toContain("full captured console output");
  });

  it("always carries at least the newest entry, however long it is", () => {
    const captured = [entry(1, { message: "y".repeat(20000) })];
    const body = buildMailtoBody({ ...base, captured });
    expect(body).toContain("y".repeat(20000));
  });
});
