import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { resetCrimpCheckMockStore } from "@/api/crimpChecks";
import { resetCrimpSpecMockStore } from "@/api/crimpSpecs";
import { MOCK_CRIMP_CHECKS } from "@/data/crimpMockData";
import { CrimpChecksView, crimpResult, parseCrimpYear } from "./CrimpChecksView";
import { CrimpSpecsView } from "./CrimpSpecsView";

const adminAccess = vi.hoisted(() => ({ isAdmin: false, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));

beforeEach(() => {
  resetCrimpCheckMockStore();
  resetCrimpSpecMockStore();
  adminAccess.isAdmin = false;
});

describe("parseCrimpYear / crimpResult", () => {
  it("reads ?year=, falling back to this year", () => {
    expect(parseCrimpYear("all", 2026)).toEqual({ kind: "all" });
    expect(parseCrimpYear("1999", 2026)).toEqual({ kind: "year", year: 2026 });
    expect(parseCrimpYear(null, 2026)).toEqual({ kind: "year", year: 2026 });
  });

  it("says Not judged, never In spec, when there was nothing to judge against", () => {
    const c = MOCK_CRIMP_CHECKS[0];
    expect(crimpResult(c)).toBe("In spec");
    expect(crimpResult({ ...c, crimpHeight: null })).toBe("Not judged");
    expect(crimpResult({ ...c, outOfSpec: true })).toBe("Out of spec");
  });
});

describe("CrimpChecksView", () => {
  it("lists the checks and counts the ones out of spec", async () => {
    renderWithProviders(<CrimpChecksView />, { route: "/harness/crimp-checks" });
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(MOCK_CRIMP_CHECKS.length + 1);
    expect(screen.getByText("1 out of spec")).toBeInTheDocument();
  });

  it("shows the Who's notified button to ARC admins only", async () => {
    renderWithProviders(<CrimpChecksView />, { route: "/harness/crimp-checks" });
    await screen.findByRole("table");
    expect(screen.queryByRole("link", { name: /Who's notified/ })).toBeNull();

    cleanup();
    adminAccess.isAdmin = true;
    renderWithProviders(<CrimpChecksView />, { route: "/harness/crimp-checks" });
    await screen.findByRole("table");
    expect(screen.getByRole("link", { name: /Who's notified/ })).toHaveAttribute("href", "/harness/alert-recipients");
  });

  it("narrows to out-of-spec checks from the URL", async () => {
    renderWithProviders(<CrimpChecksView />, { route: "/harness/crimp-checks?result=out" });
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it("opens the check an email links to", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/harness/crimp-checks/:id" element={<CrimpChecksView />} />
      </Routes>,
      { route: "/harness/crimp-checks/5" },
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit crimp height check" });
    expect(within(dialog).getByRole("textbox", { name: "Reading 2" })).toHaveValue("0.045");
  });
});

describe("CrimpSpecsView", () => {
  it("is read-only for somebody who isn't an ARC admin", async () => {
    renderWithProviders(<CrimpSpecsView />, { route: "/harness/crimp-checks/specs" });
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Add spec" })).toBeDisabled();
    expect(screen.getByText(/Only ARC admins can change the crimp specs/)).toBeInTheDocument();
  });

  it("only lets an admin delete a spec no check has used", async () => {
    adminAccess.isAdmin = true;
    renderWithProviders(<CrimpSpecsView />, { route: "/harness/crimp-checks/specs" });
    await screen.findByRole("table");
    // 900330 18 AWG has two checks; 900101 20 AWG has none.
    expect(await screen.findByRole("button", { name: "Delete 900330 18 AWG" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete 900101 20 AWG" })).toBeEnabled();
  });

  it("points out specs still waiting for a crimp height", async () => {
    renderWithProviders(<CrimpSpecsView />, { route: "/harness/crimp-checks/specs" });
    expect(await screen.findByText(/1 spec has no crimp height yet/)).toBeInTheDocument();
  });
});
