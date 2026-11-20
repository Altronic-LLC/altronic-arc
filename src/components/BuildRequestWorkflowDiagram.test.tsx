import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  BUILD_REQUEST_FLOW,
  BuildRequestWorkflowDiagram,
  PART_STATUS_FLOW,
  SIDE_STATUSES,
} from "./BuildRequestWorkflowDiagram";
import { BUILD_REQUEST_PART_STATUSES, BUILD_REQUEST_STATUSES } from "@/types/task";
import { BUILD_REQUEST_PRODUCTION_COMPLETE_APPROVERS } from "@/lib/buildRequestProduction";
import {
  PART_IN_PRODUCTION,
  PART_PRODUCTION_COMPLETE,
  PART_READY,
} from "@/lib/buildRequestPartProduction";

const steps = BUILD_REQUEST_FLOW.filter((i) => i.kind === "step");

describe("BuildRequestWorkflowDiagram", () => {
  it("renders every step in order, numbered", () => {
    render(<BuildRequestWorkflowDiagram />);
    const list = screen.getByRole("list", { name: "Build request workflow" });
    const text = list.textContent ?? "";
    let from = 0;
    steps.forEach((s, i) => {
      const at = text.indexOf(s.title, from);
      expect(at, `step "${s.title}" out of order`).toBeGreaterThanOrEqual(from);
      from = at;
      expect(within(list).getByText(String(i + 1))).toBeInTheDocument();
    });
  });

  it("shows both production gates", () => {
    render(<BuildRequestWorkflowDiagram />);
    expect(screen.getAllByText("Unlocks when:")).toHaveLength(2);
  });

  // The diagram describes rules that live elsewhere. These checks fail if
  // those rules move and the drawing doesn't.
  it("only names request and part statuses that exist", () => {
    for (const s of steps) {
      if (s.status) expect(BUILD_REQUEST_STATUSES).toContain(s.status);
    }
    for (const s of SIDE_STATUSES) expect(BUILD_REQUEST_STATUSES).toContain(s);
    for (const s of PART_STATUS_FLOW) expect(BUILD_REQUEST_PART_STATUSES).toContain(s);
  });

  it("puts each gate directly before the step it unlocks", () => {
    const idx = (status: string) => BUILD_REQUEST_FLOW.findIndex((i) => i.kind === "step" && i.status === status);
    expect(BUILD_REQUEST_FLOW[idx("Ready for Production") - 1].kind).toBe("gate");
    expect(BUILD_REQUEST_FLOW[idx("Production Complete") - 1].kind).toBe("gate");
  });

  it("draws a part's buttons in the order the part workflow allows", () => {
    expect(PART_STATUS_FLOW).toEqual([PART_READY, PART_IN_PRODUCTION, PART_PRODUCTION_COMPLETE]);
  });

  it("names the configured Production Complete approver", () => {
    const step = steps.find((s) => s.status === "Production Complete");
    const approver = BUILD_REQUEST_PRODUCTION_COMPLETE_APPROVERS[0].split("@")[0].replace(".", " ");
    expect(step?.who.toLowerCase()).toContain(approver.toLowerCase());
  });
});
