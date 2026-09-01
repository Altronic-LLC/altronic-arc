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
    maintenanceAccess.value = { isTech: true, isAdmin: true, enforced: true, isResolving: false };
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

// =============================================================================
// Department, Location and the Operations project on a PM schedule — the
// schedule's OWN columns, pre-filled from the asset without ever stomping an
// answer somebody gave. Same rule as the work-order modal's, same helper.
// =============================================================================

/** The dropdown trigger inside the field with this label. */
function trigger(label: string): HTMLElement {
  const field = screen.getByText(label).closest("label") as HTMLElement;
  return field.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
}

function shown(label: string): string {
  return trigger(label).textContent ?? "";
}

async function pick(label: string, option: string | RegExp) {
  await userEvent.click(trigger(label));
  await userEvent.click(await screen.findByRole("option", { name: option }, SLOW));
}

describe("ScheduledMaintenanceFormModal — department, location and Operations project", () => {
  beforeEach(() => {
    resetScheduledMaintenanceMockStore();
  });

  it("offers all three as searchable dropdowns, never a native select", async () => {
    const { container } = renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
    expect(trigger("Department")).toBeInTheDocument();
    expect(trigger("Location")).toBeInTheDocument();
    expect(trigger("Operations Project")).toBeInTheDocument();
    expect(container.querySelector("select")).toBeNull();
  });

  it("pre-fills Department and Location from the asset that was picked", async () => {
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
    // "40 HP COMPRESSOR" is MACH SHOP / COMPRESSOR ROOM in the demo register.
    await pick("Equipment", /40 HP COMPRESSOR/);
    await waitFor(() => expect(shown("Department")).toContain("MACH SHOP"));
    expect(shown("Location")).toContain("COMPRESSOR ROOM");
  });

  // THE rule — the same one the work-order modal is pinned on, asserted again
  // here because a copy of the pre-fill logic in this file is exactly how the
  // fix would reach only one of the two forms.
  it("NEVER overwrites a Department the user set, when the equipment changes", async () => {
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
    await pick("Equipment", /40 HP COMPRESSOR/);
    await waitFor(() => expect(shown("Department")).toContain("MACH SHOP"));

    await pick("Department", "Panels");
    expect(shown("Department")).toContain("Panels");

    await pick("Equipment", /REFLOW OVEN/);
    expect(shown("Department")).toContain("Panels");
    // Location was never touched, so it still follows the asset.
    await waitFor(() => expect(shown("Location")).toContain("SURFACE MOUNT AREA"));
  });

  it("replaces an earlier PRE-FILL when the asset changes", async () => {
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
    await pick("Equipment", /40 HP COMPRESSOR/);
    await waitFor(() => expect(shown("Department")).toContain("MACH SHOP"));
    await pick("Equipment", /REFLOW OVEN/);
    await waitFor(() => expect(shown("Department")).toContain("SMT"));
  });

  // A stored value is the user's — somebody committed to it.
  it("does not re-derive a stored Department when an existing schedule changes asset", async () => {
    // Schedule 1 carries MACH SHOP / PANELS in the demo data.
    const schedule = await loadSchedule(1);
    renderWithProviders(
      <ScheduledMaintenanceFormModal schedule={schedule} onClose={vi.fn()} />,
    );
    await pick("Equipment", /REFLOW OVEN/);
    expect(shown("Department")).toContain("MACH SHOP");
    expect(shown("Location")).toContain("PANELS");
  });

  it("saves all three on a new schedule", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <ScheduledMaintenanceFormModal
        defaultDate={utc(2026, 9, 1)}
        onClose={onClose}
        onCreated={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByPlaceholderText(/what has to happen/i), "Bench light checks");
    await pick("Department", "PROD");
    await pick("Location", "PRODUCTION");
    await pick("Operations Project", /0003-/);
    await userEvent.click(screen.getByRole("button", { name: /create schedule/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled(), SLOW);
    const created = (await listScheduledMaintenance()).find(
      (s) => s.title === "Bench light checks",
    );
    // Both are reference-list LOOKUPS since 2026-08-28, so what is stored is
    // an id and the title comes back joined against the list.
    expect(created?.department).toEqual({ lookupId: 6, title: "PROD" });
    expect(created?.location).toEqual({ lookupId: 43, title: "PRODUCTION" });
    expect(created?.operationsProject?.lookupId).toBe(4);
    // No asset — a schedule can be about something the register hasn't got.
    expect(created?.equipment).toBeNull();
  });

  // All three are optional; none of them may block saving.
  it("creates a schedule with none of the three set", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <ScheduledMaintenanceFormModal
        defaultDate={utc(2026, 9, 1)}
        onClose={onClose}
        onCreated={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByPlaceholderText(/what has to happen/i), "Bare schedule");
    await userEvent.click(screen.getByRole("button", { name: /create schedule/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled(), SLOW);
    const created = (await listScheduledMaintenance()).find((s) => s.title === "Bare schedule");
    expect(created).toBeDefined();
    expect(created?.department).toBeNull();
    expect(created?.location).toBeNull();
    expect(created?.operationsProject).toBeNull();
  });

  it("edits the schedule's own Department, leaving everything else alone", async () => {
    const schedule = await loadSchedule(1);
    const onClose = vi.fn();
    renderWithProviders(
      <ScheduledMaintenanceFormModal schedule={schedule} onClose={onClose} />,
    );
    await pick("Department", "QC");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled(), SLOW);
    const after = await loadSchedule(1);
    expect(after.department).toEqual({ lookupId: 7, title: "QC" });
    expect(after.title).toBe(schedule.title);
    expect(after.location).toEqual(schedule.location);
  });

  it("saves the Operations project through its own lookup mutation", async () => {
    const schedule = await loadSchedule(1);
    const onClose = vi.fn();
    renderWithProviders(
      <ScheduledMaintenanceFormModal schedule={schedule} onClose={onClose} />,
    );
    await pick("Operations Project", /0002-/);
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled(), SLOW);
    expect((await loadSchedule(1)).operationsProject?.lookupId).toBe(3);
  });

  // ==========================================================================
  // The admin gate. A schedule drives what the whole shop is told is due, so
  // creating and editing one is narrower than doing the work.
  // ==========================================================================
  describe("the admin gate", () => {
    it("disables Create and says why, for a TECH", async () => {
      maintenanceAccess.value = {
        isTech: true,
        isAdmin: false,
        enforced: true,
        isResolving: false,
      };
      renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);

      const submit = screen.getByRole("button", { name: /create schedule/i });
      expect(submit).toBeDisabled();
      expect(submit).toHaveAttribute("title", expect.stringContaining("maintenance admins"));
      // Stated on the page, and naming the role to ask for.
      expect(screen.getByText(/limited to maintenance admins/i)).toBeInTheDocument();
      expect(screen.getByText(/Admin role/)).toBeInTheDocument();
    });

    // Belt and braces with the disabled button: Enter in a field submits too.
    it("writes nothing if the form is submitted anyway", async () => {
      maintenanceAccess.value = {
        isTech: true,
        isAdmin: false,
        enforced: true,
        isResolving: false,
      };
      const before = (await listScheduledMaintenance()).length;
      const onClose = vi.fn();
      const { container } = renderWithProviders(
        <ScheduledMaintenanceFormModal onClose={onClose} />,
      );

      const form = container.querySelector("#schedule-form") as HTMLFormElement;
      form.requestSubmit();

      await waitFor(() => expect((container.textContent ?? "")).toMatch(/maintenance admins/i));
      expect(onClose).not.toHaveBeenCalled();
      expect((await listScheduledMaintenance()).length).toBe(before);
    });

    it("lets a maintenance admin save", async () => {
      maintenanceAccess.value = {
        isTech: false,
        isAdmin: true,
        enforced: true,
        isResolving: false,
      };
      renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
      expect(screen.getByRole("button", { name: /create schedule/i })).toBeEnabled();
      expect(screen.queryByText(/limited to maintenance admins/i)).toBeNull();
    });

    // Lockout safety.
    it("stays open to everyone while gating is unenforced", () => {
      maintenanceAccess.value = {
        isTech: false,
        isAdmin: false,
        enforced: false,
        isResolving: false,
      };
      renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
      expect(screen.getByRole("button", { name: /create schedule/i })).toBeEnabled();
    });

    it("says nothing about permissions while the roles list is loading", () => {
      maintenanceAccess.value = {
        isTech: false,
        isAdmin: false,
        enforced: true,
        isResolving: true,
      };
      renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
      expect(screen.getByRole("button", { name: /create schedule/i })).toBeDisabled();
      expect(screen.queryByText(/limited to maintenance admins/i)).toBeNull();
    });
  });
});

