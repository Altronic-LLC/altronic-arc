import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  SCN_CLOSED_STATUSES,
  ScnApprovalChip,
  ScnCategoryChip,
  ScnStatusChip,
  isOpenScn,
} from "./scnAtoms";
import { SCN_STATUSES } from "@/types/task";

describe("isOpenScn", () => {
  it("counts CLOSED and Cancelled as finished, everything else as live", () => {
    expect(isOpenScn("CLOSED")).toBe(false);
    expect(isOpenScn("Cancelled")).toBe(false);
    for (const status of SCN_STATUSES.filter((s) => !SCN_CLOSED_STATUSES.includes(s))) {
      expect(isOpenScn(status), status).toBe(true);
    }
  });

  it("treats a blank status on an old row as live — nobody has finished it", () => {
    expect(isOpenScn("")).toBe(true);
  });
});

describe("ScnStatusChip", () => {
  it("shows the status text", () => {
    render(<ScnStatusChip status="LTB in process" />);
    expect(screen.getByText("LTB in process")).toBeInTheDocument();
  });

  it("mutes CLOSED and Cancelled, and gives each live state its own colour", () => {
    const { rerender } = render(<ScnStatusChip status="CLOSED" />);
    expect(screen.getByText("CLOSED").className).toContain("text-fg-muted");
    rerender(<ScnStatusChip status="Cancelled" />);
    expect(screen.getByText("Cancelled").className).toContain("text-fg-muted");

    const classes = new Set<string>();
    for (const status of ["WIP", "LTB in process", "Customer Phase Out", "On Hold"]) {
      rerender(<ScnStatusChip status={status} />);
      const className = screen.getByText(status).className;
      expect(className).not.toContain("text-fg-muted");
      classes.add(className);
    }
    // Four live states, four distinct treatments.
    expect(classes.size).toBe(4);
  });

  it("says Not set for a blank", () => {
    render(<ScnStatusChip status="" />);
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });
});

describe("ScnCategoryChip", () => {
  it("shows the category, or a dash for none", () => {
    const { rerender } = render(<ScnCategoryChip category="OBS" />);
    expect(screen.getByText("OBS")).toBeInTheDocument();
    rerender(<ScnCategoryChip category="" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("ScnApprovalChip", () => {
  it("is green for Approved and red for Denied", () => {
    const { rerender } = render(<ScnApprovalChip approvalStatus="Approved" />);
    expect(screen.getByText("Approved").className).toContain("cooper-green");
    rerender(<ScnApprovalChip approvalStatus="Denied" />);
    expect(screen.getByText("Denied").className).toContain("cooper-red");
  });

  it("shows a dash when nothing is recorded", () => {
    render(<ScnApprovalChip approvalStatus="" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
