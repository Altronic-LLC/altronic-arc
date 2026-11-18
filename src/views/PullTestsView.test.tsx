import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { resetPullTestMockStore } from "@/api/pullTests";
import { resetPullTestSpecMockStore } from "@/api/pullTestSpecs";
import { MOCK_PULL_SPECS, MOCK_PULL_TESTS } from "@/data/pullTestMockData";
import { parsePullTestYear, PullTestsView } from "./PullTestsView";
import { PullTestSpecsView } from "./PullTestSpecsView";

const adminAccess = vi.hoisted(() => ({ isAdmin: false, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));
// No serial port in jsdom; the form's tester panel just says so.
vi.mock("@/api/mark10Serial", () => ({
  serialSupported: () => false,
  grantedPorts: async () => [],
  choosePort: vi.fn(),
  openTester: vi.fn(),
}));

beforeEach(() => {
  resetPullTestMockStore();
  resetPullTestSpecMockStore();
  adminAccess.isAdmin = false;
});

describe("parsePullTestYear", () => {
  it("reads ?year=, falling back to this year", () => {
    expect(parsePullTestYear("all", 2026)).toEqual({ kind: "all" });
    expect(parsePullTestYear("1999", 2026)).toEqual({ kind: "year", year: 2026 });
    expect(parsePullTestYear(null, 2026)).toEqual({ kind: "year", year: 2026 });
  });
});

describe("PullTestsView", () => {
  it("lists the tests and counts the failed ones", async () => {
    renderWithProviders(<PullTestsView />, { route: "/harness/pull-tests" });
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(MOCK_PULL_TESTS.length + 1);
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    // A test against a spec with no minimum is Not judged, never Pass.
    expect(within(table).getAllByText("Not judged")).toHaveLength(1);
    expect(within(table).getByRole("columnheader", { name: /How it failed/ })).toBeInTheDocument();
    expect(within(table).getByText("Wire pulled out of crimp")).toBeInTheDocument();
  });

  it("finds tests by how they failed", async () => {
    renderWithProviders(<PullTestsView />, { route: "/harness/pull-tests?q=pulled%20out" });
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it("narrows to failed tests from the URL", async () => {
    renderWithProviders(<PullTestsView />, { route: "/harness/pull-tests?result=fail" });
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it("shows the Who's notified button to ARC admins only", async () => {
    renderWithProviders(<PullTestsView />, { route: "/harness/pull-tests" });
    await screen.findByRole("table");
    expect(screen.queryByRole("link", { name: /Who's notified/ })).toBeNull();

    cleanup();
    adminAccess.isAdmin = true;
    renderWithProviders(<PullTestsView />, { route: "/harness/pull-tests" });
    await screen.findByRole("table");
    expect(screen.getByRole("link", { name: /Who's notified/ })).toHaveAttribute("href", "/harness/alert-recipients");
  });

  it("opens one test from the email's link", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/harness/pull-tests/:id" element={<PullTestsView />} />
      </Routes>,
      { route: "/harness/pull-tests/3" },
    );
    expect(await screen.findByRole("dialog", { name: "Edit pull test" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Pull 2" })).toHaveValue("14.6");
  });
});

describe("PullTestSpecsView", () => {
  it("lists the active specs, any-terminal ones by name, and greys the controls for non-admins", async () => {
    renderWithProviders(<PullTestSpecsView />, { route: "/harness/pull-tests/specs" });
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(MOCK_PULL_SPECS.filter((s) => s.active).length + 1);
    expect(within(table).getAllByText("Any terminal")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add spec" })).toBeDisabled();
  });

  it("refuses to delete a spec tests were judged by", async () => {
    adminAccess.isAdmin = true;
    renderWithProviders(<PullTestSpecsView />, { route: "/harness/pull-tests/specs" });
    await screen.findByRole("table");
    const used = await screen.findByRole("button", { name: "Delete 910101 · 16 AWG · DEMO-DS-100" });
    expect(used).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete 910440 · 14 AWG" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add spec" }));
    expect(screen.getByRole("dialog", { name: "Add pull test spec" })).toBeInTheDocument();
  });
});
