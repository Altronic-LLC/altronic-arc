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
}));

vi.mock("@azure/msal-react", () => ({
  useIsAuthenticated: () => mocks.isAuthenticated,
  useMsal: () => ({
    accounts: [],
    instance: {
      getActiveAccount: () => ({ homeAccountId: "acct-1" }),
      setActiveAccount: vi.fn(),
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
