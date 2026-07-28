import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { markSessionExpired, resetSessionExpired } from "@/hooks/useSessionExpiry";

const mocks = vi.hoisted(() => ({
  loginPopup: vi.fn(),
  setActiveAccount: vi.fn(),
}));

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({
    accounts: [],
    instance: {
      loginPopup: mocks.loginPopup,
      setActiveAccount: mocks.setActiveAccount,
    },
  }),
}));

import { SessionExpiredBanner } from "./SessionExpiredBanner";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loginPopup.mockResolvedValue({ account: { homeAccountId: "acct-1" } });
  resetSessionExpired();
});

afterEach(() => {
  resetSessionExpired();
});

describe("SessionExpiredBanner", () => {
  it("renders nothing while the session is healthy", () => {
    const { container } = renderWithProviders(<SessionExpiredBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("appears once a request reports the session expired", () => {
    renderWithProviders(<SessionExpiredBanner />);
    act(() => markSessionExpired());
    expect(screen.getByText(/your microsoft sign-in has expired/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeInTheDocument();
  });

  it("re-auths, clears the flag, and refetches queries when 'Sign in again' is clicked", async () => {
    const { queryClient } = renderWithProviders(<SessionExpiredBanner />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    act(() => markSessionExpired());
    await userEvent.click(screen.getByRole("button", { name: /sign in again/i }));

    expect(mocks.loginPopup).toHaveBeenCalledTimes(1);
    expect(mocks.setActiveAccount).toHaveBeenCalledWith({ homeAccountId: "acct-1" });
    expect(invalidate).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText(/your microsoft sign-in has expired/i)).not.toBeInTheDocument(),
    );
  });

  it("shows the reason and stays put when the re-auth fails", async () => {
    mocks.loginPopup.mockRejectedValue(new Error("user_cancelled"));
    renderWithProviders(<SessionExpiredBanner />);

    act(() => markSessionExpired());
    await userEvent.click(screen.getByRole("button", { name: /sign in again/i }));

    expect(await screen.findByText(/user_cancelled/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeInTheDocument();
  });

  it("can be dismissed", async () => {
    renderWithProviders(<SessionExpiredBanner />);
    act(() => markSessionExpired());

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(/your microsoft sign-in has expired/i)).not.toBeInTheDocument();
  });
});
