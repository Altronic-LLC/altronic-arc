import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BrowserAuthError, InteractionRequiredAuthError } from "@azure/msal-browser";

// =============================================================================
// The re-auth path: what happens when a page-load's worth of queries all find
// the token dead at the same time.
//
// The bug these cover (reported 2026-07-30): MSAL allows ONE interactive request
// at a time. The dashboard fires nine queries; each called acquireTokenPopup
// independently, so one popup opened and the other eight rejected instantly with
// `interaction_in_progress`. Signing in fixed one query and left eight failed,
// so the only way back in was clicking Retry over and over.
// =============================================================================

const msal = vi.hoisted(() => ({
  acquireTokenSilent: vi.fn(),
  acquireTokenPopup: vi.fn(),
  getActiveAccount: vi.fn(),
  getAllAccounts: vi.fn(),
  setActiveAccount: vi.fn(),
}));

vi.mock("@/auth/AuthProvider", () => ({ getMsalInstance: () => msal }));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false };
});

import { graphFetch, resetInteractiveSignIn } from "./graph";

const ACCOUNT = { homeAccountId: "acct-1", username: "ray.white@altronic-llc.com" };

/** A promise plus the handles to settle it later. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function interactionRequired() {
  return new InteractionRequiredAuthError("interaction_required", "Token expired");
}

function interactionInProgress() {
  return new BrowserAuthError(
    "interaction_in_progress",
    "Interaction is currently in progress.",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetInteractiveSignIn();
  msal.getActiveAccount.mockReturnValue(ACCOUNT);
  msal.getAllAccounts.mockReturnValue([ACCOUNT]);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ value: [] }),
      headers: new Headers(),
    }),
  );
});

afterEach(() => {
  resetInteractiveSignIn();
  vi.unstubAllGlobals();
});

describe("concurrent re-auth", () => {
  it("shows ONE popup for many simultaneous expired requests", async () => {
    const popup = deferred<{ accessToken: string; account: typeof ACCOUNT }>();
    // Every silent attempt fails until the interaction completes.
    let signedIn = false;
    msal.acquireTokenSilent.mockImplementation(async () => {
      if (!signedIn) throw interactionRequired();
      return { accessToken: "fresh-token", account: ACCOUNT };
    });
    msal.acquireTokenPopup.mockReturnValue(popup.promise);

    // Nine queries, as on the dashboard.
    const requests = Array.from({ length: 9 }, (_, i) => graphFetch(`/sites/x/lists/${i}/items`));

    // Let them all reach the token layer before the popup resolves.
    await Promise.resolve();
    await Promise.resolve();
    expect(msal.acquireTokenPopup).toHaveBeenCalledTimes(1);

    signedIn = true;
    popup.resolve({ accessToken: "fresh-token", account: ACCOUNT });

    // And all nine recover from that single sign-in — no Retry needed.
    await expect(Promise.all(requests)).resolves.toHaveLength(9);
    expect(msal.acquireTokenPopup).toHaveBeenCalledTimes(1);
    expect(msal.setActiveAccount).toHaveBeenCalledWith(ACCOUNT);
  });

  it("waits for an in-flight prompt instead of failing with interaction_in_progress", async () => {
    // MSAL itself reports this when something else (a mutation, another tab's
    // handler) already has a prompt open. It means "wait", not "give up".
    const popup = deferred<{ accessToken: string; account: typeof ACCOUNT }>();
    let signedIn = false;
    msal.acquireTokenSilent.mockImplementation(async () => {
      if (!signedIn) throw interactionInProgress();
      return { accessToken: "fresh-token", account: ACCOUNT };
    });
    msal.acquireTokenPopup.mockReturnValue(popup.promise);

    const request = graphFetch("/sites/x/lists/1/items");
    await Promise.resolve();
    signedIn = true;
    popup.resolve({ accessToken: "fresh-token", account: ACCOUNT });

    await expect(request).resolves.toEqual({ value: [] });
  });

  it("re-reads the token silently rather than reusing the popup's own result", async () => {
    // The caller that opened the popup may have asked for different scopes than
    // the ones waiting behind it, so the popup's token isn't necessarily theirs.
    let signedIn = false;
    msal.acquireTokenSilent.mockImplementation(async () => {
      if (!signedIn) throw interactionRequired();
      return { accessToken: "silent-token", account: ACCOUNT };
    });
    msal.acquireTokenPopup.mockImplementation(async () => {
      signedIn = true;
      return { accessToken: "popup-token", account: ACCOUNT };
    });

    await graphFetch("/sites/x/lists/1/items");

    const authHeader = (vi.mocked(fetch).mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    expect(authHeader.Authorization).toBe("Bearer silent-token");
  });

  it("fails every waiter as session-expired when the sign-in is cancelled", async () => {
    msal.acquireTokenSilent.mockRejectedValue(interactionRequired());
    msal.acquireTokenPopup.mockRejectedValue(
      new BrowserAuthError("user_cancelled", "User cancelled the flow."),
    );

    const results = await Promise.allSettled([
      graphFetch("/sites/x/lists/1/items"),
      graphFetch("/sites/x/lists/2/items"),
    ]);

    expect(msal.acquireTokenPopup).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason.name).toBe("SessionExpiredError");
    }
  });

  it("allows a fresh prompt on the next failure, once the first has settled", async () => {
    msal.acquireTokenSilent.mockRejectedValue(interactionRequired());
    msal.acquireTokenPopup.mockRejectedValue(
      new BrowserAuthError("user_cancelled", "User cancelled the flow."),
    );

    await expect(graphFetch("/a")).rejects.toThrow();
    await expect(graphFetch("/b")).rejects.toThrow();
    // Not stuck on one abandoned attempt forever.
    expect(msal.acquireTokenPopup).toHaveBeenCalledTimes(2);
  });

  it("reports session-expired when the token still can't be read after signing in", async () => {
    msal.acquireTokenSilent.mockRejectedValue(interactionRequired());
    msal.acquireTokenPopup.mockResolvedValue({ accessToken: "t", account: ACCOUNT });

    await expect(graphFetch("/a")).rejects.toMatchObject({ name: "SessionExpiredError" });
  });

  it("never prompts for a non-default scope — it degrades silently", async () => {
    const { graphFetchScoped } = await import("./graph");
    msal.acquireTokenSilent.mockRejectedValue(interactionRequired());

    await expect(graphFetchScoped("/me/people", ["User.ReadBasic.All"])).rejects.toThrow();
    expect(msal.acquireTokenPopup).not.toHaveBeenCalled();
  });
});
