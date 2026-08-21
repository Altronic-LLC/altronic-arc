import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  entries: [] as Array<{
    id: number;
    email: string;
    displayName: string;
    roles: string[];
    note: string;
  }>,
  isLoading: false,
  add: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false, error: null as unknown, reset: vi.fn() },
  update: { mutate: vi.fn(), isPending: false, error: null as unknown },
  remove: { mutate: vi.fn(), isPending: false, error: null as unknown },
  directory: [] as Array<{ displayName: string; email?: string }>,
  admins: [] as Array<{ displayName: string; email: string }>,
}));

vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => mocks.isAdmin }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com" }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));
vi.mock("@/hooks/useEirRoles", () => ({
  useEirRoles: () => ({ data: mocks.entries, isLoading: mocks.isLoading }),
  useAddEirRole: () => mocks.add,
  useUpdateEirRole: () => mocks.update,
  useRemoveEirRole: () => mocks.remove,
}));
// The "Add user" picker offers people already known to the system, so both
// sources are stubbed. `directory` is emptied in one test to prove the
// manual-email escape hatch still works when the tenant read degrades to [].
vi.mock("@/hooks/useDirectory", () => ({
  useDirectoryPeople: () => mocks.directory,
}));
vi.mock("@/hooks/useAdmins", () => ({
  useAdmins: () => ({ data: mocks.admins }),
}));

import { AdminEirRolesView } from "./AdminEirRolesView";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdmin = true;
  mocks.isLoading = false;
  mocks.entries = [];
  mocks.directory = [
    { displayName: "New Person", email: "new.person@altronic-llc.com" },
    { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" },
  ];
  mocks.admins = [];
});

describe("AdminEirRolesView", () => {
  it("shows a not-authorised notice for non-admins", () => {
    mocks.isAdmin = false;
    renderWithProviders(<AdminEirRolesView />, { route: "/admin/eir-roles" });
    expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
  });

  it("renders a row per tagged user with role checkboxes reflecting their roles", () => {
    mocks.entries = [
      { id: 1, email: "eng@altronic-llc.com", displayName: "Eng User", roles: ["engineer"], note: "" },
    ];
    renderWithProviders(<AdminEirRolesView />, { route: "/admin/eir-roles" });
    expect(screen.getByText("Eng User")).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // [Engineer, Supply Chain] for the single row
    expect(checkboxes[0].checked).toBe(true); // engineer
    expect(checkboxes[1].checked).toBe(false); // supply chain
  });

  it("toggles a role via its checkbox", async () => {
    const user = userEvent.setup();
    mocks.entries = [
      { id: 7, email: "eng@altronic-llc.com", displayName: "Eng User", roles: ["engineer"], note: "" },
    ];
    renderWithProviders(<AdminEirRolesView />, { route: "/admin/eir-roles" });
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]); // add Supply Chain
    expect(mocks.update.mutate).toHaveBeenCalledWith({
      id: 7,
      roles: ["engineer", "supply chain"],
    });
  });

  it("removes a user after confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.entries = [
      { id: 9, email: "sc@altronic-llc.com", displayName: "SC User", roles: ["supply chain"], note: "" },
    ];
    renderWithProviders(<AdminEirRolesView />, { route: "/admin/eir-roles" });
    await user.click(screen.getByRole("button", { name: /Remove/i }));
    expect(mocks.remove.mutate).toHaveBeenCalledWith(9);
  });

  it("adds a user picked from the people search, filling in their email for them", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminEirRolesView />, { route: "/admin/eir-roles" });
    await user.click(screen.getByRole("button", { name: /Add user/i }));

    const dialogHeading = screen.getByText(/Add user to EIR Roles/i);
    expect(dialogHeading).toBeInTheDocument();

    // Open the picker and narrow it by typing — the whole point of the change.
    await user.click(screen.getByRole("button", { name: /search for a person/i }));
    await user.type(screen.getByPlaceholderText(/type a name or email/i), "New Per");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    await user.click(options[0]);

    const modal = dialogHeading.closest("div")!.parentElement!;
    const engineerCheckbox = within(modal).getAllByRole("checkbox")[0];
    await user.click(engineerCheckbox);

    const addButtons = screen.getAllByRole("button", { name: /^Add user$/i });
    await user.click(addButtons[addButtons.length - 1]);

    // Email and display name come from the directory entry, never typed.
    expect(mocks.add.mutateAsync).toHaveBeenCalledWith({
      email: "new.person@altronic-llc.com",
      displayName: "New Person",
      roles: ["engineer"],
      note: "",
    });
  });

  it("does not offer someone who is already on the list", async () => {
    const user = userEvent.setup();
    mocks.entries = [
      {
        id: 3,
        email: "sarah.shaffer@altronic-llc.com",
        displayName: "Sarah Shaffer",
        roles: ["engineer"],
        note: "",
      },
    ];
    renderWithProviders(<AdminEirRolesView />, { route: "/admin/eir-roles" });
    await user.click(screen.getByRole("button", { name: /Add user/i }));
    await user.click(screen.getByRole("button", { name: /search for a person/i }));

    // A duplicate row would be invisible in effect: useMyEirRoles reads the
    // first match only, so the second row's roles would silently do nothing.
    const labels = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(labels.some((l) => l.includes("New Person"))).toBe(true);
    expect(labels.some((l) => l.includes("Sarah Shaffer"))).toBe(false);
  });

  it("still allows a manual email when no people could be loaded", async () => {
    const user = userEvent.setup();
    mocks.directory = [];
    renderWithProviders(<AdminEirRolesView />, { route: "/admin/eir-roles" });
    await user.click(screen.getByRole("button", { name: /Add user/i }));

    // The escape hatch names the reason rather than just offering itself.
    await user.click(screen.getByRole("button", { name: /no people loaded/i }));
    await user.type(
      screen.getByPlaceholderText("someone@altronic-llc.com"),
      "manual.entry@altronic-llc.com",
    );
    const addButtons = screen.getAllByRole("button", { name: /^Add user$/i });
    await user.click(addButtons[addButtons.length - 1]);

    expect(mocks.add.mutateAsync).toHaveBeenCalledWith({
      email: "manual.entry@altronic-llc.com",
      displayName: "",
      roles: [],
      note: "",
    });
  });

  // A row added by hand in SharePoint can end up with a NAME in the Title
  // column. Nothing errors — the person just never matches, and reports that
  // their role doesn't work. Say so where an admin can fix it.
  it("flags a row whose email column holds a name", () => {
    mocks.entries = [
      { id: 1, email: "Steven Pirko", displayName: "Steven Pirko", roles: ["engineer"], note: "" },
      {
        id: 2,
        email: "ray.white@altronic-llc.com",
        displayName: "Ray White",
        roles: ["engineer"],
        note: "",
      },
    ];
    renderWithProviders(<AdminEirRolesView />, { route: "/admin/eir-roles" });
    expect(screen.getAllByText(/not an email/i)).toHaveLength(1);
  });

  it("spells out what each role gates, not just in a tooltip", () => {
    renderWithProviders(<AdminEirRolesView />, { route: "/admin/eir-roles" });
    expect(screen.getByText(/what these roles gate/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Can edit Engineering Response \+ Technical Priority/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Can edit Buyer Code, Risk Part, Risk Part Level \+ LTB Date/i),
    ).toBeInTheDocument();
  });
});
