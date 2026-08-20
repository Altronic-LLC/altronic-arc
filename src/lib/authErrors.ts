// =============================================================================
// Sign-in errors that mean "go and fix your account", said in plain English.
//
// Microsoft returns these as AADSTS codes buried in a paragraph of trace and
// correlation IDs. Some of them aren't token problems the app can retry — they
// mean the user has to do something with their account before ANY request will
// work. When one of those arrives, ARC currently shows it nine times over, once
// per dashboard card, raw:
//
//   "Engineering Tasks: invalid_request: Error(s): 50135 - Timestamp:
//    2026-08-20 12:38:13Z - Description: AADSTS50135: Password change is
//    required due to account risk. Trace ID: … Correlation ID: …"
//
// Nothing in that tells the reader they need to change their password, and the
// nine Retry buttons all fail the same way (Ray, 2026-08-20).
//
// This maps the small set of codes that mean "your account needs attention" to
// a sentence and a next step. Everything else is deliberately left alone —
// several AADSTS codes are normal silent-auth outcomes the app already handles
// by degrading, and swallowing those into a sign-in screen would be worse than
// the problem.
// =============================================================================

export interface AuthActionRequired {
  /** The AADSTS number, kept so IT can be told exactly what came back. */
  code: string;
  /** What happened, in the user's terms. */
  summary: string;
  /** What they should do about it. */
  action: string;
  /** True when the cause is worth reporting, not just fixing. */
  security?: boolean;
}

const ACCOUNT_ACTIONS: Record<string, Omit<AuthActionRequired, "code">> = {
  "50135": {
    summary: "Microsoft is asking you to change your password before signing in.",
    action:
      "Reset your password through your Microsoft account, then sign in again. " +
      "This one is raised when the account is flagged as at risk, so please also " +
      "let IT and InfoSec know.",
    security: true,
  },
  "50055": {
    summary: "Your password has expired.",
    action: "Set a new password through your Microsoft account, then sign in again.",
  },
  "50144": {
    summary: "Your Windows password has expired.",
    action: "Change it the usual way (Ctrl+Alt+Del → Change a password), then sign in again.",
  },
  "50057": {
    summary: "This account is disabled.",
    action: "Contact the IT service desk — nothing can be done from ARC.",
  },
  "53003": {
    summary: "A security policy blocked the sign-in.",
    action:
      "Often the device, network or location you're on. Try the corporate network " +
      "or VPN; if it keeps happening, contact the IT service desk.",
  },
  "50078": {
    summary: "Your multi-factor authentication has expired for this resource.",
    action: "Sign in again and approve the prompt on your phone.",
  },
  "50072": {
    summary: "You need to enrol in multi-factor authentication before continuing.",
    action: "Sign in again and follow the enrolment steps Microsoft shows you.",
  },
  "50074": {
    summary: "Multi-factor authentication is needed to continue.",
    action: "Sign in again and approve the prompt on your phone.",
  },
  "50076": {
    summary: "Multi-factor authentication is needed to continue.",
    action: "Sign in again and approve the prompt on your phone.",
  },
  "50079": {
    summary: "You need to finish setting up multi-factor authentication.",
    action: "Sign in again and follow the enrolment steps Microsoft shows you.",
  },
};

/** Pull the first AADSTS code out of an error message, if there is one. */
export function extractAadstsCode(message: string): string | null {
  const match = /AADSTS(\d{4,6})/i.exec(message) ?? /Error\(s\):\s*(\d{4,6})/i.exec(message);
  return match ? match[1] : null;
}

/**
 * Describe an error IF it's one the user has to act on. Returns null for
 * everything else — including ordinary token expiry, which the app already
 * recovers from by prompting a fresh sign-in.
 */
export function describeAuthError(err: unknown): AuthActionRequired | null {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!message) return null;
  const code = extractAadstsCode(message);
  if (!code) return null;
  const known = ACCOUNT_ACTIONS[code];
  if (!known) return null;
  return { code, ...known };
}

/**
 * True when the failure is the user's session rather than the app's
 * permissions — MFA expired, MFA needed, password expired.
 *
 * The distinction matters wherever the app currently blames a missing admin
 * grant: "ask an admin" is useless advice for something the person can fix by
 * signing in again.
 */
export function isReauthenticable(err: unknown): boolean {
  const code = describeAuthError(err)?.code;
  return code ? ["50078", "50072", "50074", "50076", "50079", "50055", "50144"].includes(code) : false;
}

/** One line for a toast or a log — "AADSTS50135: your password has expired." */
export function authErrorLine(described: AuthActionRequired): string {
  return `AADSTS${described.code}: ${described.summary} ${described.action}`;
}
