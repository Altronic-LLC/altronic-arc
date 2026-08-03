import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GraphError } from "./graph";
import {
  describeFailure,
  isSendAsDenied,
  reportSendFailures,
  type MailSendResult,
} from "./email";

// =============================================================================
// A notification that doesn't go out has to say so.
//
// Send-As on the shared mailbox is granted PER USER in Exchange, so a person who
// hasn't been added silently notifies nobody: the comment saves, the mention chip
// is there, and the recipient never hears. Both looked identical before, which is
// how someone stays un-added indefinitely (Ray, 2026-08-03).
// =============================================================================

const toasts = vi.hoisted(() => ({ pushed: [] as Array<Record<string, unknown>> }));

vi.mock("@/components/Toast", () => ({
  pushToast: (input: Record<string, unknown>) => {
    toasts.pushed.push(input);
    return "toast-id";
  },
}));

function graph403() {
  return new GraphError(
    403,
    "Forbidden",
    '{"error":{"code":"ErrorAccessDenied","message":"Access is denied. Check credentials and try again."}}',
    "https://graph.microsoft.com/v1.0/users/automation@altronic-llc.com/sendMail",
  );
}

beforeEach(() => {
  toasts.pushed = [];
});

afterEach(() => vi.clearAllMocks());

describe("isSendAsDenied", () => {
  it("recognises the 403 Exchange returns when Send-As isn't granted", () => {
    expect(isSendAsDenied(graph403())).toBe(true);
  });

  it("treats 401 the same — the advice is still 'someone check access'", () => {
    expect(isSendAsDenied(new GraphError(401, "Unauthorized", "{}", "u"))).toBe(true);
  });

  it("reads the body when the status alone doesn't say it", () => {
    const err = new GraphError(500, "Server Error", '{"code":"ErrorAccessDenied"}', "u");
    expect(isSendAsDenied(err)).toBe(true);
  });

  it("does NOT claim a permission problem for throttling or a bad address", () => {
    // Granting access wouldn't fix either, so calling them permission failures
    // would send someone to IT for nothing.
    expect(isSendAsDenied(new GraphError(429, "Too Many Requests", "{}", "u"))).toBe(false);
    expect(isSendAsDenied(new GraphError(400, "Bad Request", '{"code":"ErrorInvalidRecipients"}', "u"))).toBe(false);
    expect(isSendAsDenied(new Error("Failed to fetch"))).toBe(false);
    expect(isSendAsDenied("something odd")).toBe(false);
  });
});

describe("describeFailure", () => {
  it("classifies a denied send as a permission problem and keeps the reason", () => {
    const f = describeFailure("mike.smith@altronic-llc.com", graph403());
    expect(f.kind).toBe("permission");
    expect(f.email).toBe("mike.smith@altronic-llc.com");
    expect(f.reason).toContain("403");
  });

  it("classifies anything else as other", () => {
    expect(describeFailure("a@b.com", new Error("network down")).kind).toBe("other");
  });
});

describe("reportSendFailures", () => {
  const ok: MailSendResult = { sent: ["a@b.com"], failed: [] };

  it("says nothing when everything sent", () => {
    reportSendFailures(ok, "comment");
    expect(toasts.pushed).toHaveLength(0);
  });

  it("names who was NOT notified, and the grant that fixes it", () => {
    reportSendFailures(
      { sent: [], failed: [describeFailure("mike.smith@altronic-llc.com", graph403())] },
      "comment",
    );
    expect(toasts.pushed).toHaveLength(1);
    const msg = String(toasts.pushed[0].message);
    // Leads with the comment being safe — otherwise people retype it.
    expect(msg).toMatch(/comment saved/i);
    expect(msg).toMatch(/don't have access/i);
    expect(msg).toContain("mike.smith@altronic-llc.com");
    expect(msg).toMatch(/not notified/i);
    // The actionable part: this message has to travel to whoever can fix it.
    expect(msg).toMatch(/send as/i);
    expect(toasts.pushed[0].variant).toBe("error");
  });

  it("stays up long enough to read and act on", () => {
    reportSendFailures({ sent: [], failed: [describeFailure("a@b.com", graph403())] }, "comment");
    expect(Number(toasts.pushed[0].durationMs)).toBeGreaterThanOrEqual(15_000);
  });

  it("lists every unnotified person, not just the first", () => {
    reportSendFailures(
      {
        sent: [],
        failed: [
          describeFailure("one@altronic-llc.com", graph403()),
          describeFailure("two@altronic-llc.com", graph403()),
        ],
      },
      "comment",
    );
    const msg = String(toasts.pushed[0].message);
    expect(msg).toContain("one@altronic-llc.com");
    expect(msg).toContain("two@altronic-llc.com");
    expect(msg).toMatch(/were NOT notified/);
  });

  it("keeps a permission problem separate from an ordinary failure", () => {
    // Two different actions: one needs an admin, the other needs a retry.
    reportSendFailures(
      {
        sent: [],
        failed: [
          describeFailure("denied@altronic-llc.com", graph403()),
          describeFailure("broken@altronic-llc.com", new Error("network down")),
        ],
      },
      "comment",
    );
    expect(toasts.pushed).toHaveLength(2);
    expect(String(toasts.pushed[0].message)).toMatch(/send as/i);
    expect(String(toasts.pushed[1].message)).toContain("network down");
    expect(String(toasts.pushed[1].message)).not.toMatch(/send as/i);
  });

  it("says 'change saved' for a change alert rather than 'comment'", () => {
    reportSendFailures({ sent: [], failed: [describeFailure("a@b.com", graph403())] }, "change");
    expect(String(toasts.pushed[0].message)).toMatch(/change saved/i);
  });

  it("still reports when some sends succeeded and one didn't", () => {
    reportSendFailures(
      { sent: ["fine@b.com"], failed: [describeFailure("denied@b.com", graph403())] },
      "comment",
    );
    expect(toasts.pushed).toHaveLength(1);
    expect(String(toasts.pushed[0].message)).toContain("denied@b.com");
    expect(String(toasts.pushed[0].message)).not.toContain("fine@b.com");
  });
});