// =============================================================================
// The Hourmeter basis.
//
// Picking it swaps which half of the form is primary. Leaving the date fields
// looking as required as the hour fields is how somebody carefully fills in
// boxes that do nothing.
// =============================================================================
describe("ScheduledMaintenanceFormModal — Hourmeter", () => {
  beforeEach(() => {
    resetScheduledMaintenanceMockStore();
    maintenanceAccess.value = { isTech: true, isAdmin: true, enforced: true, isResolving: false };
  });

  it("offers Hourmeter as a third pill, and explains it is a reading not a date", async () => {
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
    const pill = screen.getByRole("radio", { name: "Hourmeter" });
    expect(pill).toBeInTheDocument();
    // Three options is still pills, not a dropdown — the rule is three or fewer.
    expect(screen.queryByRole("combobox", { name: /basis/i })).not.toBeInTheDocument();

    await userEvent.click(pill);
    expect(screen.getByText(/due at a run-hours READING, not on a date/i)).toBeInTheDocument();
  });

  it("makes the hour fields primary and the date field secondary", async () => {
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
    expect(screen.getByLabelText("First due")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Hourmeter" }));

    // The date field is gone; a reading takes its place.
    expect(screen.queryByLabelText("First due")).not.toBeInTheDocument();
    expect(screen.getByLabelText("First due at run hours")).toBeInTheDocument();
  });

  it("sets the unit to Hours when Hourmeter is picked, and clears it again on the way out", async () => {
    // The two describe ONE decision. Letting them contradict each other is how
    // a schedule that never comes due gets created.
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Hourmeter" }));
    expect(screen.getByText(/Run hours off the asset's hourmeter/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Fixed" }));
    expect(screen.queryByText(/Run hours off the asset's hourmeter/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("First due")).toBeInTheDocument();
  });

  it("disables Grace days and Lead time days, with the reason — never reusing them as hours", async () => {
    // Three grace days is not three grace hours, and there is no hours column
    // to hold the analogue. Disabled rather than hidden: an existing schedule
    // may already carry values, and a field that vanishes looks like data loss.
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Hourmeter" }));

    const grace = screen.getByRole("spinbutton", { name: /grace days/i });
    expect(grace).toBeDisabled();
    expect(grace).toHaveAttribute("title", expect.stringContaining("don't apply"));
    expect(screen.getByText(/not used by a run-hours schedule, which is due as soon as/i))
      .toBeInTheDocument();
    expect(screen.getByText(/there's no date to be ahead of/i)).toBeInTheDocument();
  });

  it("previews the run-hours rule instead of a list of dates", async () => {
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Hourmeter" }));
    await userEvent.type(screen.getByRole("spinbutton", { name: /frequency interval/i }), "500");

    expect(screen.getByText("Run-hours schedule")).toBeInTheDocument();
    expect(screen.getByText(/Due every 500 run hours/i)).toBeInTheDocument();
    // Said out loud, because it is the one thing that makes a meter PM work.
    expect(screen.getByText(/a reading that never moves is a PM that never comes due/i))
      .toBeInTheDocument();
  });

  it("refuses to save without an hours interval — the one thing that makes it come due", async () => {
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText(/What has to happen/i), "Oil change");
    await userEvent.click(screen.getByRole("radio", { name: "Hourmeter" }));
    await userEvent.click(screen.getByRole("button", { name: "Create schedule" }));

    await waitFor(
      () =>
        expect(
          screen.getByText(/Set how many run hours between occurrences/i),
        ).toBeInTheDocument(),
      SLOW,
    );
  });

  it("does NOT require a first due date, unlike a calendar schedule", async () => {
    // Requiring one would force somebody to invent a date the engine ignores.
    const onClose = vi.fn();
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={onClose} />);
    await userEvent.type(screen.getByPlaceholderText(/What has to happen/i), "Oil change");
    await userEvent.click(screen.getByRole("radio", { name: "Hourmeter" }));
    await userEvent.type(screen.getByRole("spinbutton", { name: /frequency interval/i }), "500");
    await userEvent.click(screen.getByRole("button", { name: "Create schedule" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled(), SLOW);
    const created = (await listScheduledMaintenance()).find((s) => s.title === "Oil change");
    expect(created?.scheduleBasis).toBe("Hourmeter");
    expect(created?.frequencyUnit).toBe("Hours");
    expect(created?.frequencyInterval).toBe(500);
    expect(created?.firstDueDate).toBeNull();
  });

  it("saves a first due READING when one is given", async () => {
    const onClose = vi.fn();
    renderWithProviders(<ScheduledMaintenanceFormModal onClose={onClose} />);
    await userEvent.type(screen.getByPlaceholderText(/What has to happen/i), "Valve check");
    await userEvent.click(screen.getByRole("radio", { name: "Hourmeter" }));
    await userEvent.type(screen.getByRole("spinbutton", { name: /frequency interval/i }), "500");
    await userEvent.type(screen.getByLabelText("First due at run hours"), "5500");
    await userEvent.click(screen.getByRole("button", { name: "Create schedule" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled(), SLOW);
    const created = (await listScheduledMaintenance()).find((s) => s.title === "Valve check");
    expect(created?.nextDueHours).toBe(5500);
  });

  it("opens an existing run-hours schedule in hours mode, showing its stored target", async () => {
    const meter = await loadSchedule(13);
    renderWithProviders(<ScheduledMaintenanceFormModal schedule={meter} onClose={vi.fn()} />);
    expect(screen.getByLabelText("First due at run hours")).toHaveValue(3000);
    expect(screen.queryByLabelText("First due")).not.toBeInTheDocument();
  });
});
