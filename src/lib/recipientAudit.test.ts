import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import { auditRecipientList, suggestionsFor } from "./recipientAudit";

// =============================================================================
// Glenn Terry didn't receive an alert Ray received from the same send
// (2026-08-25). Same list, same loop — so what nobody could check was whether
// the ADDRESS was real. Graph accepts a message for a mailbox that doesn't
// exist and bounces it to the shared mailbox nobody reads.
// =============================================================================

const DIRECTORY: Person[] = [
  { displayName: "Sheila Horn", email: "sheila.horn@altronic-llc.com" },
  { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
  { displayName: "Terry, Glenn", email: "glenn.terry@hoerbiger.com" },
  { displayName: "No Mailbox Service Account" },
];

const audit = (configured: string | undefined) =>
  auditRecipientList("EIR — assign an engineer", "VITE_EIR_TRIAGE_ASSIGNERS", configured, DIRECTORY);

describe("auditRecipientList", () => {
  it("passes an address that has a mailbox", () => {
    const result = audit("Sheila Horn <sheila.horn@altronic-llc.com>");
    expect(result.recipients[0].status).toBe("matched");
    expect(result.ok).toBe(true);
  });

  // THE POINT OF THE WHOLE FILE. `sameEmail` in emailIdentity.ts falls back to
  // comparing the local part, so it would call glenn.terry@altronic-llc.com a
  // match for glenn.terry@hoerbiger.com — correct for greying out a field,
  // and exactly wrong here, where a mistyped domain is the likeliest fault.
  it("does NOT treat a wrong domain as a match", () => {
    const result = audit("Glenn Terry <glenn.terry@altronic-llc.com>");
    expect(result.recipients[0].status).toBe("not-in-directory");
    expect(result.ok).toBe(false);
  });

  it("flags an entry that isn't an address at all", () => {
    const result = audit("Glenn Terry");
    expect(result.recipients[0].status).toBe("not-an-email");
    expect(result.ok).toBe(false);
  });

  it("reads a whole comma-separated list", () => {
    const result = audit(
      "sheila.horn@altronic-llc.com, Glenn Terry <glenn.terry@altronic-llc.com>, ray.white@altronic-llc.com",
    );
    expect(result.recipients.map((r) => r.status)).toEqual([
      "matched",
      "not-in-directory",
      "matched",
    ]);
    expect(result.ok).toBe(false);
  });

  it("takes a bare address, as the mailer does", () => {
    expect(audit("ray.white@altronic-llc.com").recipients[0].status).toBe("matched");
  });

  // An unconfigured list reaches nobody, which is a problem in its own right —
  // it must not read as healthy.
  it("is not ok when nothing is configured", () => {
    expect(audit(undefined).ok).toBe(false);
    expect(audit("").recipients).toEqual([]);
    expect(audit("   ,  ").recipients).toEqual([]);
  });

  it("reports the directory's own name for a match, not the configured one", () => {
    const result = audit("Glenn <glenn.terry@hoerbiger.com>");
    expect(result.recipients[0].matched?.displayName).toBe("Terry, Glenn");
  });

  it("keeps the env var so the screen can say how to fix it", () => {
    expect(audit("x@y.com").envVar).toBe("VITE_EIR_TRIAGE_ASSIGNERS");
  });
});

describe("suggestionsFor", () => {
  // The useful thing to show beside a bad address: the real one.
  it("finds the same person on another domain", () => {
    const bad = audit("Glenn Terry <glenn.terry@altronic-llc.com>").recipients[0];
    expect(suggestionsFor(bad, DIRECTORY).map((p) => p.email)).toEqual([
      "glenn.terry@hoerbiger.com",
    ]);
  });

  // Entra writes names both ways round; "Glenn Terry" must find "Terry, Glenn".
  it("matches a display name whatever order it's written in", () => {
    const bad = audit("Glenn Terry <g.terry@altronic-llc.com>").recipients[0];
    expect(suggestionsFor(bad, DIRECTORY).map((p) => p.email)).toContain(
      "glenn.terry@hoerbiger.com",
    );
  });

  it("suggests nothing for an address that already matched", () => {
    const good = audit("ray.white@altronic-llc.com").recipients[0];
    expect(suggestionsFor(good, DIRECTORY)).toEqual([]);
  });

  it("suggests nothing when there's no plausible candidate", () => {
    const bad = audit("Someone Unknown <someone.unknown@altronic-llc.com>").recipients[0];
    expect(suggestionsFor(bad, DIRECTORY)).toEqual([]);
  });
});
