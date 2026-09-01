import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { MaintenanceAccess } from "@/lib/maintenanceRoles";

// =============================================================================
// Maintenance → Departments & Locations.
//
// Moved out of /admin/* and into the maintenance module, gated ONLY by
// manageAssetsGate (2026-09-01) — matching MaintenanceAssetsView's read-open /
// write-disabled pattern rather than blocking the whole page.
//
// Three things this screen has to get right, each of which would be a data
// problem rather than a cosmetic one:
//
//  1. **No delete anywhere.** Retiring is the only way off a picker, because
//     hundreds of records point at these rows.
//  2. **Retired values stay findable**, so "why does this asset say Q.C.?" is
//     answerable.
//  3. **Near-duplicates are FLAGGED, never merged** — the seeded Locations
//     list holds "Q.C." beside "QC" and a literal "-".
// =============================================================================

const access = vi.hoisted(() => ({
  value: { isTech: true, isAdmin: true, enforced: true, isResolving: false } as MaintenanceAccess,
}));

vi.mock("@/hooks/useMaintenanceRoles", () => ({
  useMyMaintenanceRoles: () => access.value,
  useResolveMaintenanceAccess: () => async () => access.value,
}));

const mocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({})),
  update: vi.fn(async () => ({})),
  setActive: vi.fn(async () => ({})),
  departments: [
    { lookupId: 4, title: "MACH SHOP", active: true, note: "The machine shop" },
    { lookupId: 6, title: "PROD", active: true, note: "" },
  ],
  locations: [
    { lookupId: 1, title: "-", active: true, note: "" },
    { lookupId: 46, title: "Q.C.", active: true, note: "" },
    { lookupId: 48, title: "QC", active: true, note: "" },
    { lookupId: 22, title: "HARNESS DEPARMENT", active: false, note: "" },
  ],
}));

vi.mock("@/hooks/useMaintenanceReferenceLists", () => ({
  useMaintenanceReferenceValues: (kind: "departments" | "locations") => ({
    data: kind === "departments" ? mocks.departments : mocks.locations,
    isLoading: false,
  }),
  useCreateMaintenanceReferenceValue: () => ({
    mutate: mocks.create,
    mutateAsync: mocks.create,
    isPending: false,
  }),
  useUpdateMaintenanceReferenceValue: () => ({ mutate: mocks.update, isPending: false }),
  useSetMaintenanceReferenceValueActive: () => ({ mutate: mocks.setActive, isPending: false }),
}));

import MaintenanceReferenceListsView from "./MaintenanceReferenceListsView";

function render() {
  return renderWithProviders(<MaintenanceReferenceListsView />);
}

beforeEach(() => {
  vi.clearAllMocks();
  access.value = { isTech: true, isAdmin: true, enforced: true, isResolving: false };
});

describe("access", () => {
  // Reading is open to anyone signed in — this screen never blocks the whole
  // page, it only greys the write controls. Mirrors MaintenanceAssetsView.
  it("still shows the lists to a tech who is not a maintenance admin, with writes disabled", () => {
    access.value = { isTech: true, isAdmin: false, enforced: true, isResolving: false };
    render();
    expect(screen.getByText("MACH SHOP")).toBeInTheDocument();
    expect(screen.getByText(/limited to maintenance admins/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeDisabled();
  });

  // A real admin reads as untagged for a beat on first paint. Taking access
  // away and then handing it back a moment later is worse than staying quiet.
  it("says nothing about access while the roles list is still loading", () => {
    access.value = { isTech: false, isAdmin: false, enforced: true, isResolving: true };
    render();
    expect(screen.queryByText(/limited to maintenance admins/i)).toBeNull();
  });

  it("lets a maintenance admin write, with no notice shown", async () => {
    render();
    expect(screen.getByRole("heading", { name: /departments.*locations/i })).toBeInTheDocument();
    expect(screen.queryByText(/limited to maintenance admins/i)).toBeNull();
    expect(screen.getByPlaceholderText(/MACH SHOP/)).not.toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/MACH SHOP/), "TOOL ROOM");
    expect(screen.getByRole("button", { name: /^Add$/ })).not.toBeDisabled();
  });
});

