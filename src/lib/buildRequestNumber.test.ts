import { describe, it, expect } from "vitest";
import { nextBuildRequestNo } from "./buildRequestNumber";
import type { BuildRequest } from "@/types/task";

function br(brNo: string): BuildRequest {
  return { brNo } as BuildRequest;
}

const NOW = new Date("2026-07-16T12:00:00Z");

describe("nextBuildRequestNo", () => {
  it("seeds a brand-new year at 0001", () => {
    expect(nextBuildRequestNo([], NOW)).toBe("BR_2026-0001");
    expect(nextBuildRequestNo([br("BR_2025-1044")], NOW)).toBe("BR_2026-0001");
  });

  it("returns highest existing + 1 for the current year", () => {
    const existing = [br("BR_2026-1009"), br("BR_2026-1018"), br("BR_2026-0060")];
    expect(nextBuildRequestNo(existing, NOW)).toBe("BR_2026-1019");
  });

  it("zero-pads to 4 digits", () => {
    expect(nextBuildRequestNo([br("BR_2026-0007")], NOW)).toBe("BR_2026-0008");
  });

  it("accepts the hyphen form so mixed data doesn't restart the count", () => {
    expect(nextBuildRequestNo([br("BR-2026-0500")], NOW)).toBe("BR_2026-0501");
  });

  it("ignores other years, blanks, and junk", () => {
    const existing = [br("BR_2024-9999"), br(""), br("not-a-number"), br("BR_2026-0002")];
    expect(nextBuildRequestNo(existing, NOW)).toBe("BR_2026-0003");
  });
});
