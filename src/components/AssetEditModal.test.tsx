import { describe, expect, it, vi, beforeEach } from "vitest";

// =============================================================================
// The asset edit modal.
//
// What is worth pinning here is the WRITE, not the layout: only the columns
// that changed are sent, Responsible Tech goes through its own person-column
// mutation rather than the generic field patch, a save that changed nothing
// writes nothing at all, and the whole form is inert without the maintenance
// admin level.
//
// There is no create and no delete, here or in the API — an asset exists
// because the plant bought a machine, and deleting one orphans every work
// order pointing at it.
// =============================================================================

const access = vi.hoisted(() => ({
  value: { isTech: true, isAdmin: true, enforced: true, isResolving: false },
}));
vi.mock("@/hooks/useMaintenanceRoles", () => ({
  useMyMaintenanceRoles: () => access.value,
  useResolveMaintenanceAccess: () => async () => access.value,
}));

const updateFields = vi.hoisted(() => vi.fn(async () => ({})));
const setTech = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/hooks/useEquipment", () => ({
  useUpdateEquipmentFields: () => ({ mutateAsync: updateFields, isPending: false }),
  useSetEquipmentResponsibleTech: () => ({ mutateAsync: setTech, isPending: false }),
}));

vi.mock("@/hooks/useMaintenanceReferenceLists", () => ({
  useMaintenanceDepartments: () => ({
    data: [
      { lookupId: 4, title: "MACH SHOP", active: true, note: "" },
      { lookupId: 9, title: "QC", active: true, note: "" },
      // Retired: offered only to a row that already points at it.
      { lookupId: 12, title: "Q.C.", active: false, note: "" },
    ],
  }),
  useMaintenanceLocations: () => ({
    data: [{ lookupId: 31, title: "COMPRESSOR ROOM", active: true, note: "" }],
  }),
}));

vi.mock("@/hooks/useDirectory", () => ({
  useDirectoryPeople: () => [
    { lookupId: 11, displayName: "Kim Tech", email: "kim@altronic-llc.com" },
  ],
}));

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { makeAsset } from "@/test/maintenanceFixtures";
import type { Equipment } from "@/types/task";
import { AssetEditModal } from "./AssetEditModal";

const ASSET = makeAsset({
  lookupId: 1,
  name: "20 HP COMPRESSOR",
  assetTag: "AC-020",
  currentMachineHours: 1800,
  department: { lookupId: 4, title: "MACH SHOP" },
  location: { lookupId: 31, title: "COMPRESSOR ROOM" },
  criticality: "Critical",
  assetStatus: "In Service",
});

const onClose = vi.fn();

function render(asset: Equipment = ASSET) {
  return renderWithProviders(<AssetEditModal asset={asset} onClose={onClose} />);
}

async function save() {
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  access.value = { isTech: true, isAdmin: true, enforced: true, isResolving: false };
});

