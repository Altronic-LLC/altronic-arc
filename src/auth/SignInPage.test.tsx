import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import {
  markSessionExpired,
  resetSessionExpired,
  useSessionExpired,
} from "@/hooks/useSessionExpiry";

const msal = vi.hoisted(() => ({
  loginPopup: vi.fn(),
  setActiveAccount: vi.fn(),
}));

vi.mock("@/auth/AuthProvider", () => ({ getMsalInstance: () => msal }));

vi.mock("@/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/config")>();
  return { ...actual, USE_MOCK: false };
});

import { SignInPage, signInErrorMessage } from "./SignInPage";

const ACCOUNT = { homeAccountId: "acct-1", username: "ray.white@altronic-llc.com" };

beforeEach(() => {
  vi.clearAllMocks();
  resetSessionExpired();
  msal.loginPopup.mockResolvedValue({ account: ACCOUNT });
});

afterEach(() => resetSessionExpired());

function FlagProbe() {
  return <span>flag:{String(useSessionExpired())}</span>;
}

describe("SignInPage — wording", () => {
  it("invites a first sign-in by default", () => {
    renderWithProviders(<SignInPage />);
    expect(screen.getByRole("button", { name: /sign in with microsoft/i })).toBeInTheDocument();
    expect(screen.getByText(/sign in with your altronic-llc email/i)).toBeInTheDocument();
  });

  it("explains what happened when the session expired, without blaming the user", () => {
    renderWithProviders(<SignInPage reason="expired" />);
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing has been lost/i)).toBeInTheDocument();
  });
});

describe("SignInPage — recovering an expired session", () => {
  it("clears the expiry flag and the stale cache, so the app comes back clean", async () => {
    // Without this the app returns still showing the errors every query cached
    // while the token was dead — the "click Retry over and over" complaint.
    markSessionExpired();
    const { queryClient } = renderWithProviders(
      <>
        <SignInPage reason="expired" />
        <FlagProbe />
      </>,
    );
    queryClient.setQueryData(["tasks"], [{ id: 1 }]);
    expect(screen.getByText("flag:true")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /sign in again/i }));

    await waitFor(() => expect(screen.getByText("flag:false")).toBeInTheDocument());
    expect(queryClient.getQueryData(["tasks"])).toBeUndefined();
    expect(msal.setActiveAccount).toHaveBeenCalledWith(ACCOUNT);
  });

  it("keeps the user on this screen, with the reason, when sign-in fails", async () => {
    markSessionExpired();
    msal.loginPopup.mockRejectedValue(new Error("User cancelled the flow."));
    renderWithProviders(
      <>
        <SignInPage reason="expired" />
        <FlagProbe />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: /sign in again/i }));

    await waitFor(() => expect(screen.getByText(/user cancelled the flow/i)).toBeInTheDocument());
    // Still expired — nothing to go back to yet.
    expect(screen.getByText("flag:true")).toBeInTheDocument();
  });

  it("translates MSAL's interaction_in_progress into something actionable", async () => {
    msal.loginPopup.mockRejectedValue(
      new Error("interaction_in_progress: Interaction is currently in progress."),
    );
    renderWithProviders(<SignInPage reason="expired" />);

    await userEvent.click(screen.getByRole("button", { name: /sign in again/i }));

    await waitFor(() =>
      expect(screen.getByText(/reload this page and try again/i)).toBeInTheDocument(),
    );
  });
});

describe("signInErrorMessage", () => {
  it("rewrites the developer-facing interaction_in_progress text", () => {
    expect(signInErrorMessage(new Error("interaction_in_progress: ..."))).toMatch(
      /already open.*reload/i,
    );
  });

  it("passes other MSAL messages through — they're often the useful part", () => {
    expect(signInErrorMessage(new Error("AADSTS50076: MFA required"))).toContain("AADSTS50076");
  });

  it("falls back to plain words for a non-Error throw", () => {
    expect(signInErrorMessage("boom")).toBe("Sign-in was cancelled or failed.");
    expect(signInErrorMessage(new Error(""))).toBe("Sign-in was cancelled or failed.");
  });
});
