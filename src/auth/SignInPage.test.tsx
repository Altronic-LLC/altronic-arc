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

import { SignInPage, isPopupBlocked, signInErrorMessage } from "./SignInPage";

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

// =============================================================================
// A blocked popup is a DEAD LOOP, and the raw message never says so.
//
// Reported 2026-09-23: a normal internal user got `popup_window_error` stacked
// under `AADSTS50076` (MFA required — new location, or a Conditional Access
// change). Microsoft wants MFA, MFA can only be approved in the popup, the
// popup is blocked — so "Sign in again" opens another blocked popup for ever.
//
// ARC signs in with `loginPopup` only and has no redirect fallback (Ray's
// call, 2026-09-23: explain it rather than change the auth flow), so allowing
// popups really is the whole fix and the message has to say how.
// =============================================================================

describe("isPopupBlocked", () => {
  it("recognises the codes MSAL actually reports", () => {
    // Matched on the CODE, not the prose: MSAL's wording mentions IE and has
    // changed between versions, while these codes are stable.
    expect(isPopupBlocked("popup_window_error: Error opening popup window.")).toBe(true);
    expect(isPopupBlocked("empty_window_error: window was closed")).toBe(true);
  });

  it("does not fire on an unrelated failure", () => {
    for (const other of [
      "interaction_in_progress: ...",
      "AADSTS50076: MFA required",
      "user_cancelled: user cancelled the flow",
      "",
    ]) {
      expect(isPopupBlocked(other), other).toBe(false);
    }
  });

  it("is not fooled by the word 'popup' on its own", () => {
    // The old raw message said "if popups are blocked in the browser" for
    // several failures, so a substring match on "popup" would over-fire.
    expect(isPopupBlocked("something failed, popups may be involved")).toBe(false);
  });
});

describe("the popup-blocked message", () => {
  const MSG = signInErrorMessage(
    new Error("popup_window_error: Error opening popup window. This can happen if you are using IE or if popups are blocked in the browser."),
  );

  it("says where the browser control is, not just 'enable popups'", () => {
    // "Enable popups" is not something most people know where to find.
    expect(MSG).toMatch(/address bar/i);
    expect(MSG).toMatch(/allow pop-?ups/i);
  });

  it("offers a way out for a MANAGED browser he cannot change", () => {
    // Satisfying MFA elsewhere first is the only route when policy locks the
    // popup setting — without this the message is a dead end for those users.
    expect(MSG).toMatch(/office\.com/i);
  });

  it("does NOT dump the raw MSAL text", () => {
    expect(MSG).not.toMatch(/popup_window_error/);
    expect(MSG).not.toMatch(/IE/);
  });

  it("still surfaces a stacked AADSTS code when THAT is the only error", () => {
    // The MFA half is genuinely useful on its own — only the popup failure
    // gets rewritten, so a plain 50076 keeps its code for IT to act on.
    expect(signInErrorMessage(new Error("AADSTS50076: MFA required"))).toContain("AADSTS50076");
  });
});

describe("SignInPage — when the account needs attention", () => {
  // A raw AADSTS paragraph repeated across nine dashboard cards told the user
  // nothing (Ray, 2026-08-20). The explanation belongs here, once.
  it("shows the explanation instead of the generic expiry line", () => {
    renderWithProviders(
      <SignInPage
        reason="expired"
        detail="AADSTS50135: Microsoft is asking you to change your password before signing in. Reset your password, then sign in again."
      />,
    );
    expect(screen.getByText(/wouldn't complete the sign-in/i)).toBeInTheDocument();
    expect(screen.getByText(/change your password/i)).toBeInTheDocument();
    expect(screen.queryByText(/expired while the tab was idle/i)).not.toBeInTheDocument();
  });

  it("falls back to the idle-expiry wording when there's no explanation", () => {
    renderWithProviders(<SignInPage reason="expired" />);
    expect(screen.getByText(/expired while the tab was idle/i)).toBeInTheDocument();
  });
});
