import { describe, it, expect } from "vitest";
import { LOADING_FACTS } from "./loadingFacts";

describe("LOADING_FACTS", () => {
  it("has more than a couple of facts, so a long session doesn't loop obviously", () => {
    expect(LOADING_FACTS.length).toBeGreaterThan(5);
  });

  it("has no duplicates", () => {
    expect(new Set(LOADING_FACTS).size).toBe(LOADING_FACTS.length);
  });

  it("has no blank entries", () => {
    for (const fact of LOADING_FACTS) {
      expect(fact.trim().length).toBeGreaterThan(0);
    }
  });

  // Rendered in a fixed-width column under the spinner — a very long fact
  // would wrap awkwardly across many lines and dominate the loading screen.
  it("keeps every fact to a readable length", () => {
    for (const fact of LOADING_FACTS) {
      expect(fact.length).toBeLessThan(260);
    }
  });

  it("mentions Claude and how the app is built", () => {
    expect(LOADING_FACTS.some((f) => /claude/i.test(f))).toBe(true);
    expect(LOADING_FACTS.some((f) => /vibe coding/i.test(f))).toBe(true);
  });
});
