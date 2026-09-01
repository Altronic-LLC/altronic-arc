import { describe, expect, it, vi, beforeEach } from "vitest";

// =============================================================================
// The asset register screen.
//
// Three things this file is really about:
//
//  1. **The gaps are visible and one click from the rows behind them.** That
//     is the reason the screen exists rather than a prettier table — half the
//     live register has no department, and tags, criticality and machine hours
//     are largely blank.
//  2. **Machine hours are a ONE-FIELD action.** A reading nobody updates is a
//     meter PM that never comes due, so the cell itself is the editor.
//  3. **Every write is gated, and reading never is.** Someone without the
//     level can search the whole register and edit nothing, with the reason
//     said out loud — never a control that the mutation would reject.
// =============================================================================

const access = vi.hoisted(() => ({
  value: { isTech: true, isAdmin: true, enforced: true, isResolving: false },
}));
vi.mock("@/hooks/useMaintenanceRoles", () => ({
  useMyMaintenanceRoles: () => access.value,
  useResolveMaintenanceAccess: () => async () => access.value,
}));

const setMachineHours = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ equipment: [] as unknown[], isLoading: false }));

vi.mock("@/hooks/useEquipment", () => ({
  useEquipment: () => ({ data: state.equipment, isLoading: state.isLoading }),
  useSetEquipmentMachineHours: () => ({ mutate: setMachineHours, isPending: false }),
  useUpdateEquipmentFields: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetEquipmentResponsibleTech: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useMaintenanceReferenceLists", () => ({
  useMaintenanceDepartments: () => ({ data: [] }),
  useMaintenanceLocations: () => ({ data: [] }),
}));
vi.mock("@/hooks/useDirectory", () => ({ useDirectoryPeople: () => [] }));

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { makeAsset } from "@/test/maintenanceFixtures";
import type { Equipment } from "@/types/task";
import MaintenanceAssetsView, {
  ASSET_REGISTER_INITIAL_ROWS,
} from "./MaintenanceAssetsView";

const COMPLETE = makeAsset({
  lookupId: 1,
  name: "20 HP COMPRESSOR",
  assetTag: "AC-020",
  currentMachineHours: 1800,
  department: { lookupId: 4, title: "MACH SHOP" },
  location: { lookupId: 31, title: "COMPRESSOR ROOM" },
  criticality: "Critical",
  assetStatus: "In Service",
  equipmentType: "AIRCOMP",
  modifiedAt: new Date("2026-08-20T00:00:00Z"),
});

const NO_HOURS = makeAsset({
  lookupId: 2,
  name: "REFLOW OVEN",
  assetTag: "SMT-002",
  currentMachineHours: null,
  department: { lookupId: 8, title: "SMT" },
  location: { lookupId: 32, title: "SURFACE MOUNT AREA" },
  criticality: "Critical",
  assetStatus: "In Service",
});

const NO_DEPARTMENT = makeAsset({
  lookupId: 3,
  name: "FADAL 6030",
  assetTag: "MS-011",
  currentMachineHours: 400,
  department: null,
  location: { lookupId: 33, title: "FADAL 6030" },
  criticality: "Important",
  assetStatus: "In Service",
});

function render(equipment: Equipment[] = [COMPLETE, NO_HOURS, NO_DEPARTMENT]) {
  state.equipment = equipment;
  return renderWithProviders(<MaintenanceAssetsView />, {
    route: "/operations/maintenance/assets",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  access.value = { isTech: true, isAdmin: true, enforced: true, isResolving: false };
  state.isLoading = false;
});

describe("the register", () => {
  it("lists every asset with its nameplate columns", () => {
    render();
    expect(screen.getByRole("link", { name: "20 HP COMPRESSOR" })).toBeInTheDocument();
    expect(screen.getByText("AC-020")).toBeInTheDocument();
    expect(screen.getByText("MACH SHOP")).toBeInTheDocument();
    expect(screen.getByText("Showing 3 of 3")).toBeInTheDocument();
  });

  it("links each row to its asset detail page", () => {
    render();
    expect(screen.getByRole("link", { name: "20 HP COMPRESSOR" })).toHaveAttribute(
      "href",
      "/operations/maintenance/asset/1",
    );
  });

  // The cap is on RENDERING only — the count above it still describes the
  // whole filtered set (CLAUDE.md, "Big lists cap what's RENDERED").
  // `fireEvent`, not `userEvent`, and a generous timeout: re-rendering 170 rows
  // in jsdom is slow enough under a full parallel suite that userEvent's
  // per-pointer-event ticks blow the default 5s. The behaviour under test is a
  // plain click, so there is nothing userEvent buys here.
  it("caps the rendered rows and offers a Show all", async () => {
    const many = Array.from({ length: ASSET_REGISTER_INITIAL_ROWS + 20 }, (_, i) =>
      makeAsset({ lookupId: i + 1, name: `ASSET ${String(i + 1).padStart(4, "0")}` }),
    );
    render(many);
    expect(screen.getByText(`Showing ${ASSET_REGISTER_INITIAL_ROWS} of ${many.length}`)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ASSET 0170" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `Show all ${many.length}` }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "ASSET 0170" })).toBeInTheDocument(),
    );
  }, 30_000);
});

describe("the needs-attention affordance", () => {
  // Counts are over the WHOLE register, never the filtered view — "1 with no
  // department" has to mean the same thing before and after somebody narrows.
  it("counts the gaps and names each one", () => {
    render();
    expect(screen.getByRole("button", { name: /Needs attention \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No machine hours (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No department (1)" })).toBeInTheDocument();
  });

  it("is one click from the count to the rows behind it", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "No department (1)" }));
    expect(screen.getByText("Showing 1 of 1 (3 in the register)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "FADAL 6030" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "20 HP COMPRESSOR" })).not.toBeInTheDocument();
  });

  it("filters to every incomplete row at once", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: /Needs attention \(2\)/ }));
    expect(screen.getByText("Showing 2 of 2 (3 in the register)")).toBeInTheDocument();
  });

  it("badges the row itself, so a gap is visible without filtering for it", () => {
    render();
    const row = screen.getByRole("link", { name: "REFLOW OVEN" }).closest("tr")!;
    expect(within(row).getByText("No machine hours")).toBeInTheDocument();
  });

  it("says so plainly when nothing is missing", () => {
    render([COMPLETE]);
    expect(
      screen.getByText(/Every active asset has a department, location, tag/),
    ).toBeInTheDocument();
  });

  // A machine that has left the plant needs nothing chased, and permanent
  // un-fixable rows are how a queue stops being looked at.
  it("leaves a RETIRED asset out of the count entirely", () => {
    render([COMPLETE, makeAsset({ lookupId: 9, name: "OLD DEGREASER", assetStatus: "Retired" })]);
    expect(screen.getByRole("button", { name: /Needs attention \(0\)/ })).toBeInTheDocument();
  });
});

