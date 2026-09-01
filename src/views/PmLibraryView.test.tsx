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
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import {
  listScheduledMaintenance,
  resetScheduledMaintenanceMockStore,
} from "@/api/scheduledMaintenance";
import { resetMaintenanceMockStore } from "@/api/maintenanceTasks";
import PmLibraryView from "./PmLibraryView";

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

const SLOW = { timeout: 8000 };

async function renderLibrary(search = "") {
  const result = renderWithProviders(<PmLibraryView />, {
    route: `/operations/maintenance/schedules${search}`,
    routePattern: "/operations/maintenance/schedules",
  });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument(), SLOW);
  return result;
}

describe("PmLibraryView", () => {
  beforeEach(() => {
    resetScheduledMaintenanceMockStore();
    resetMaintenanceMockStore();
    maintenanceAccess.value = { isTech: true, isAdmin: true, enforced: true, isResolving: false };
  });

  it("lists each schedule with its frequency and basis", async () => {
    await renderLibrary();
    expect(screen.getByText("Weekly compressor walkaround")).toBeInTheDocument();
    expect(screen.getAllByText("Every Week").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fixed").length).toBeGreaterThan(0);
  });

  it("shows the next due date and how late an overdue schedule is", async () => {
    await renderLibrary();
    // The seed data carries a schedule 11 days past due.
    expect(screen.getAllByText(/days late/i).length).toBeGreaterThan(0);
  });

  it("hides retired schedules by default, and All brings them back", async () => {
    await renderLibrary();
    expect(screen.queryByText(/vapour degreaser solvent change/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(await screen.findByText(/vapour degreaser solvent change/i)).toBeInTheDocument();
  });

  it("searches across the name, asset and instructions", async () => {
    await renderLibrary();
    await userEvent.type(screen.getByPlaceholderText(/name, asset, instructions/i), "compressor");
    await waitFor(() =>
      expect(screen.queryByText("CMM annual calibration")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Weekly compressor walkaround")).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    await renderLibrary();
    await userEvent.type(screen.getByPlaceholderText(/name, asset, instructions/i), "zzzznothing");
    await waitFor(() =>
      expect(screen.getByText(/no schedules match these filters/i)).toBeInTheDocument(),
    );
  });

  it("keeps the filters in the URL so a view is shareable", async () => {
    await renderLibrary("?q=compressor");
    expect(screen.getByPlaceholderText(/name, asset, instructions/i)).toHaveValue("compressor");
    expect(screen.queryByText("CMM annual calibration")).not.toBeInTheDocument();
  });

  it("retires a schedule with the Active switch rather than deleting it", async () => {
    await renderLibrary();
    // No delete anywhere on this screen — a schedule is retired, never removed.
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();

    const row = screen.getByText("Weekly compressor walkaround").closest("tr") as HTMLElement;
    const toggle = within(row).getByRole("switch");
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);

    await waitFor(async () => {
      const after = (await listScheduledMaintenance()).find(
        (s) => s.title === "Weekly compressor walkaround",
      );
      expect(after?.active).toBe(false);
    }, SLOW);
  });

  it("opens the new-schedule form", async () => {
    await renderLibrary();
    await userEvent.click(screen.getByRole("button", { name: /new schedule/i }));
    expect(
      await screen.findByRole("dialog", { name: /new maintenance schedule/i }),
    ).toBeInTheDocument();
  });

  it("opens the edit form for one schedule", async () => {
    await renderLibrary();
    await userEvent.click(screen.getByRole("button", { name: /edit weekly compressor walkaround/i }));
    expect(
      await screen.findByRole("dialog", { name: /edit maintenance schedule/i }),
    ).toBeInTheDocument();
  });

  it("logs a completion against a schedule from the library", async () => {
    await renderLibrary();
    const row = screen.getByText("Weekly compressor walkaround").closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /log completion/i }));

    const dialog = await screen.findByRole("dialog", { name: /log maintenance/i });
    expect(within(dialog).getByRole("radio", { name: "Skip" })).toBeInTheDocument();
  });

  it("won't offer to log a retired schedule — it has nothing outstanding", async () => {
    await renderLibrary("?state=retired");
    const row = screen.getByText(/vapour degreaser solvent change/i).closest("tr") as HTMLElement;
    expect(within(row).getByRole("button", { name: /log completion/i })).toBeDisabled();
  });

  // =========================================================================
  // The role gates, made visible. Never offer an action the mutation will
  // reject — every gated control is disabled with the reason in its `title`.
  // =========================================================================
  describe("the role gates", () => {
    it("lets a TECH log an occurrence but not touch the schedule itself", async () => {
      maintenanceAccess.value = {
      isTech: true,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    };
      await renderLibrary();

      const newSchedule = screen.getByRole("button", { name: /new schedule/i });
      expect(newSchedule).toBeDisabled();
      expect(newSchedule).toHaveAttribute(
        "title",
        expect.stringContaining("limited to maintenance admins"),
      );

      const row = screen.getByText("Weekly compressor walkaround").closest("tr") as HTMLElement;
      // Logging is theirs.
      expect(within(row).getByRole("button", { name: /log completion/i })).toBeEnabled();
      // Editing and retiring are not.
      expect(
        within(row).getByRole("button", { name: /edit weekly compressor walkaround/i }),
      ).toBeDisabled();
      expect(within(row).getByRole("switch")).toBeDisabled();
    });

    // A row of greyed buttons with no explanation reads as a bug, and a touch
    // user can never reach a `title`.
    it("says why in words, not only in a tooltip", async () => {
      maintenanceAccess.value = {
      isTech: true,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    };
      await renderLibrary();
      expect(screen.getAllByText(/limited to maintenance admins/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Maintenance Roles/).length).toBeGreaterThan(0);
    });

    it("also disables Log completion for somebody with no role at all", async () => {
      maintenanceAccess.value = {
      isTech: false,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    };
      await renderLibrary();
      const row = screen.getByText("Weekly compressor walkaround").closest("tr") as HTMLElement;
      const log = within(row).getByRole("button", { name: /log completion/i });
      expect(log).toBeDisabled();
      expect(log).toHaveAttribute("title", expect.stringContaining("limited to maintenance techs"));
    });

    // A denial rendered and then withdrawn is worse than a beat of silence.
    it("says nothing about permissions while the roles list is still loading", async () => {
      maintenanceAccess.value = { ...{
      isTech: false,
      isAdmin: false,
      enforced: true,
      isResolving: false,
    }, isResolving: true };
      await renderLibrary();
      expect(screen.getByRole("button", { name: /new schedule/i })).toBeDisabled();
      expect(screen.queryByText(/limited to maintenance admins/i)).toBeNull();
    });

    // Lockout safety: with no roles list configured, the library behaves
    // exactly as it did before roles existed.
    it("leaves every control open while gating is unenforced", async () => {
      maintenanceAccess.value = {
        isTech: false,
        isAdmin: false,
        enforced: false,
        isResolving: false,
      };
      await renderLibrary();
      expect(screen.getByRole("button", { name: /new schedule/i })).toBeEnabled();
      const row = screen.getByText("Weekly compressor walkaround").closest("tr") as HTMLElement;
      expect(within(row).getByRole("button", { name: /log completion/i })).toBeEnabled();
      expect(within(row).getByRole("switch")).toBeEnabled();
      expect(screen.queryByText(/limited to maintenance/i)).toBeNull();
    });
  });
});
