import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  email: "demo.user@altronic-llc.com",
  admins: [] as Array<{ id: number; email: string; displayName: string; note: string }>,
  isLoading: false,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "U", email: mocks.email, lookupId: 0 }),
}));
vi.mock("@/hooks/useAdmins", () => ({
  useAdmins: () => ({ data: mocks.admins, isLoading: mocks.isLoading }),
}));

import { RequireAdmin } from "./RequireAdmin";

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={["/admin/admins"]}>
      <Routes>
        <Route path="/" element={<div>HOME</div>} />
        <Route
          path="/admin/admins"
          element={
            <RequireAdmin>
              <div>ADMIN PAGE</div>
            </RequireAdmin>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.email = "demo.user@altronic-llc.com";
  mocks.admins = [];
  mocks.isLoading = false;
});

describe("RequireAdmin", () => {
  it("renders the admin page for a bootstrap admin, even while the list loads", () => {
    mocks.email = "ray.white@altronic-llc.com";
    mocks.isLoading = true; // list not resolved yet
    renderGuard();
    expect(screen.getByText("ADMIN PAGE")).toBeInTheDocument();
  });

  it("renders the admin page for a user on the Admins list", () => {
    mocks.email = "jane.smith@altronic-llc.com";
    mocks.admins = [
      { id: 1, email: "jane.smith@altronic-llc.com", displayName: "Jane", note: "" },
    ];
    renderGuard();
    expect(screen.getByText("ADMIN PAGE")).toBeInTheDocument();
  });

  it("redirects a non-admin to the dashboard (never renders the admin page)", () => {
    mocks.email = "random.person@altronic-llc.com";
    renderGuard();
    expect(screen.queryByText("ADMIN PAGE")).not.toBeInTheDocument();
    expect(screen.getByText("HOME")).toBeInTheDocument();
  });

  it("holds with a checking-access notice while the list resolves for a non-bootstrap user", () => {
    mocks.email = "random.person@altronic-llc.com";
    mocks.isLoading = true;
    renderGuard();
    expect(screen.getByText(/Checking access/i)).toBeInTheDocument();
    expect(screen.queryByText("ADMIN PAGE")).not.toBeInTheDocument();
    expect(screen.queryByText("HOME")).not.toBeInTheDocument();
  });
});
