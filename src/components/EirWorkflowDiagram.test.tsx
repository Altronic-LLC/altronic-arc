import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { EIR_FLOW, EirWorkflowDiagram } from "./EirWorkflowDiagram";
import { EIR_STATUSES } from "@/types/task";
import {
  EIR_RESPONSE_ACCEPTED_ALERTS,
  EIR_TRIAGE_ASSIGNERS,
  EIR_TRIAGE_PROJECT_REVIEWERS,
} from "@/api/config";
import { EIR_PROJECT_REFERENCE_EDITORS } from "@/lib/eirProjectReference";
import { parseRecipientList } from "@/lib/recipientList";

const step = (title: string) => EIR_FLOW.find((s) => s.title === title)!;

describe("EirWorkflowDiagram", () => {
  it("renders every step in order, numbered", () => {
    render(<EirWorkflowDiagram />);
    const list = screen.getByRole("list", { name: "EIR workflow" });
    const text = list.textContent ?? "";
    let from = 0;
    EIR_FLOW.forEach((s, i) => {
      const at = text.indexOf(s.title, from);
      expect(at, `step "${s.title}" out of order`).toBeGreaterThanOrEqual(from);
      from = at;
      expect(within(list).getByText(String(i + 1))).toBeInTheDocument();
    });
  });

  // The diagram describes rules that live elsewhere. These checks fail if
  // those rules move and the drawing doesn't.
  it("only names EIR statuses that exist", () => {
    for (const s of EIR_FLOW) {
      if (s.status) expect(EIR_STATUSES).toContain(s.status);
      for (const b of s.branches ?? []) if (b.status) expect(EIR_STATUSES).toContain(b.status);
    }
  });

  it("starts where a new EIR starts", () => {
    expect(EIR_FLOW[0].status).toBe("Under Review");
  });

  it("sends a rejected response back to the engineer", () => {
    render(<EirWorkflowDiagram />);
    const n = EIR_FLOW.findIndex((s) => s.title === "Respond and resolve") + 1;
    expect(screen.getByText(`Goes to step ${n}: Respond and resolve`)).toBeInTheDocument();
  });

  it("names the people the app actually asks at each step", () => {
    const names = (raw: string) => parseRecipientList(raw).map((p) => p.displayName);
    for (const n of names(EIR_TRIAGE_PROJECT_REVIEWERS)) expect(step("Raise the EIR").emails).toContain(n);
    for (const n of names(EIR_TRIAGE_ASSIGNERS)) expect(step("Assign an engineer").who).toContain(n);
    for (const n of names(EIR_RESPONSE_ACCEPTED_ALERTS)) expect(step("Close it").who).toContain(n);
    for (const email of EIR_PROJECT_REFERENCE_EDITORS) {
      const first = email.split("@")[0].split(".")[0].toLowerCase();
      expect(step("Add the project reference").who.toLowerCase()).toContain(first);
    }
  });
});
