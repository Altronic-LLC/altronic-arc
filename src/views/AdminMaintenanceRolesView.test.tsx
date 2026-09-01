import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// Mirrors AdminEirRolesView.test.tsx — the screen it is a copy of.

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  isResolving: false,
  entries: [] as Array<{
    id: number;
    email: string;
    displayName: string;
    roles: string[];
    note: string;
  }>,
  isLoading: false,
  add: {
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    error: null as unknown,
    reset: vi.fn(),
  },
  update: { mutate: vi.fn(), isPending: false, error: null as unknown },
  remove: { mutate: vi.fn(), isPending: false, error: null as unknown },
  directory: [] as Array<{ displayName: string; email?: string }>,
  admins: [] as Array<{ displayName: string; email: string }>,
}));

vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => mocks.isAdmin,
  useAdminAccess: () => ({ isAdmin: mocks.isAdmin, isResolving: mocks.isResolving }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com" }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));
vi.mock("@/hooks/useMaintenanceRoles", () => ({
  useMaintenanceRoles: () => ({ data: mocks.entries, isLoading: mocks.isLoading }),
  useAddMaintenanceRole: () => mocks.add,
  useUpdateMaintenanceRole: () => mocks.update,
  useRemoveMaintenanceRole: () => mocks.remove,
}));
vi.mock("@/hooks/useDirectory", () => ({ useDirectoryPeople: () => mocks.directory }));
vi.mock("@/hooks/useAdmins", () => ({ useAdmins: () => ({ data: mocks.admins }) }));

import { AdminMaintenanceRolesView } from "./AdminMaintenanceRolesView";

const TECH_ROW = {
  id: 1,
  email: "david.bulkley@altronic-llc.com",
  displayName: "David Bulkley",
  roles: ["tech"],
  note: "Second shift",
};
const ADMIN_ROW = {
  id: 2,
  email: "ray.white@altronic-llc.com",
  displayName: "Ray White",
  roles: ["admin"],
  note: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdmin = true;
  mocks.isResolving = false;
  mocks.isLoading = false;
  mocks.entries = [];
  mocks.directory = [
    { displayName: "Alyssa Garrett", email: "alyssa.garrett@altronic-llc.com" },
    { displayName: "David Bulkley", email: "david.bulkley@altronic-llc.com" },
  ];
  mocks.admins = [];
  mocks.add.isPending = false;
  mocks.add.error = null;
  mocks.update.isPending = false;
  mocks.update.error = null;
  mocks.remove.isPending = false;
  mocks.remove.error = null;
});

/**
 * The modal's own submit button. The page header carries an "Add user" button
 * too, so an unscoped query finds both.
 */
function modalSubmit(): HTMLElement {
  const modal = screen
    .getByText(/Add user to Maintenance Roles/i)
    .closest("div") as HTMLElement;
  return within(modal).getByRole("button", { name: /^add user$/i });
}

function render() {
  return renderWithProviders(<AdminMaintenanceRolesView />, {
    route: "/admin/maintenance-roles",
  });
}

