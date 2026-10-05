import { describe, expect, it } from "vitest";
import { CHANGELOG } from "./changelog";

// The Parts List shipped hidden behind a switch, with v0.168.0's notes held
// back until go-live. It's live now and the switch is gone, so the notes are a
// plain entry like any other.
describe("v0.168.0 in the history", () => {
  const entry = CHANGELOG.find((e) => e.version === "0.168.0")!;

  it("lists the Parts List's features", () => {
    expect(entry.changes.length).toBeGreaterThan(10);
    expect(entry.changes[0]).toMatch(/^New Parts List under Engineering/);
  });

  it("no longer says the Parts List is coming soon", () => {
    expect(entry.changes.some((c) => /coming soon/i.test(c))).toBe(false);
  });
});
