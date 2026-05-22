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

import { NotifyAppManagerButton } from "./NotifyAppManagerButton";

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue(undefined);
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
