import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import {
  listScheduledMaintenance,
  resetScheduledMaintenanceMockStore,
} from "@/api/scheduledMaintenance";
import type { ScheduledMaintenance } from "@/types/task";
import { ScheduledMaintenanceFormModal } from "./ScheduledMaintenanceFormModal";

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

const SLOW = { timeout: 8000 };

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}

async function loadSchedule(id: number): Promise<ScheduledMaintenance> {
  const all = await listScheduledMaintenance();
  return all.find((s) => s.id === id)!;
}

describe("ScheduledMaintenanceFormModal", () => {
  beforeEach(() => {
    resetScheduledMaintenanceMockStore();
  });

  it("offers Fixed and Floating as PILLS, with an explanation of the difference", async () => {
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "Fixed" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Floating" })).toBeInTheDocument();
    // Not a dropdown: two options behind one would cost a click to open.
    expect(screen.queryByRole("combobox", { name: /basis/i })).not.toBeInTheDocument();
    expect(screen.getByText(/the next date comes off the DUE date/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Floating" }));
    expect(screen.getByText(/the clock restarts when the job is actually done/i)).toBeInTheDocument();
  });

  it("says the Instructions field is a checklist, and how to write one", () => {
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
    const help = screen.getByText(/becomes a tickable step/i);
    expect(help).toHaveTextContent("- [ ]");
    expect(help).toHaveTextContent(/checklist/i);
  });

  it("refuses a schedule with no name", async () => {
    renderWithProviders(
      <ScheduledMaintenanceFormModal defaultDate={utc(2026, 9, 1)} onClose={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /create schedule/i }));
    expect(await screen.findByText(/give the schedule a name/i)).toBeInTheDocument();
  });

  it("refuses a schedule with no first due date — it would never be due", async () => {
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText(/what has to happen/i), "Quarterly filter swap");
    await userEvent.click(screen.getByRole("button", { name: /create schedule/i }));
    expect(await screen.findByText(/set the first due date/i)).toBeInTheDocument();
  });

  it("refuses an interval without its unit", async () => {
    renderWithProviders(
      <ScheduledMaintenanceFormModal defaultDate={utc(2026, 9, 1)} onClose={vi.fn()} />,
    );
    await userEvent.type(screen.getByPlaceholderText(/what has to happen/i), "Filter swap");
    await userEvent.type(screen.getByLabelText("Frequency interval"), "3");
    await userEvent.click(screen.getByRole("button", { name: /create schedule/i }));
    expect(
      await screen.findByText(/set both the interval and its unit, or neither/i),
    ).toBeInTheDocument();
  });

  it("previews the next occurrences straight from the projection engine", () => {
    renderWithProviders(
      <ScheduledMaintenanceFormModal defaultDate={utc(2026, 9, 1)} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/next occurrences/i)).toBeInTheDocument();
    // No frequency yet, so it's a one-off — and the preview says so rather
    // than implying a repeat that isn't configured.
    expect(screen.getByText(/due once and will not repeat/i)).toBeInTheDocument();
  });

  it("creates a schedule and hands back its id", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <ScheduledMaintenanceFormModal
        defaultDate={utc(2026, 9, 1)}
        onClose={onClose}
        onCreated={onCreated}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText(/what has to happen/i), "Quarterly filter swap");
    await userEvent.click(screen.getByRole("button", { name: /create schedule/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled(), SLOW);
    expect(onClose).toHaveBeenCalled();

    const created = (await listScheduledMaintenance()).find(
      (s) => s.title === "Quarterly filter swap",
    );
    expect(created).toBeDefined();
    // A new schedule is first due when it says it is — both columns agree.
    expect(created?.firstDueDate?.getTime()).toBe(utc(2026, 9, 1).getTime());
    expect(created?.nextDueDate?.getTime()).toBe(utc(2026, 9, 1).getTime());
    expect(created?.active).toBe(true);
    expect(created?.scheduleBasis).toBe("Fixed");
  });

  it("edits an existing schedule, sending only what changed", async () => {
    const schedule = await loadSchedule(1);
    const onClose = vi.fn();
    renderWithProviders(<ScheduledMaintenanceFormModal schedule={schedule} onClose={onClose} />);

    const name = screen.getByPlaceholderText(/what has to happen/i);
    await userEvent.clear(name);
    await userEvent.type(name, "Weekly compressor check");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled(), SLOW);
    const after = await loadSchedule(1);
    expect(after.title).toBe("Weekly compressor check");
    // Untouched fields survive.
    expect(after.frequencyUnit).toBe(schedule.frequencyUnit);
    expect(after.nextDueDate?.getTime()).toBe(schedule.nextDueDate?.getTime());
  });

  it("retiring a schedule from the form saves Active = false", async () => {
    const schedule = await loadSchedule(1);
    const onClose = vi.fn();
    renderWithProviders(<ScheduledMaintenanceFormModal schedule={schedule} onClose={onClose} />);

    const activeGroup = screen.getByRole("radiogroup", { name: "Active" });
    await userEvent.click(
      // The "No" pill inside the Active group specifically — several groups
      // on this form carry a No.
      activeGroup.querySelector("input[type=radio]:not(:checked)") as HTMLElement,
    );
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(async () => {
      expect((await loadSchedule(1)).active).toBe(false);
    }, SLOW);
  });
});
