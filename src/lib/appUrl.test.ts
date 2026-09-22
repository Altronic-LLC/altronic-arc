import { describe, it, expect } from "vitest";
import { appItemPath, appItemUrl } from "./appUrl";

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

describe("appItemPath", () => {
  it("is a bare router path — no origin, no deploy sub-path", () => {
    // This is what gets STORED in a mirrored comment's origin banner. An
    // absolute URL there breaks the day ARC moves host or base path.
    expect(appItemPath("buildRequestItem", 7)).toBe("/build-request-item/7");
    expect(appItemPath("task", 47)).toBe("/task/47");
  });

  it("keeps the multi-segment kinds intact", () => {
    expect(appItemPath("ecn", 3)).toBe("/engineering/ecn/3");
  });

  it("agrees with appItemUrl about the segment for a kind", () => {
    // The two must not drift: one is for links people click in the app, the
    // other for links in an email.
    for (const kind of ["task", "buildRequest", "buildRequestItem"] as const) {
      expect(appItemUrl(kind, 5).endsWith(appItemPath(kind, 5))).toBe(true);
    }
  });
});