describe("the two lists", () => {
  it("opens on Departments and switches to Locations", async () => {
    render();
    expect(screen.getByText("MACH SHOP")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Locations" }));
    expect(screen.getByText("Q.C.")).toBeInTheDocument();
    expect(screen.queryByText("MACH SHOP")).toBeNull();
  });

  it("shows a value's note under it", () => {
    render();
    expect(screen.getByText("The machine shop")).toBeInTheDocument();
  });
});

describe("adding a value", () => {
  // The whole reason these are lookup lists: adding a value is a list-item
  // write, which ARC's Sites.Selected grant already allows.
  it("adds one to the list currently open", async () => {
    render();
    await userEvent.type(screen.getByPlaceholderText(/MACH SHOP/), "TOOL ROOM");
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        kind: "departments",
        input: { title: "TOOL ROOM" },
      }),
    );
  });

  it("adds to Locations once that tab is open", async () => {
    render();
    await userEvent.click(screen.getByRole("tab", { name: "Locations" }));
    await userEvent.type(screen.getByPlaceholderText(/COMPRESSOR ROOM/), "BAY 4");
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({ kind: "locations", input: { title: "BAY 4" } }),
    );
  });

  it("won't add a blank", async () => {
    render();
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeDisabled();
  });

  it("disables Add for a non-admin, even with text typed", async () => {
    access.value = { isTech: true, isAdmin: false, enforced: true, isResolving: false };
    render();
    expect(screen.getByPlaceholderText(/MACH SHOP/)).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeDisabled();
  });
});

describe("renaming", () => {
  // A lookup rename carries every record pointing at it — under the old choice
  // column, fixing a typo meant editing the column definition AND every row.
  it("renames a value in place", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: /rename MACH SHOP/i }));
    const input = screen.getByRole("textbox", { name: /rename MACH SHOP/i });
    await userEvent.clear(input);
    await userEvent.type(input, "MACHINE SHOP");
    await userEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(mocks.update).toHaveBeenCalledWith({
      kind: "departments",
      lookupId: 4,
      input: { title: "MACHINE SHOP" },
    });
  });

  it("does not write when the name is unchanged, or the edit is cancelled", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: /rename MACH SHOP/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("disables Rename for a non-admin", () => {
    access.value = { isTech: true, isAdmin: false, enforced: true, isResolving: false };
    render();
    expect(screen.getByRole("button", { name: /rename MACH SHOP/i })).toBeDisabled();
  });
});

describe("retiring — what 'delete' means here", () => {
  it("offers no delete anywhere", () => {
    render();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("retires a value, and says records already using it keep showing it", async () => {
    render();
    const retire = screen.getByRole("button", { name: /retire MACH SHOP/i });
    expect(retire).toHaveAttribute("title", expect.stringMatching(/keep showing it/i));
    await userEvent.click(retire);
    expect(mocks.setActive).toHaveBeenCalledWith({
      kind: "departments",
      lookupId: 4,
      active: false,
    });
  });

  it("disables Retire for a non-admin", () => {
    access.value = { isTech: true, isAdmin: false, enforced: true, isResolving: false };
    render();
    expect(screen.getByRole("button", { name: /retire MACH SHOP/i })).toBeDisabled();
  });

  it("keeps retired values findable, and restorable", async () => {
    render();
    await userEvent.click(screen.getByRole("tab", { name: "Locations" }));
    // Collapsed by default — but never hidden: somebody has to be able to
    // answer "why does this asset still say HARNESS DEPARMENT?".
    const toggle = screen.getByRole("button", { name: /retired \(1\)/i });
    expect(screen.queryByText("HARNESS DEPARMENT")).toBeNull();
    await userEvent.click(toggle);
    expect(screen.getByText("HARNESS DEPARMENT")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /restore HARNESS DEPARMENT/i }));
    expect(mocks.setActive).toHaveBeenCalledWith({ kind: "locations", lookupId: 22, active: true });
  });

  it("counts only the active values in the in-use heading", async () => {
    render();
    await userEvent.click(screen.getByRole("tab", { name: "Locations" }));
    expect(screen.getByText(/in use \(3\)/i)).toBeInTheDocument();
  });
});

describe("duplicate hints", () => {
  // Flagged, never merged: which of a pair survives, and what happens to the
  // rows pointing at the other, is a judgement about real data.
  it("flags Q.C. and QC as looking like each other", async () => {
    render();
    await userEvent.click(screen.getByRole("tab", { name: "Locations" }));
    const hints = screen.getAllByText(/looks like a duplicate of/i);
    expect(hints).toHaveLength(2);
    expect(hints[0].textContent).toMatch(/"QC"/);
    expect(hints[1].textContent).toMatch(/"Q\.C\."/);
    // And it says out loud that it has done nothing about it.
    expect(hints[0].textContent).toMatch(/nothing is merged automatically/i);
  });

  it("does NOT flag the punctuation-only value against anything", async () => {
    render();
    await userEvent.click(screen.getByRole("tab", { name: "Locations" }));
    const row = screen.getByText("-").closest("div") as HTMLElement;
    expect(within(row).queryByText(/looks like a duplicate/i)).toBeNull();
  });

  it("flags nothing on a clean list", () => {
    render();
    expect(screen.queryByText(/looks like a duplicate/i)).toBeNull();
  });
});
