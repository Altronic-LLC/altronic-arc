import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import {
  listScheduledMaintenance,
  resetScheduledMaintenanceMockStore,
} from "@/api/scheduledMaintenance";
import { listMaintenanceTasks, resetMaintenanceMockStore } from "@/api/maintenanceTasks";
import type { ScheduledMaintenance } from "@/types/task";
import { LogPmCompletionModal } from "./LogPmCompletionModal";

// =============================================================================
// The modal that turns a projection into a record.
//
// These run against the MOCK store rather than mocked hooks, because the thing
// worth pinning is the end state: which work order exists afterwards, what its
// Resolution says, and whether the schedule moved.
// =============================================================================

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

const SLOW = { timeout: 8000 };

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}

async function loadSchedule(id = 1): Promise<ScheduledMaintenance> {
  const all = await listScheduledMaintenance();
  return all.find((s) => s.id === id)!;
}

describe("LogPmCompletionModal", () => {
  beforeEach(() => {
    resetScheduledMaintenanceMockStore();
    resetMaintenanceMockStore();
    maintenanceAccess.value = { isTech: true, isAdmin: true, enforced: true, isResolving: false };
  });

  it("says nothing has been logged yet, and offers the three ways to log it", async () => {
    const schedule = await loadSchedule();
    renderWithProviders(
      <LogPmCompletionModal schedule={schedule} occurrence={utc(2026, 9, 2)} onClose={vi.fn()} />,
    );

    expect(screen.getByText(/nothing has been logged for this occurrence yet/i)).toBeInTheDocument();
    for (const label of ["Start", "Complete", "Skip"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
  });

  it("REFUSES a skip with no reason", async () => {
    const schedule = await loadSchedule();
    const onClose = vi.fn();
    renderWithProviders(
      <LogPmCompletionModal schedule={schedule} occurrence={utc(2026, 9, 2)} onClose={onClose} />,
    );

    await userEvent.click(screen.getByRole("radio", { name: "Skip" }));
    await userEvent.click(screen.getByRole("button", { name: /log skip/i }));

    expect(await screen.findByText(/say why this is being skipped/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // Nothing was written.
    expect((await listMaintenanceTasks()).some((t) => t.scheduleRef?.lookupId === schedule.id && t.status === "Canceled")).toBe(false);
  });

  it("writes the skip reason into the work order's Resolution and cancels it", async () => {
    const schedule = await loadSchedule();
    const onClose = vi.fn();
    renderWithProviders(
      <LogPmCompletionModal schedule={schedule} occurrence={utc(2026, 9, 2)} onClose={onClose} />,
    );

    await userEvent.click(screen.getByRole("radio", { name: "Skip" }));
    await userEvent.type(
      screen.getByPlaceholderText(/machine down for a rebuild/i),
      "Compressor isolated for a rebuild",
    );
    await userEvent.click(screen.getByRole("button", { name: /log skip/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled(), SLOW);

    const tasks = await listMaintenanceTasks();
    const created = tasks.find(
      (t) => t.scheduleRef?.lookupId === schedule.id && t.status === "Canceled",
    );
    expect(created).toBeDefined();
    expect(created?.resolution).toContain("Compressor isolated for a rebuild");
    expect(created?.resolution).toMatch(/^Skipped —/);
  });

  it("a skip advances the due date but records NO completion", async () => {
    const schedule = await loadSchedule();
    const before = await loadSchedule();
    renderWithProviders(
      <LogPmCompletionModal schedule={schedule} occurrence={utc(2026, 9, 2)} onClose={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("radio", { name: "Skip" }));
    await userEvent.type(screen.getByPlaceholderText(/machine down for a rebuild/i), "Not needed");
    await userEvent.click(screen.getByRole("button", { name: /log skip/i }));

    await waitFor(async () => {
      const after = await loadSchedule();
      expect(after.nextDueDate?.getTime()).not.toBe(before.nextDueDate?.getTime());
    }, SLOW);

    const after = await loadSchedule();
    // The work was deliberately NOT done, so nothing may claim it was.
    expect(after.lastCompleted?.getTime() ?? null).toBe(before.lastCompleted?.getTime() ?? null);
    expect(after.lastCompletedBy).toBe(before.lastCompletedBy);
  });

  it("a completion closes the work order AND rolls the schedule on", async () => {
    const schedule = await loadSchedule();
    const before = await loadSchedule();
    renderWithProviders(
      <LogPmCompletionModal schedule={schedule} occurrence={utc(2026, 9, 2)} onClose={vi.fn()} />,
    );

    await userEvent.type(
      screen.getByPlaceholderText(/what was found/i),
      "Oil topped up, receiver drained",
    );
    await userEvent.click(screen.getByRole("button", { name: /log completion/i }));

    await waitFor(async () => {
      const tasks = await listMaintenanceTasks();
      expect(
        tasks.some((t) => t.scheduleRef?.lookupId === schedule.id && t.status === "Complete"),
      ).toBe(true);
    }, SLOW);

    await waitFor(async () => {
      const after = await loadSchedule();
      expect(after.lastCompleted).not.toBeNull();
      expect(after.nextDueDate?.getTime()).not.toBe(before.nextDueDate?.getTime());
    }, SLOW);
  });

  it("a start leaves the work order Started and the schedule where it was", async () => {
    const schedule = await loadSchedule();
    const before = await loadSchedule();
    renderWithProviders(
      <LogPmCompletionModal schedule={schedule} occurrence={utc(2026, 9, 2)} onClose={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("radio", { name: "Start" }));
    await userEvent.click(screen.getByRole("button", { name: /start work order/i }));

    await waitFor(async () => {
      const tasks = await listMaintenanceTasks();
      expect(
        tasks.some((t) => t.scheduleRef?.lookupId === schedule.id && t.status === "Started"),
      ).toBe(true);
    }, SLOW);

    const after = await loadSchedule();
    expect(after.nextDueDate?.getTime()).toBe(before.nextDueDate?.getTime());
    expect(after.lastCompleted?.getTime() ?? null).toBe(before.lastCompleted?.getTime() ?? null);
  });

  it("dates the work order to the OCCURRENCE, not to today", async () => {
    const schedule = await loadSchedule();
    const occurrence = utc(2026, 9, 2);
    renderWithProviders(
      <LogPmCompletionModal schedule={schedule} occurrence={occurrence} onClose={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("radio", { name: "Start" }));
    await userEvent.click(screen.getByRole("button", { name: /start work order/i }));

    await waitFor(async () => {
      const tasks = await listMaintenanceTasks();
      const created = tasks.find(
        (t) => t.scheduleRef?.lookupId === schedule.id && t.status === "Started",
      );
      // This is what lets the calendar suppress the projection it came from.
      expect(created?.dueDate?.getTime()).toBe(occurrence.getTime());
    }, SLOW);
  });

  it("carries the schedule's instructions onto the work order as its checklist", async () => {
    const schedule = await loadSchedule();
    renderWithProviders(
      <LogPmCompletionModal schedule={schedule} occurrence={utc(2026, 9, 2)} onClose={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("radio", { name: "Start" }));
    await userEvent.click(screen.getByRole("button", { name: /start work order/i }));

    await waitFor(async () => {
      const tasks = await listMaintenanceTasks();
      const created = tasks.find(
        (t) => t.scheduleRef?.lookupId === schedule.id && t.status === "Started",
      );
      expect(created?.description).toBe(schedule.instructions);
    }, SLOW);
  });

  // ==========================================================================
  // The tech gate. Logging a PM creates a work order against a schedule and,
  // on Complete, writes the schedule's own completion history — so it is
  // narrower than raising an ordinary work order, which stays open to all.
  // ==========================================================================
  describe("the tech gate", () => {
    it("disables the submit and says why, for somebody with no maintenance role", async () => {
      maintenanceAccess.value = {
      isTech: false,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    };
      const schedule = await loadSchedule();
      renderWithProviders(
        <LogPmCompletionModal schedule={schedule} occurrence={utc(2026, 9, 2)} onClose={vi.fn()} />,
      );

      const submit = screen.getByRole("button", { name: /log completion/i });
      expect(submit).toBeDisabled();
      expect(submit).toHaveAttribute("title", expect.stringContaining("maintenance techs"));
      // Said on the page, not only in a tooltip a touch user can't reach.
      expect(screen.getByText(/limited to\s+maintenance techs/i)).toBeInTheDocument();
    });

    // Belt and braces with the disabled button: Enter in a field submits too,
    // so the handler refuses as well — and nothing reaches the store.
    it("writes nothing if the form is submitted anyway", async () => {
      maintenanceAccess.value = {
      isTech: false,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    };
      const schedule = await loadSchedule();
      const before = (await listMaintenanceTasks()).length;
      const { container } = renderWithProviders(
        <LogPmCompletionModal schedule={schedule} occurrence={utc(2026, 9, 2)} onClose={vi.fn()} />,
      );

      const form = container.querySelector("#log-pm-form") as HTMLFormElement;
      form.requestSubmit();

      expect(await screen.findByText(/limited to\s+maintenance techs/i)).toBeInTheDocument();
      expect((await listMaintenanceTasks()).length).toBe(before);
    });

    it("lets a tech log one", async () => {
      maintenanceAccess.value = {
        isTech: true,
        isAdmin: false,
        enforced: true,
        isResolving: false,
      };
      const schedule = await loadSchedule();
      renderWithProviders(
        <LogPmCompletionModal schedule={schedule} occurrence={utc(2026, 9, 2)} onClose={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /log completion/i })).toBeEnabled();
      expect(screen.queryByText(/limited to\s+maintenance techs/i)).toBeNull();
    });

    // Lockout safety.
    it("stays open to everyone while gating is unenforced", async () => {
      maintenanceAccess.value = {
        isTech: false,
        isAdmin: false,
        enforced: false,
        isResolving: false,
      };
      const schedule = await loadSchedule();
      renderWithProviders(
        <LogPmCompletionModal schedule={schedule} occurrence={utc(2026, 9, 2)} onClose={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /log completion/i })).toBeEnabled();
    });

    it("says nothing about permissions while the roles list is loading", async () => {
      maintenanceAccess.value = { ...{
      isTech: false,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    }, isResolving: true };
      const schedule = await loadSchedule();
      renderWithProviders(
        <LogPmCompletionModal schedule={schedule} occurrence={utc(2026, 9, 2)} onClose={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: /log completion/i })).toBeDisabled();
      expect(screen.queryByText(/limited to\s+maintenance techs/i)).toBeNull();
    });
  });
});
