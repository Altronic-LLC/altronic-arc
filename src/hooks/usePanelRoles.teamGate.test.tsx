import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// The panel team write gate, in REAL mode (demo mode always allows, so the
// gate is invisible there). It awaits the roles and Admins lists itself.

const roles = vi.hoisted(() => ({ rows: [] as unknown[] }));
const admins = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@/api/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/config")>()),
  USE_MOCK: false,
}));
vi.mock("@/api/panelRoles", () => ({
  listPanelRoles: vi.fn(async () => roles.rows),
  addPanelRole: vi.fn(),
  updatePanelRole: vi.fn(),
  removePanelRole: vi.fn(),
}));
vi.mock("@/api/admins", () => ({ listAdmins: vi.fn(async () => admins.rows) }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Me", email: "me@example.com" }),
  useCurrentUserEmails: () => ["me.signin@example.com", "me@example.com"],
}));
vi.mock("./useIsAdmin", () => ({
  useIsAdmin: () => false,
  useAdminAccess: () => ({ isAdmin: false, isResolving: false }),
}));

import {
  useRequirePanelCapacityManager,
  useRequirePanelTeamEdit,
  useRequirePanelTemplateManager,
} from "./usePanelRoles";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const ME = { displayName: "Me", email: "me@example.com" };

beforeEach(() => {
  roles.rows = [];
  admins.rows = [];
});

describe("useRequirePanelTeamEdit", () => {
  it("refuses somebody not on Panel User Roles", async () => {
    const { result } = renderHook(() => useRequirePanelTeamEdit(), { wrapper });
    await act(() => expect(result.current()).rejects.toThrow(/Panel User Roles/));
  });

  it("refuses a Viewer", async () => {
    roles.rows = [{ id: 1, user: ME, role: "Viewer", note: "" }];
    const { result } = renderHook(() => useRequirePanelTeamEdit(), { wrapper });
    await act(() => expect(result.current()).rejects.toThrow(/Viewers/));
  });

  it("allows a team member, matched on any address the account carries", async () => {
    roles.rows = [{ id: 1, user: ME, role: "Engineer", note: "" }];
    const { result } = renderHook(() => useRequirePanelTeamEdit(), { wrapper });
    await act(() => expect(result.current()).resolves.toBeUndefined());
  });

  it("allows an ARC admin who holds no panel role", async () => {
    admins.rows = [{ id: 1, email: "me@example.com", displayName: "Me" }];
    const { result } = renderHook(() => useRequirePanelTeamEdit(), { wrapper });
    await act(() => expect(result.current()).resolves.toBeUndefined());
  });
});

describe("useRequirePanelCapacityManager (amber threshold, company holidays)", () => {
  it("refuses an Engineer or a Manager", async () => {
    for (const role of ["Engineer", "Manager"]) {
      roles.rows = [{ id: 1, user: ME, role, note: "" }];
      const { result } = renderHook(() => useRequirePanelCapacityManager(), { wrapper });
      await act(() => expect(result.current()).rejects.toThrow(/Super User/));
    }
  });

  it("allows a Super User, or an ARC admin", async () => {
    roles.rows = [{ id: 1, user: ME, role: "Super User", note: "" }];
    const a = renderHook(() => useRequirePanelCapacityManager(), { wrapper });
    await act(() => expect(a.result.current()).resolves.toBeUndefined());
    roles.rows = [];
    admins.rows = [{ id: 1, email: "me@example.com", displayName: "Me" }];
    const b = renderHook(() => useRequirePanelCapacityManager(), { wrapper });
    await act(() => expect(b.result.current()).resolves.toBeUndefined());
  });
});

describe("useRequirePanelTemplateManager (standard tasks)", () => {
  it("refuses an Engineer and allows a Manager", async () => {
    roles.rows = [{ id: 1, user: ME, role: "Engineer", note: "" }];
    const a = renderHook(() => useRequirePanelTemplateManager(), { wrapper });
    await act(() => expect(a.result.current()).rejects.toThrow(/Manager, Admin or Super User/));
    roles.rows = [{ id: 1, user: ME, role: "Manager", note: "" }];
    const b = renderHook(() => useRequirePanelTemplateManager(), { wrapper });
    await act(() => expect(b.result.current()).resolves.toBeUndefined());
  });
});

