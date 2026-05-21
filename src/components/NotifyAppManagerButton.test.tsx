import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// Mock current user — the modal CC's whatever this returns.
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 12,
  }),
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
});