describe("AdminMaintenanceRolesView", () => {
  it("says what each role unlocks, on the page rather than in a tooltip", () => {
    render();
    expect(screen.getByRole("heading", { name: /maintenance roles/i })).toBeInTheDocument();
    expect(screen.getByText(/Can complete work orders/i)).toBeInTheDocument();
    expect(screen.getByText(/creating \/ editing \/ retiring PM schedules/i)).toBeInTheDocument();
  });

  // Both are lockout-safety facts an admin needs stated, not inferred.
  it("says Admin outranks Tech, and that ARC admins always count", () => {
    render();
    expect(screen.getByText(/Admin outranks Tech/i)).toBeInTheDocument();
    expect(screen.getByText(/ARC admins.*always count/i)).toBeInTheDocument();
  });

  it("lists each tagged user with their tags ticked", () => {
    mocks.entries = [TECH_ROW, ADMIN_ROW];
    render();
    const row = screen.getByText("David Bulkley").closest("tr") as HTMLElement;
    const boxes = within(row).getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked(); // Tech
    expect(boxes[1]).not.toBeChecked(); // Admin
    expect(within(row).getByText("Second shift")).toBeInTheDocument();
  });

  it("marks the signed-in user's own row", () => {
    mocks.entries = [
      { ...TECH_ROW, id: 3, email: "demo.user@altronic-llc.com", displayName: "Demo User" },
    ];
    render();
    expect(screen.getByText("you")).toBeInTheDocument();
  });

  it("toggles a tag on, keeping the ones already held", async () => {
    mocks.entries = [TECH_ROW];
    render();
    const row = screen.getByText("David Bulkley").closest("tr") as HTMLElement;
    await userEvent.click(within(row).getAllByRole("checkbox")[1]!);
    expect(mocks.update.mutate).toHaveBeenCalledWith({ id: 1, roles: ["tech", "admin"] });
  });

  it("toggles a tag off", async () => {
    mocks.entries = [TECH_ROW];
    render();
    const row = screen.getByText("David Bulkley").closest("tr") as HTMLElement;
    await userEvent.click(within(row).getAllByRole("checkbox")[0]!);
    expect(mocks.update.mutate).toHaveBeenCalledWith({ id: 1, roles: [] });
  });

  // Roles are matched on ADDRESS. A display name typed into the Title column
  // errors nowhere and grants nothing — the person just reports that their role
  // "isn't working" — so this screen is the one place it can be spotted.
  it("flags a row whose Title is a name rather than an email", () => {
    mocks.entries = [{ id: 5, email: "David Bulkley", displayName: "", roles: ["tech"], note: "" }];
    render();
    expect(screen.getByText("not an email")).toBeInTheDocument();
  });

  it("does not flag a real address", () => {
    mocks.entries = [TECH_ROW];
    render();
    expect(screen.queryByText("not an email")).toBeNull();
  });

  it("derives a readable name when Display Name is blank", () => {
    mocks.entries = [{ ...TECH_ROW, displayName: "" }];
    render();
    expect(screen.getByText("David Bulkley")).toBeInTheDocument();
  });

  it("says nobody is tagged rather than showing an empty table", () => {
    render();
    expect(screen.getByText(/Nobody tagged yet/i)).toBeInTheDocument();
  });

  it("adds a user with the tags picked in the modal", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: /add user/i }));
    // Manual entry: the directory-picker path needs the searchable dropdown,
    // and the escape hatch is what has to work when the directory is empty.
    await userEvent.click(screen.getByRole("button", { name: /enter an email manually/i }));
    await userEvent.type(
      screen.getByPlaceholderText("someone@altronic-llc.com"),
      "New.Tech@altronic-llc.com",
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /tech/i }));
    await userEvent.click(modalSubmit());

    expect(mocks.add.mutateAsync).toHaveBeenCalledWith({
      // Lowercased on the way in, so the stored value matches what the gate
      // looks up.
      email: "new.tech@altronic-llc.com",
      displayName: "",
      roles: ["tech"],
      note: "",
    });
  });

  // A second row for the same person is a duplicate that silently does
  // nothing: `useMyMaintenanceRoles` only ever reads the FIRST match.
  it("refuses to add somebody who is already on the list", async () => {
    mocks.entries = [TECH_ROW];
    render();
    await userEvent.click(screen.getByRole("button", { name: /add user/i }));
    await userEvent.click(screen.getByRole("button", { name: /enter an email manually/i }));
    await userEvent.type(
      screen.getByPlaceholderText("someone@altronic-llc.com"),
      TECH_ROW.email,
    );
    expect(screen.getByText(/already on the list/i)).toBeInTheDocument();
    expect(modalSubmit()).toBeDisabled();
  });

  it("removes a user after confirming", async () => {
    mocks.entries = [TECH_ROW];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render();
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(mocks.remove.mutate).toHaveBeenCalledWith(1);
    confirm.mockRestore();
  });

  it("does not remove when the confirm is dismissed", async () => {
    mocks.entries = [TECH_ROW];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render();
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(mocks.remove.mutate).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("surfaces a failed update or remove rather than swallowing it", () => {
    mocks.entries = [TECH_ROW];
    mocks.update.error = new Error("Graph 403 Forbidden");
    mocks.remove.error = new Error("Graph 404 Not Found");
    render();
    expect(screen.getByText(/Couldn't update roles: Graph 403/)).toBeInTheDocument();
    expect(screen.getByText(/Couldn't remove user: Graph 404/)).toBeInTheDocument();
  });

  it("shows the one loading screen while the list loads", () => {
    mocks.isLoading = true;
    render();
    // LoadingTasks' verb + noun headline — the shared loading screen, never a
    // bespoke spinner. Matched loosely on the verb because it rotates.
    expect(screen.getByText(/\w+ maintenance roles$/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nobody tagged yet/i)).toBeNull();
  });

  describe("access", () => {
    it("tells a non-admin they need access", () => {
      mocks.isAdmin = false;
      render();
      expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /add user/i })).toBeNull();
    });

    // A flash of a false denial is worse than a spinner — the Admins list
    // loads asynchronously, so a real admin reads as "not an admin" for a beat.
    it("waits rather than denying while the Admins list is still settling", () => {
      mocks.isAdmin = false;
      mocks.isResolving = true;
      render();
      expect(screen.queryByText(/Admin access required/i)).toBeNull();
    });
  });
});
