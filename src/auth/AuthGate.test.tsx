import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { act } from "@testing-library/react";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { markSessionExpired, resetSessionExpired } from "@/hooks/useSessionExpiry";

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
  it("hides the app, shows a 'signing you out' message, and calls logoutRedirect once the session is marked expired", async () => {
    renderWithProviders(
      <AuthGate>
        <div>App content</div>
      </AuthGate>,
    );

    act(() => markSessionExpired());

    expect(screen.queryByText("App content")).not.toBeInTheDocument();
    expect(screen.getByText(/your session has expired/i)).toBeInTheDocument();
    expect(mocks.logoutRedirect as Mock).toHaveBeenCalledTimes(1);
  });

  it("goes back to rendering children after resetSessionExpired (e.g. a fresh sign-in)", () => {
    renderWithProviders(
      <AuthGate>
        <div>App content</div>
      </AuthGate>,
    );

    act(() => markSessionExpired());
    expect(screen.queryByText("App content")).not.toBeInTheDocument();

    act(() => resetSessionExpired());
    expect(screen.getByText("App content")).toBeInTheDocument();
  });
});
