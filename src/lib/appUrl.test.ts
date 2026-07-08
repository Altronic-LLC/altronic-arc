import { describe, it, expect } from "vitest";
import { appItemUrl } from "./appUrl";

// BASE_URL under Vitest is "/" (see vite config / jsdom default). window.origin
// in jsdom is "http://localhost:3000" by default.
describe("appItemUrl", () => {
  it("builds a task URL from origin + base + segment + id", () => {
    expect(appItemUrl("task", 42)).toBe(`${window.location.origin}/task/42`);
  });

  it("uses the eir segment for EIRs", () => {
    expect(appItemUrl("eir", 7)).toBe(`${window.location.origin}/eir/7`);
  });
});
