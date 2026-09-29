import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  BUILD_REQUEST_PART_STATUSES,
  BUILD_REQUEST_STATUSES,
} from "@/types/task";
import {
  BuildRequestStatusBadge,
  PartStatusBadge,
  buildRequestStatusColor,
  partStatusColor,
} from "./buildRequestAtoms";

// =============================================================================
// Every status gets a real colour — the production hand-off (2026-09-29) added
// two request statuses and one part status, and a switch with no case for a
// value returns undefined, which renders an uncoloured (invisible-looking) pill.
// =============================================================================

describe("buildRequestStatusColor", () => {
  it("returns a colour for EVERY request status", () => {
    for (const s of BUILD_REQUEST_STATUSES) {
      expect(buildRequestStatusColor(s), s).toMatch(/^bg-\S+ text-\S+$/);
    }
  });

  it("gives every request status a DISTINCT colour", () => {
    const colours = BUILD_REQUEST_STATUSES.map(buildRequestStatusColor);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it("does not colour the production states like Complete — they are still open", () => {
    const done = buildRequestStatusColor("Complete");
    expect(buildRequestStatusColor("Ready for Production")).not.toBe(done);
    expect(buildRequestStatusColor("Production Complete")).not.toBe(done);
  });
});

describe("partStatusColor", () => {
  it("gives every part status a distinct colour, none of them the muted fallback", () => {
    const fallback = partStatusColor(null);
    const colours = BUILD_REQUEST_PART_STATUSES.map(partStatusColor);
    for (const [i, c] of colours.entries()) {
      expect(c, BUILD_REQUEST_PART_STATUSES[i]).not.toBe(fallback);
    }
    expect(new Set(colours).size).toBe(colours.length);
  });

  it("marks Production Complete as the part's done state (green)", () => {
    expect(partStatusColor("Production Complete")).toContain("cooper-green");
    expect(partStatusColor("Ready for Production")).not.toContain("cooper-green");
  });
});

describe("badges", () => {
  it("render the new status labels", () => {
    render(
      <>
        <BuildRequestStatusBadge status="Ready for Production" />
        <PartStatusBadge status="Production Complete" />
        <PartStatusBadge status={null} />
      </>,
    );
    expect(screen.getByText("Ready for Production")).toBeInTheDocument();
    expect(screen.getByText("Production Complete")).toBeInTheDocument();
    expect(screen.getByText("No status")).toBeInTheDocument();
  });
});
