import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
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

// Pinned OFF, so the "before it goes live" case doesn't depend on whether
// this machine's .env.local sets VITE_PARTS_LIST_LIVE. The live case is
// Header.partsListLive.test.tsx.
vi.mock("@/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/config")>();
  return { ...actual, PARTS_LIST_LIVE: false };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

const teradyne = APPS.find((a) => a.label === "Teradyne Log")!;

afterEach(() => {
  // Unmount BEFORE resetting the store: this afterEach runs ahead of the
  // setup file's cleanup(), so a reset here would re-render whatever is still
  // mounted outside act().
  cleanup();
  clearAccessDenials();
});

async function openDepartments() {
  const user = userEvent.setup();
  renderWithProviders(<Header />);
  await user.click(screen.getAllByRole("button", { name: /Departments|Depts/ })[0]);
  return user;
}

describe("Departments menu — the Parts List before it goes live", () => {
  it("reads Soon and isn't a link — testers go by URL until VITE_PARTS_LIST_LIVE", async () => {
    await openDepartments();
    const label = screen.getByText("Parts List");
    expect(label.closest("a")).toBeNull();
    expect(label.parentElement).toHaveTextContent(/Soon/);
  });
});

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
