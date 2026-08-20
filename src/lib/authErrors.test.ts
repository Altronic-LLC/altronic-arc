import { describe, it, expect } from "vitest";
import {
  authErrorLine,
  describeAuthError,
  extractAadstsCode,
  isReauthenticable,
} from "./authErrors";

// Real text, copied from what a user actually saw (Ray, 2026-08-20) — nine
// dashboard cards each showing this, none of them saying "change your
// password".
const RISK_ERROR =
  "invalid_request: Error(s): 50135 - Timestamp: 2026-08-20 12:38:13Z - " +
  "Description: AADSTS50135: Password change is required due to account risk. " +
  "Trace ID: 2d4a6ba1-aff6-4715-a845-9468e850d000 Correlation ID: " +
  "01a01f2d-d718-7086-a744-6a3b537d8e51";

describe("extractAadstsCode", () => {
  it("finds the code in the AADSTS form", () => {
    expect(extractAadstsCode(RISK_ERROR)).toBe("50135");
  });

  it("finds it in the bare Error(s) form", () => {
    expect(extractAadstsCode("invalid_request: Error(s): 50055 - Timestamp: …")).toBe("50055");
  });

  it("returns null when there isn't one", () => {
    expect(extractAadstsCode("Failed to fetch")).toBeNull();
    expect(extractAadstsCode("")).toBeNull();
  });
});

describe("describeAuthError", () => {
  it("explains the account-risk password change, and flags it as security", () => {
    const described = describeAuthError(new Error(RISK_ERROR));
    expect(described?.code).toBe("50135");
    expect(described?.summary).toMatch(/change your password/i);
    expect(described?.action).toMatch(/InfoSec/i);
    expect(described?.security).toBe(true);
  });

  it("explains an expired password", () => {
    const described = describeAuthError(new Error("AADSTS50055: password expired"));
    expect(described?.summary).toMatch(/expired/i);
    expect(described?.security).toBeUndefined();
  });

  it("takes a bare string as well as an Error", () => {
    expect(describeAuthError(RISK_ERROR)?.code).toBe("50135");
  });

  // Deliberately narrow: several AADSTS codes are normal silent-auth outcomes
  // the app already handles by degrading, and turning those into a sign-in
  // screen would be worse than the problem.
  it("says nothing about codes it doesn't know", () => {
    expect(describeAuthError(new Error("AADSTS50058: silent sign-in failed"))).toBeNull();
    expect(describeAuthError(new Error("AADSTS99999: something new"))).toBeNull();
  });

  it("says nothing about ordinary errors", () => {
    expect(describeAuthError(new Error("Failed to fetch"))).toBeNull();
    expect(describeAuthError(null)).toBeNull();
    expect(describeAuthError(undefined)).toBeNull();
  });
});

describe("authErrorLine", () => {
  it("reads as one sentence with the code kept for IT", () => {
    const line = authErrorLine(describeAuthError(RISK_ERROR)!);
    expect(line).toMatch(/^AADSTS50135:/);
    expect(line).toMatch(/change your password/i);
  });
});

// The SharePoint attachments card blamed a missing admin grant for every
// failure, including this one — which is the reader's own session, and theirs
// to fix (Ray, 2026-08-20).
const MFA_EXPIRED =
  "Silent token acquisition failed: invalid_grant: AADSTS50078: Presented " +
  "multi-factor authentication has expired due to policies configured by your " +
  "administrator, you must refresh your multi-factor authentication to access " +
  "'00000003-0000-0ff1-ce00-000000000000'.";

describe("MFA expiry", () => {
  it("explains it as the session, not a permission", () => {
    const described = describeAuthError(MFA_EXPIRED);
    expect(described?.code).toBe("50078");
    expect(described?.summary).toMatch(/multi-factor authentication has expired/i);
    expect(described?.action).toMatch(/sign in again/i);
  });

  it("is something the person can fix themselves", () => {
    expect(isReauthenticable(MFA_EXPIRED)).toBe(true);
    expect(isReauthenticable(new Error("AADSTS50076: MFA required"))).toBe(true);
    expect(isReauthenticable(new Error("AADSTS50055: password expired"))).toBe(true);
  });

  // A disabled account or a blocked-by-policy sign-in genuinely needs someone
  // else, so they must NOT get a "sign in again" button.
  it("is not, when only an admin can help", () => {
    expect(isReauthenticable(new Error("AADSTS50057: account disabled"))).toBe(false);
    expect(isReauthenticable(new Error("AADSTS53003: blocked by policy"))).toBe(false);
    expect(isReauthenticable(new Error("Failed to fetch"))).toBe(false);
  });
});
