import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { Header } from "./Header";
import { APPS } from "@/api/appAccess";
import { SITES } from "@/api/config";
import { clearAccessDenials, markListDenied, markSiteDenied } from "@/hooks/useListAccess";

// =============================================================================
// The Departments menu doesn't offer an app the user can't get into.
//
// A locked row, NOT a hidden one: an entry that vanishes reads as ARC having
// lost a feature, and gives the user nothing to ask for. A padlock reads as
// "ask someone", which is the true and actionable version.
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

const teradyne = APPS.find((a) => a.label === "Teradyne Log")!;

afterEach(() => clearAccessDenials());

async function openDepartments() {
  const user = userEvent.setup();
  renderWithProviders(<Header />);
  await user.click(screen.getAllByRole("button", { name: /Departments|Depts/ })[0]);
  return user;
}

describe("Departments menu — refused lists", () => {
  it("links to an app whose list is reachable", async () => {
    await openDepartments();
    expect(screen.getByRole("menuitem", { name: /Teradyne Log/ })).toHaveAttribute(
      "href",
      "/operations/teradyne",
    );
  });

  it("drops the link once that list has been refused", async () => {
    markListDenied(teradyne.lists[0], SITES.pmo);
    await openDepartments();

    expect(screen.queryByRole("menuitem", { name: /Teradyne Log/ })).not.toBeInTheDocument();
    expect(screen.getByText("Teradyne Log")).toBeInTheDocument();
    expect(screen.getByLabelText("No access")).toBeInTheDocument();
  });

  it("locks every app on a site refused outright", async () => {
    markSiteDenied(SITES.panelTeam);
    await openDepartments();

    expect(screen.queryByRole("menuitem", { name: /Panel Orders/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Panel Tasks/ })).not.toBeInTheDocument();
    // …and leaves the rest of the app alone.
    expect(screen.getByRole("menuitem", { name: /EIRs/ })).toBeInTheDocument();
  });

  it("leaves a 'Soon' placeholder reading Soon, not No access", async () => {
    // Both render as a non-link row; they mean different things and must not
    // be collapsed into one state.
    markListDenied(teradyne.lists[0], SITES.pmo);
    await openDepartments();
    expect(screen.getAllByText("Soon").length).toBeGreaterThan(0);
  });
});
