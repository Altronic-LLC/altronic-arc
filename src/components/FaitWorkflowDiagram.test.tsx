import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FAIT_FLOW, FaitWorkflowDiagram } from "./FaitWorkflowDiagram";
import { FAIT_STATUSES } from "@/lib/faitFields";
import {
  FAIT_STATUS_WITH_ENG,
  FAIT_STATUS_WITH_KAM,
  FAIT_STATUS_WITH_SQE,
} from "@/lib/faitSignOff";
import { FAIT_NEW_ALERTS, FAIT_SQE_REVIEWERS } from "@/api/config";
import { parseRecipientList } from "@/lib/recipientList";
import type { WorkflowStep } from "./WorkflowDiagram";

const steps = FAIT_FLOW.filter((i): i is WorkflowStep => i.kind === "step");
const idx = (title: string) => FAIT_FLOW.findIndex((i) => i.kind === "step" && i.title === title);

describe("FaitWorkflowDiagram", () => {
  it("renders every step in order, numbered", () => {
    render(<FaitWorkflowDiagram />);
    const list = screen.getByRole("list", { name: "FAIT workflow" });
    const text = list.textContent ?? "";
    let from = 0;
    steps.forEach((s, i) => {
      const at = text.indexOf(s.title, from);
      expect(at, `step "${s.title}" out of order`).toBeGreaterThanOrEqual(from);
      from = at;
      expect(within(list).getByText(String(i + 1))).toBeInTheDocument();
    });
  });

  // The diagram describes rules that live elsewhere. These checks fail if
  // those rules move and the drawing doesn't.
  it("only names FAIT statuses that exist", () => {
    for (const s of steps) if (s.status) expect(FAIT_STATUSES).toContain(s.status);
  });

  it("draws the sign-off chain in the order the status advances", () => {
    const order = [FAIT_STATUS_WITH_SQE, FAIT_STATUS_WITH_ENG, FAIT_STATUS_WITH_KAM].map((s) =>
      FAIT_FLOW.findIndex((i) => i.kind === "step" && i.status === s),
    );
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("gates the KAM step on OEM Impact, and closing on every sign-off", () => {
    expect(FAIT_FLOW[idx("KAM sign-off") - 1].kind).toBe("gate");
    expect(FAIT_FLOW[idx("Close it with Notify Initiator") - 1].kind).toBe("gate");
  });

  it("shows the Failed SQE path going back to the initiator", () => {
    render(<FaitWorkflowDiagram />);
    expect(screen.getByText("If SQE Sign Off is Failed:")).toBeInTheDocument();
  });

  it("names the configured intake and SQE lists", () => {
    const raise = steps.find((s) => s.title === "Raise the FAIT");
    for (const p of parseRecipientList(FAIT_NEW_ALERTS)) expect(raise?.emails).toContain(p.displayName);
    const sqe = steps.find((s) => s.status === FAIT_STATUS_WITH_SQE);
    for (const p of parseRecipientList(FAIT_SQE_REVIEWERS)) expect(sqe?.emails).toContain(p.displayName);
  });
});
