import { beforeEach, describe, expect, it, vi } from "vitest";
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
});