describe("the write", () => {
  it("sends only the column that changed", async () => {
    render();
    const tag = screen.getByLabelText(/^Asset Tag/);
    await userEvent.clear(tag);
    await userEvent.type(tag, "AC-021");
    await save();
    expect(updateFields).toHaveBeenCalledWith({
      lookupId: 1,
      fields: { AssetTag: "AC-021" },
    });
  });

  // A no-op save must not stamp Modified — the register's "last edited"
  // column is the only staleness signal it has, and a save that changed
  // nothing making a row look fresh would break it.
  it("writes nothing at all when nothing changed", async () => {
    render();
    await save();
    expect(updateFields).not.toHaveBeenCalled();
    expect(setTech).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("records the hourmeter reading as a number", async () => {
    render();
    const hours = screen.getByLabelText(/^Current Machine Hours/);
    await userEvent.clear(hours);
    await userEvent.type(hours, "5120");
    await save();
    expect(updateFields).toHaveBeenCalledWith({
      lookupId: 1,
      fields: { CurrentMachineHours: 5120 },
    });
  });

  // Blank is a deliberate clear ("that number was wrong"), and it is NOT zero
  // — the same distinction the column itself carries.
  it("clears the reading when the box is emptied, rather than writing zero", async () => {
    render();
    await userEvent.clear(screen.getByLabelText(/^Current Machine Hours/));
    await save();
    expect(updateFields).toHaveBeenCalledWith({
      lookupId: 1,
      fields: { CurrentMachineHours: null },
    });
  });

  it("refuses a machine-hours value that isn't a number, and stays open", async () => {
    render();
    const hours = screen.getByLabelText(/^Current Machine Hours/);
    await userEvent.clear(hours);
    await userEvent.type(hours, "about 5000");
    await save();
    expect(updateFields).not.toHaveBeenCalled();
    expect(screen.getByText(/has to be a number/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses an empty name", async () => {
    render();
    await userEvent.clear(screen.getByLabelText(/^Name/));
    await save();
    expect(updateFields).not.toHaveBeenCalled();
    expect(screen.getByText("An asset needs a name.")).toBeInTheDocument();
  });

  // A single-person column needs its own resolution against the PMO site's
  // user list before a write, which is why it never goes through the generic
  // field patch.
  it("saves Responsible Tech through its own mutation, not the field patch", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Responsible Tech" }));
    await userEvent.click(await screen.findByRole("option", { name: /Kim Tech/ }));
    await save();
    expect(setTech).toHaveBeenCalledWith({
      lookupId: 1,
      person: expect.objectContaining({ displayName: "Kim Tech" }),
    });
    expect(updateFields).not.toHaveBeenCalled();
  });

  it("writes a department as a bare lookupId", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Department" }));
    await userEvent.click(await screen.findByRole("option", { name: /^QC/ }));
    await save();
    expect(updateFields).toHaveBeenCalledWith({
      lookupId: 1,
      fields: { DepartmentRefLookupId: 9 },
    });
  });
});

describe("the reference pickers", () => {
  // A row pointing at a retired value keeps it in its own picker: dropping it
  // would quietly clear the field on the next save.
  it("keeps a RETIRED department the asset already points at", async () => {
    render(makeAsset({ ...ASSET, department: { lookupId: 12, title: "Q.C." } }));
    await userEvent.click(screen.getByRole("button", { name: "Department" }));
    expect(await screen.findByRole("option", { name: /Q\.C\. \(retired\)/ })).toBeInTheDocument();
  });

  it("doesn't offer a retired value to a row that doesn't hold it", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Department" }));
    await screen.findByRole("option", { name: /^QC/ });
    expect(screen.queryByRole("option", { name: /retired/ })).not.toBeInTheDocument();
  });
});

describe("gating", () => {
  it("locks every field and the Save button without the level, and says why", () => {
    access.value = { isTech: true, isAdmin: false, enforced: true, isResolving: false };
    render();
    expect(screen.getByLabelText(/^Asset Tag/)).toBeDisabled();
    expect(screen.getByLabelText(/^Name/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByText(/limited to maintenance admins/i)).toBeInTheDocument();
  });

  // A denial taken back a moment later is worse than a beat of silence.
  it("shows no denial while the roles list is still loading", () => {
    access.value = { isTech: false, isAdmin: false, enforced: true, isResolving: true };
    render();
    expect(screen.queryByText(/limited to maintenance admins/i)).not.toBeInTheDocument();
  });

  it("leaves everything editable when role gating is not enforced", () => {
    access.value = { isTech: false, isAdmin: false, enforced: false, isResolving: false };
    render();
    expect(screen.getByLabelText(/^Asset Tag/)).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });
});

describe("what is deliberately absent", () => {
  it("offers no delete — retiring is a status, not a removal", () => {
    render();
    expect(screen.queryByRole("button", { name: /delete|remove/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Retired is how an asset leaves the register/)).toBeInTheDocument();
  });
});
