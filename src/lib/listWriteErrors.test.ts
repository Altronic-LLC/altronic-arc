import { describe, it, expect } from "vitest";
import {
  describeListWriteFailure,
  isGone,
  isPermissionDenied,
} from "./listWriteErrors";

// =============================================================================
// Hailey Sturtz tried to remove a customer from the Open Orders list and got
// the raw Graph error in a toast (2026-08-25):
//
//   Graph 403 Forbidden at https://graph.microsoft.com/v1.0/sites/…/items/5:
//   {"error":{"code":"accessDenied","message":"Access denied",…}}
//
// Nothing in that tells her what to do, or tells whoever she asks what to
// change. These are the shapes that failure actually arrives in.
// =============================================================================

/** A GraphError as api/graph.ts throws it. */
class FakeGraphError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Graph ${status} Forbidden at https://graph.microsoft.com/v1.0/…: ${body}`);
    this.name = "GraphError";
  }
}

const ACCESS_DENIED = new FakeGraphError(
  403,
  '{"error":{"code":"accessDenied","message":"Access denied"}}',
);
const NOT_FOUND = new FakeGraphError(404, '{"error":{"code":"itemNotFound"}}');

const CTX = { action: "remove that customer", site: "ALTRONICSALESTEAM" };

describe("isPermissionDenied", () => {
  it("recognises the 403 Hailey hit", () => {
    expect(isPermissionDenied(ACCESS_DENIED)).toBe(true);
  });

  // The status is the reliable signal, but the body carries the code even when
  // a wrapper has lost the status.
  it("recognises accessDenied in the body without a status", () => {
    expect(isPermissionDenied(new Error('{"error":{"code":"accessDenied"}}'))).toBe(true);
  });

  it("doesn't claim a 400 or a 500 is a permission problem", () => {
    expect(isPermissionDenied(new FakeGraphError(400, '{"error":{"code":"invalidRequest"}}'))).toBe(
      false,
    );
    expect(isPermissionDenied(new FakeGraphError(500, "server error"))).toBe(false);
  });

  it("copes with something that isn't an Error", () => {
    expect(isPermissionDenied(null)).toBe(false);
    expect(isPermissionDenied("nope")).toBe(false);
  });
});

describe("isGone", () => {
  it("recognises a row that has already been removed", () => {
    expect(isGone(NOT_FOUND)).toBe(true);
  });

  it("doesn't confuse it with a permission failure", () => {
    expect(isGone(ACCESS_DENIED)).toBe(false);
  });
});

describe("describeListWriteFailure", () => {
  it("says what couldn't be done, in words", () => {
    const msg = describeListWriteFailure(ACCESS_DENIED, CTX);
    expect(msg).toContain("remove that customer");
    expect(msg).toContain("ALTRONICSALESTEAM");
  });

  // The raw error named none of this. Whoever Hailey asks needs to know WHICH
  // setting to look at.
  it("names both permission layers, because they're indistinguishable from here", () => {
    const msg = describeListWriteFailure(ACCESS_DENIED, CTX);
    expect(msg).toMatch(/read-only access/i);
    expect(msg).toMatch(/ARC's own access/i);
    expect(msg).toMatch(/ask an admin/i);
  });

  it("never shows the raw Graph URL or JSON on a permission failure", () => {
    const msg = describeListWriteFailure(ACCESS_DENIED, CTX);
    expect(msg).not.toContain("graph.microsoft.com");
    expect(msg).not.toContain("accessDenied");
  });

  // Delete needs more permission than edit, so the way round it is worth
  // saying — it's the difference between blocked and inconvenienced.
  it("offers the alternative when one is given", () => {
    const msg = describeListWriteFailure(ACCESS_DENIED, {
      ...CTX,
      alternative: "You can still edit them and set them to not active.",
    });
    expect(msg).toContain("set them to not active");
  });

  it("explains a row that has already gone, rather than blaming permission", () => {
    const msg = describeListWriteFailure(NOT_FOUND, CTX);
    expect(msg).toMatch(/isn't on the list any more/i);
    expect(msg).not.toMatch(/read-only/i);
  });

  // A wrong explanation is worse than a raw one, so anything unrecognised keeps
  // its real message.
  it("passes an unrecognised failure through instead of inventing a reason", () => {
    const msg = describeListWriteFailure(new Error("network unreachable"), CTX);
    expect(msg).toContain("network unreachable");
    expect(msg).not.toMatch(/read-only/i);
  });

  it("still says something useful for a non-Error", () => {
    expect(describeListWriteFailure(undefined, CTX)).toBe("Couldn't remove that customer.");
  });
});
