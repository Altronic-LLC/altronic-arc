import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  COMPONENT_PREFIXES,
  PARTS_APPROVAL_TRACKS,
  PartsApprovalWorkflowDiagram,
} from "./PartsApprovalWorkflowDiagram";
import { COMPONENT_SIGN_OFF_STATUSES, PART_SIGN_OFF_STATUSES } from "@/types/task";
import { COMPONENT_PREFIX_CATEGORY } from "@/lib/altronicPartMapper";
import { initialSignOff, nextSignOff, SAP_RESPONSE_LABELS } from "@/lib/partsRoles";
import type { WorkflowStep } from "./WorkflowDiagram";

const [componentTrack, partTrack] = PARTS_APPROVAL_TRACKS;
const statuses = (items: typeof componentTrack.items) =>
  items.filter((i): i is WorkflowStep => i.kind === "step").map((s) => s.status);

describe("PartsApprovalWorkflowDiagram", () => {
  it("draws both tracks, each numbered from 1", () => {
    render(<PartsApprovalWorkflowDiagram />);
    for (const track of PARTS_APPROVAL_TRACKS) {
      const list = screen.getByRole("list", { name: `Parts approval workflow: ${track.label}` });
      expect(within(list).getByText("1")).toBeInTheDocument();
    }
  });

  // The diagram describes rules that live elsewhere. These checks fail if
  // those rules move and the drawing doesn't.
  it("follows the sign-off chain the app enforces, step by step", () => {
    for (const [track, component] of [
      [componentTrack, true],
      [partTrack, false],
    ] as const) {
      const chain: string[] = [];
      for (let s: string | null = initialSignOff(component); s !== null; s = nextSignOff(s)) {
        chain.push(s);
      }
      expect(statuses(track.items)).toEqual(chain);
    }
  });

  it("only names sign-off statuses that exist", () => {
    for (const s of statuses(componentTrack.items)) expect(COMPONENT_SIGN_OFF_STATUSES).toContain(s);
    for (const s of statuses(partTrack.items)) expect(PART_SIGN_OFF_STATUSES).toContain(s);
  });

  it("names every component prefix", () => {
    for (const prefix of Object.keys(COMPONENT_PREFIX_CATEGORY)) expect(COMPONENT_PREFIXES).toContain(prefix);
  });

  it("lists the SAP admin's three answers", () => {
    render(<PartsApprovalWorkflowDiagram />);
    for (const label of Object.values(SAP_RESPONSE_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