describe("machine hours as a one-field action", () => {
  it("shows a missing reading as a fact, not an empty cell", () => {
    render();
    expect(screen.getByText("Never recorded")).toBeInTheDocument();
  });

  it("records a reading from the cell, with no form to open", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Machine hours for REFLOW OVEN" }));
    const input = screen.getByRole("textbox", { name: "Machine hours for REFLOW OVEN" });
    await userEvent.type(input, "5120{Enter}");
    expect(setMachineHours).toHaveBeenCalledWith({ lookupId: 2, hours: 5120 });
  });

  it("refuses something that isn't a number rather than writing a guess", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Machine hours for REFLOW OVEN" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Machine hours for REFLOW OVEN" }),
      "about 5000{Enter}",
    );
    expect(setMachineHours).not.toHaveBeenCalled();
    expect(screen.getByText("Number, or blank")).toBeInTheDocument();
  });

  it("writes nothing when the reading is unchanged", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Machine hours for 20 HP COMPRESSOR" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Machine hours for 20 HP COMPRESSOR" }),
      "{Enter}",
    );
    expect(setMachineHours).not.toHaveBeenCalled();
  });

  it("abandons the edit on Escape", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Machine hours for REFLOW OVEN" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Machine hours for REFLOW OVEN" }),
      "999{Escape}",
    );
    expect(setMachineHours).not.toHaveBeenCalled();
    expect(screen.getByText("Never recorded")).toBeInTheDocument();
  });
});

describe("searching and filtering", () => {
  it("finds an asset by its serial, not just its name", async () => {
    render([
      makeAsset({ lookupId: 1, name: "20 HP COMPRESSOR", serialNo: "J3855U91F" }),
      makeAsset({ lookupId: 2, name: "REFLOW OVEN", serialNo: "HL-1091" }),
    ]);
    await userEvent.type(screen.getByPlaceholderText(/Search name, tag, serial/i), "J3855U91F");
    expect(await screen.findByText("Showing 1 of 1 (2 in the register)")).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    render();
    await userEvent.type(screen.getByPlaceholderText(/Search name, tag, serial/i), "zzzznotathing");
    expect(await screen.findByText("No assets match those filters.")).toBeInTheDocument();
  });
});

describe("gating", () => {
  it("lets a maintenance admin edit", () => {
    render();
    expect(screen.getByRole("button", { name: "Edit 20 HP COMPRESSOR" })).toBeEnabled();
  });

  // Never offer an action the mutation will reject.
  it("disables every write for somebody without the level, and says why", () => {
    access.value = { isTech: true, isAdmin: false, enforced: true, isResolving: false };
    render();
    expect(screen.getByRole("button", { name: "Edit 20 HP COMPRESSOR" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Machine hours for REFLOW OVEN" }),
    ).toBeDisabled();
    expect(screen.getByText(/limited to maintenance admins/i)).toBeInTheDocument();
  });

  // Reading is open to anyone signed in — everybody has to be able to look a
  // machine up, and hiding the register would only make the CMMS unusable.
  it("still lists and searches the register for them", () => {
    access.value = { isTech: false, isAdmin: false, enforced: true, isResolving: false };
    render();
    expect(screen.getByRole("link", { name: "20 HP COMPRESSOR" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search name, tag, serial/i)).toBeEnabled();
  });

  // A denial taken back a moment later is worse than a beat of silence.
  it("shows NO denial while the roles list is still loading", () => {
    access.value = { isTech: false, isAdmin: false, enforced: true, isResolving: true };
    render();
    expect(screen.queryByText(/limited to maintenance admins/i)).not.toBeInTheDocument();
  });

  // Lockout safety: an unconfigured roles list means everyone keeps what they
  // can do today.
  it("lets everyone edit when role gating is not enforced", () => {
    access.value = { isTech: false, isAdmin: false, enforced: false, isResolving: false };
    render();
    expect(screen.getByRole("button", { name: "Edit 20 HP COMPRESSOR" })).toBeEnabled();
    expect(screen.queryByText(/limited to maintenance admins/i)).not.toBeInTheDocument();
  });
});

describe("what is deliberately absent", () => {
  // An asset row exists because the plant bought a machine, and deleting one
  // orphans every work order pointing at it. Retiring is the status.
  it("offers no create and no delete anywhere on the screen", () => {
    render();
    expect(screen.queryByRole("button", { name: /new asset|add asset/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete|remove/i })).not.toBeInTheDocument();
    expect(screen.getByText(/an asset is never deleted/i)).toBeInTheDocument();
  });
});
