import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The CMMS role gates aren't what this file is about — they have their own
// tests (lib/maintenanceRoles.test.ts, and the .roles.test files beside the two
// maintenance hooks). Full rights here, controllable where a case needs to see
// a refusal, so nothing in this file depends on the roles list loading.
const maintenanceAccess = vi.hoisted(() => ({
  value: { isTech: true, isAdmin: true, enforced: true, isResolving: false },
}));

vi.mock("@/hooks/useMaintenanceRoles", () => ({
  useMyMaintenanceRoles: () => maintenanceAccess.value,
  useResolveMaintenanceAccess: () => async () => maintenanceAccess.value,
}));
import { renderWithProviders } from "@/test/render";
import { LogPmCompletionModal } from "./LogPmCompletionModal";
import type { ScheduledMaintenance } from "@/types/task";

// =============================================================================
// The schedule's Instructions were always copied onto the work order this
// modal creates — but they were never RENDERED here, so at the moment somebody
// decides Start / Complete / Skip, the steps they are deciding about were
// invisible. Reported on the first walkthrough as "I see the checklist but it
// is not brought forward on the log completion modal".
//
// Shown read-only on purpose: a tick records who did it and when, and that
// belongs on the work order — the permanent record — not on a modal that might
// be cancelled.
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com" }),
}));

const CHECKLIST = [
  "- [ ] Isolate and lock out",
  "- [ ] Drain the sump",
  "- [ ] Refill and log the level",
].join("\n");

function schedule(over: Partial<ScheduledMaintenance> = {}): ScheduledMaintenance {
  return {
    id: 2,
    title: "40 HP compressor — oil change",
    instructions: CHECKLIST,
    category: "Oil Change",
    priority: "Med",
    equipment: { lookupId: 3, title: "40 HP COMPRESSOR" },
    frequencyInterval: 6,
    frequencyUnit: "Months",
    scheduleBasis: "Floating",
    firstDueDate: new Date(Date.UTC(2026, 0, 5, 12)),
    nextDueDate: new Date(Date.UTC(2026, 8, 5, 12)),
    lastCompleted: null,
    lastCompletedBy: null,
    graceDays: 7,
    leadTimeDays: 14,
    assignedTo: null,
    watchers: [],
    timeNeeded: 2,
    active: true,
    requiresShutdown: true,
    lotoRequired: true,
    department: null,
    location: null,
    operationsProject: null,
    hasAttachments: false,
    createdAt: new Date(Date.UTC(2026, 0, 1, 12)),
    modifiedAt: new Date(Date.UTC(2026, 0, 1, 12)),
    ...over,
  } as ScheduledMaintenance;
}

function render(s: ScheduledMaintenance) {
  return renderWithProviders(
    <LogPmCompletionModal
      schedule={s}
      occurrence={new Date(Date.UTC(2026, 8, 5, 12))}
      onClose={() => {}}
    />,
  );
}

describe("the procedure on the log modal", () => {
  it("shows the schedule's steps before anything is logged", () => {
    render(schedule());
    const panel = screen.getByRole("region", { name: /what this maintenance involves/i });
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent("Isolate and lock out");
    expect(panel).toHaveTextContent("Drain the sump");
    expect(panel).toHaveTextContent("Refill and log the level");
  });

  it("renders the steps as checkboxes that cannot be ticked here", () => {
    render(schedule());
    const panel = screen.getByRole("region", { name: /what this maintenance involves/i });
    const boxes = panel.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBeGreaterThan(0);
    boxes.forEach((b) => expect(b).toBeDisabled());
  });

  it("says the steps carry onto the work order", () => {
    render(schedule());
    expect(screen.getByText(/carried onto the work order/i)).toBeInTheDocument();
  });

  it("renders no procedure panel when the schedule has no instructions", () => {
    render(schedule({ instructions: "" }));
    expect(
      screen.queryByRole("region", { name: /what this maintenance involves/i }),
    ).not.toBeInTheDocument();
  });

  it("renders plain-prose instructions too, not only checklists", () => {
    render(schedule({ instructions: "Vendor calibration visit. Certificate goes in the binder." }));
    const panel = screen.getByRole("region", { name: /what this maintenance involves/i });
    expect(panel).toHaveTextContent(/vendor calibration visit/i);
  });
});
