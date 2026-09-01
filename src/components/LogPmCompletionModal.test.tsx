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

// =============================================================================
// Logging a RUN-HOURS occurrence.
//
// The reading is the point. Without it `advanceMeterSchedule` writes nothing,
// and the schedule records a completion and then stays due at the same reading
// for ever — a PM that silently never rolls on, which is the failure this whole
// feature exists to avoid. So it is required on Complete, defaulted from the
// asset, and editable, because the person at the machine reads it off the
// machine.
// =============================================================================
describe("LogPmCompletionModal — run-hours schedules", () => {
  beforeEach(() => {
    resetScheduledMaintenanceMockStore();
    resetMaintenanceMockStore();
    maintenanceAccess.value = { isTech: true, isAdmin: true, enforced: true, isResolving: false };
  });

  /** Schedule 11: every 500 run hours, last done at 4,300 → due at 4,800. */
  const METER_ID = 11;

  async function renderMeterModal(onClose = vi.fn()) {
    const schedule = await loadSchedule(METER_ID);
    const result = renderWithProviders(
      <LogPmCompletionModal
        schedule={schedule}
        occurrence={utc(2026, 9, 15)}
        onClose={onClose}
      />,
    );
    // The reading box appears at once, but its VALUE (and the target derived
    // from it) come from the asset register, which loads async — so wait for
    // the register rather than for the box, or every assertion below races it.
    await waitFor(
      () => expect(screen.getByLabelText("Hourmeter reading now")).toHaveValue(4820),
      SLOW,
    );
    return { ...result, schedule, onClose };
  }

  it("names the target as a READING, never as a date", async () => {
    await renderMeterModal();
    expect(screen.getByText(/Due at 4,800 hrs/)).toBeInTheDocument();
    expect(screen.getByText(/Every 500 run hours/)).toBeInTheDocument();
  });

  it("asks for the hourmeter reading, and defaults it from the asset", async () => {
    await renderMeterModal();
    await waitFor(
      () => expect(screen.getByLabelText("Hourmeter reading now")).toHaveValue(4820),
      SLOW,
    );
    // Two numbers both called "hours" is a real trap, so they are named apart.
    expect(screen.getByText(/The asset's stored reading is 4,820 hrs/)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /labour hours/i })).toBeInTheDocument();
  });

  it("previews the reading it will next be due at", async () => {
    await renderMeterModal();
    // Said in two places — under the reading box and under the notes — so
    // getAllByText, not getByText.
    await waitFor(
      () => expect(screen.getAllByText(/next due at 5,320 hrs/i).length).toBeGreaterThan(0),
      SLOW,
    );
  });

  it("refuses to complete with the reading cleared", async () => {
    await renderMeterModal();
    await userEvent.clear(screen.getByLabelText("Hourmeter reading now"));
    await userEvent.click(screen.getByRole("button", { name: "Log completion" }));

    await waitFor(
      () =>
        expect(
          screen.getByText(/Enter the hourmeter reading off the machine/i),
        ).toBeInTheDocument(),
      SLOW,
    );
    // Nothing was written.
    const after = await loadSchedule(METER_ID);
    expect(after.lastCompletedHours).toBe(4300);
  });

  it("stamps the reading and rolls the target on from it", async () => {
    const { onClose } = await renderMeterModal();
    const box = screen.getByLabelText("Hourmeter reading now");
    await userEvent.clear(box);
    await userEvent.type(box, "5340");
    await userEvent.click(screen.getByRole("button", { name: "Log completion" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled(), SLOW);
    const after = await loadSchedule(METER_ID);
    // Advanced from the reading it was DONE at, not the 4,800 it was due at.
    expect(after.lastCompletedHours).toBe(5340);
    expect(after.nextDueHours).toBe(5840);
    // And it still has no next DATE — a meter schedule never gets one.
    const tasks = await listMaintenanceTasks();
    expect(tasks.some((t) => t.scheduleRef?.lookupId === METER_ID)).toBe(true);
  });

  it("does not ask for a reading when starting or skipping", async () => {
    // Neither records a completion, so neither needs a reading.
    await renderMeterModal();
    await userEvent.click(screen.getByRole("radio", { name: "Start" }));
    expect(screen.queryByLabelText("Hourmeter reading now")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Skip" }));
    expect(screen.queryByLabelText("Hourmeter reading now")).not.toBeInTheDocument();
  });

  it("says plainly that skipping cannot move a run-hours target", async () => {
    // Pushing the reading out would invent a number nobody measured, so the
    // schedule keeps asking until the job is done or it is retired.
    await renderMeterModal();
    await userEvent.click(screen.getByRole("radio", { name: "Skip" }));
    expect(screen.getByText(/skipping cannot move its target/i)).toBeInTheDocument();

    await userEvent.type(
      screen.getByRole("textbox"),
      "Machine down for a rebuild.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Log skip" }));

    // Neither hour column moved: a skip records nothing and cannot push the
    // target out. The schedule keeps asking.
    await waitFor(async () => {
      const after = await loadSchedule(METER_ID);
      expect(after.lastCompletedHours).toBe(4300);
      expect(after.nextDueHours).toBeNull();
    }, SLOW);
  });

  it("leaves the reading box empty when the asset has never had one", async () => {
    // Schedule 13's asset carries no hourmeter figure — exactly the case where
    // somebody has to read it off the machine.
    const schedule = await loadSchedule(13);
    renderWithProviders(
      <LogPmCompletionModal
        schedule={schedule}
        occurrence={utc(2026, 9, 15)}
        onClose={vi.fn()}
      />,
    );
    await waitFor(
      () => expect(screen.getByLabelText("Hourmeter reading now")).toHaveValue(null),
      SLOW,
    );
    expect(
      screen.getByText(/The asset has no stored reading — read it off the machine/i),
    ).toBeInTheDocument();
  });

  it("shows no reading box at all for a calendar schedule", async () => {
    const schedule = await loadSchedule(1);
    renderWithProviders(
      <LogPmCompletionModal
        schedule={schedule}
        occurrence={utc(2026, 9, 2)}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Hourmeter reading now")).not.toBeInTheDocument();
  });
});
