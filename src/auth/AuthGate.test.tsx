import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import {
  markSessionExpired,
  resetSessionExpired,
  useSessionExpired,
} from "@/hooks/useSessionExpiry";

const mocks = vi.hoisted(() => ({
  isAuthenticated: true,
  logoutRedirect: vi.fn(),
  accounts: [] as Array<{ homeAccountId: string }>,
  activeAccount: { homeAccountId: "acct-1" } as { homeAccountId: string } | null,
  setActiveAccount: vi.fn(),
}));

vi.mock("@azure/msal-react", () => ({
  useIsAuthenticated: () => mocks.isAuthenticated,
  useMsal: () => ({
    accounts: mocks.accounts,
    instance: {
      getActiveAccount: () => mocks.activeAccount,
      setActiveAccount: mocks.setActiveAccount,
      logoutRedirect: mocks.logoutRedirect,
    },
  }),
}));

vi.mock("@/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/config")>();
  return { ...actual, USE_MOCK: false };
});

import { AuthGate } from "./AuthGate";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAuthenticated = true;
  mocks.accounts = [];
  mocks.activeAccount = { homeAccountId: "acct-1" };
  resetSessionExpired();
});

afterEach(() => {
  resetSessionExpired();
});

describe("AuthGate — real mode, healthy session", () => {
  it("renders children when authenticated and no session-expiry flag is set", () => {
    renderWithProviders(
      <AuthGate>
        <div>App content</div>
      </AuthGate>,
    );
    expect(screen.getByText("App content")).toBeInTheDocument();
    expect(mocks.logoutRedirect).not.toHaveBeenCalled();
  });

  it("shows the sign-in page when not authenticated", () => {
    mocks.isAuthenticated = false;
    renderWithProviders(
      <AuthGate>
        <div>App content</div>
      </AuthGate>,
    );
    expect(screen.queryByText("App content")).not.toBeInTheDocument();
    expect(screen.getByText(/sign in with microsoft/i)).toBeInTheDocument();
  });
});

describe("AuthGate — session expiry", () => {
  it("shows the sign-in screen — not the app behind an error banner", () => {
    renderWithProviders(
      <AuthGate>
        <div>App content</div>
      </AuthGate>,
    );

    act(() => markSessionExpired());

    // A banner over a half-loaded page left every failed query failed, so the
    // page underneath was a wall of red and the way back in was repeated Retry
    // clicks. The sign-in screen is the one thing that actually fixes it.
    expect(screen.queryByText("App content")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeInTheDocument();
    expect(screen.getByText(/expired while the tab was idle/i)).toBeInTheDocument();
  });

  it("never signs the user out on its own — re-auth stays a click, not a redirect", () => {
    // An automatic logoutRedirect here used to bounce users between the
    // sign-out redirect and the sign-in page instead of ever loading the app.
    renderWithProviders(
      <AuthGate>
        <div>App content</div>
      </AuthGate>,
    );
    act(() => markSessionExpired());
    expect(mocks.logoutRedirect).not.toHaveBeenCalled();
  });

  it("clears a lingering expiry flag when it's showing the sign-in page, so a fresh sign-in starts clean", () => {
    mocks.isAuthenticated = false;
    act(() => markSessionExpired());

    function FlagProbe() {
      return <span>flag:{String(useSessionExpired())}</span>;
    }

    renderWithProviders(
      <>
        <AuthGate>
          <div>App content</div>
        </AuthGate>
        <FlagProbe />
      </>,
    );

    expect(screen.getByText(/sign in with microsoft/i)).toBeInTheDocument();
    expect(screen.getByText("flag:false")).toBeInTheDocument();
  });
});

describe("AuthGate — auto-activating a cached account", () => {
  // Reported by Ray, 2026-09-02: on a shared browser, MSAL's localStorage
  // cache held a second person's account from an earlier session. AuthGate
  // used to activate `accounts[0]` unconditionally, so a NEW person opening
  // ARC on that same browser was silently signed in as whoever was cached
  // first — no prompt, nothing wrong-looking, but every write went out under
  // the wrong name (a Gray Market Request's Requestor, in the report).
  it("activates the ONE cached account automatically — the harmless, expected case", () => {
    mocks.activeAccount = null;
    mocks.accounts = [{ homeAccountId: "acct-1" }];

    renderWithProviders(
      <AuthGate>
        <div>App content</div>
      </AuthGate>,
    );

    expect(mocks.setActiveAccount).toHaveBeenCalledWith({ homeAccountId: "acct-1" });
  });

  it("does NOT auto-pick a cached account when MORE THAN ONE is cached", () => {
    mocks.activeAccount = null;
    mocks.accounts = [{ homeAccountId: "acct-1" }, { homeAccountId: "acct-2" }];

    renderWithProviders(
      <AuthGate>
        <div>App content</div>
      </AuthGate>,
    );

    // Never guesses which of the two belongs to whoever's actually here.
    expect(mocks.setActiveAccount).not.toHaveBeenCalled();
  });

  it("leaves an already-active account alone even with others cached", () => {
    mocks.activeAccount = { homeAccountId: "acct-1" };
    mocks.accounts = [{ homeAccountId: "acct-1" }, { homeAccountId: "acct-2" }];

    renderWithProviders(
      <AuthGate>
        <div>App content</div>
      </AuthGate>,
    );

    expect(mocks.setActiveAccount).not.toHaveBeenCalled();
  });
});
