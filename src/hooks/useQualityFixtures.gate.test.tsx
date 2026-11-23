import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Every Quality Fixture Log write asks `editFixturesGate` INSIDE its
// mutationFn, in REAL mode, awaiting the roles list — so no screen reaches the
// API ungated. The roles list: a Fixture Log admin or an ARC admin, and an ARC
// admin gets ONLY that.

const roles = vi.hoisted(() => ({ rows: [] as unknown[] }));
const admins = vi.hoisted(() => ({ rows: [] as unknown[] }));
const api = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), createRole: vi.fn() }));

vi.mock("@/api/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/config")>()),
  USE_MOCK: false,
}));
vi.mock("@/api/qualityFixtureRoles", () => ({
  listQualityFixtureRoleEntries: vi.fn(async () => roles.rows),
  createQualityFixtureRoleEntry: api.createRole,
  updateQualityFixtureRoleEntry: vi.fn(),
  deleteQualityFixtureRoleEntry: vi.fn(),
}));
vi.mock("@/api/qualityFixtures", () => ({
  listQualityFixtures: vi.fn(async () => []),
  createQualityFixture: api.create,
  updateQualityFixture: api.update,
}));
vi.mock("@/api/admins", () => ({ listAdmins: vi.fn(async () => admins.rows) }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Me", email: "me@example.com" }),
  useCurrentUserEmails: () => ["me@example.com"],
}));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

import { QUALITY_FIXTURES_KEY, useCreateQualityFixture, useSetQualityFixtureActive } from "./useQualityFixtures";
import { useCreateQualityFixtureRoleEntry } from "./useQualityFixtureRoles";

const input = { number: "QF391", description: "Tester", comment: "", location: "", partNumbers: "", active: true };

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

beforeEach(() => {
  roles.rows = [];
  admins.rows = [];
  api.create.mockReset().mockResolvedValue({ id: 1, number: "QF391", description: "Tester", active: true });
  api.update.mockReset();
  api.createRole.mockReset().mockResolvedValue({ id: 1, email: "x@example.com", displayName: "", roles: [], note: "" });
});

describe("fixture writes", () => {
  it("refuse somebody who isn't on the roles list — and never reach the API", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQualityFixture(), { wrapper });
    await act(() => expect(result.current.mutateAsync(input)).rejects.toThrow(/Fixture Log editor/));
    expect(api.create).not.toHaveBeenCalled();
  });

  it("refuse an ARC admin who isn't on the list — they manage roles, not fixtures", async () => {
    admins.rows = [{ id: 1, email: "me@example.com", displayName: "Me", note: "" }];
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQualityFixture(), { wrapper });
    await act(() => expect(result.current.mutateAsync(input)).rejects.toThrow(/Fixture Log editor/));
    expect(api.create).not.toHaveBeenCalled();
  });

  it("let an editor add a fixture", async () => {
    roles.rows = [{ id: 1, email: "me@example.com", displayName: "Me", roles: ["editor"], note: "" }];
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQualityFixture(), { wrapper });
    await act(() => result.current.mutateAsync(input));
    expect(api.create).toHaveBeenCalledWith(input);
  });

  it("retire through the same gate, sending the cached row as the one the edit started from", async () => {
    roles.rows = [{ id: 1, email: "me@example.com", displayName: "Me", roles: ["admin"], note: "" }];
    const { qc, wrapper } = setup();
    const cached = {
      id: 4,
      number: "QF4",
      description: "Gauge",
      comment: "",
      location: "",
      partNumbers: "",
      active: true,
      hasAttachments: false,
      createdAt: new Date(0),
      modifiedAt: new Date(0),
    };
    qc.setQueryData(QUALITY_FIXTURES_KEY, [cached]);
    api.update.mockResolvedValue({ ...cached, active: false });
    const { result } = renderHook(() => useSetQualityFixtureActive(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 4, active: false }));
    expect(api.update).toHaveBeenCalledWith(4, expect.objectContaining({ number: "QF4", active: false }), cached);
  });
});

describe("roles list writes", () => {
  it("are refused for an editor", async () => {
    roles.rows = [{ id: 1, email: "me@example.com", displayName: "Me", roles: ["editor"], note: "" }];
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQualityFixtureRoleEntry(), { wrapper });
    await act(() =>
      expect(
        result.current.mutateAsync({ email: "x@example.com", displayName: "X", roles: ["editor"], note: "" }),
      ).rejects.toThrow(/Fixture Log admin or an ARC admin/),
    );
    expect(api.createRole).not.toHaveBeenCalled();
  });

  it("are allowed for an ARC admin", async () => {
    admins.rows = [{ id: 1, email: "me@example.com", displayName: "Me", note: "" }];
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateQualityFixtureRoleEntry(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ email: "x@example.com", displayName: "X", roles: ["editor"], note: "" }),
    );
    expect(api.createRole).toHaveBeenCalled();
  });
});
