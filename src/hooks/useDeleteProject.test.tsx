import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// BusinessIT#41 — deleting a duplicate project. Both rules are asked INSIDE
// the mutationFn: only an ARC admin, and only once nothing points at it. A
// list that can't be read refuses the delete rather than reading as "unused".
// =============================================================================

const mocks = vi.hoisted(() => ({
  emails: ["admin@altronic-llc.com"],
  admins: [{ id: 1, email: "admin@altronic-llc.com", displayName: "Admin" }],
  tasks: [] as unknown[],
  eirsFail: false,
}));

vi.mock("./useCurrentUser", () => ({
  useCurrentUserEmails: () => mocks.emails,
  useCurrentUser: () => ({ displayName: "x", email: mocks.emails[0], lookupId: 1 }),
}));
vi.mock("./useIsAdmin", () => ({ useIsAdmin: () => false }));
vi.mock("@/api/admins", () => ({ listAdmins: vi.fn(async () => mocks.admins) }));
vi.mock("@/api/tasks", async (orig) => ({
  ...(await orig<typeof import("@/api/tasks")>()),
  listTasks: vi.fn(async () => mocks.tasks),
  deleteProject: vi.fn(async () => undefined),
}));
vi.mock("@/api/eirs", async (orig) => ({
  ...(await orig<typeof import("@/api/eirs")>()),
  listEirs: vi.fn(async () => {
    if (mocks.eirsFail) throw new Error("Graph 429 Too Many Requests");
    return [];
  }),
}));
vi.mock("@/api/ecns", async (orig) => ({
  ...(await orig<typeof import("@/api/ecns")>()),
  listEcns: vi.fn(async () => []),
}));
vi.mock("@/api/testSheets", async (orig) => ({
  ...(await orig<typeof import("@/api/testSheets")>()),
  listTestSheets: vi.fn(async () => []),
}));
vi.mock("@/api/buildRequests", async (orig) => ({
  ...(await orig<typeof import("@/api/buildRequests")>()),
  listBuildRequests: vi.fn(async () => []),
}));
vi.mock("@/api/buildRequestItems", async (orig) => ({
  ...(await orig<typeof import("@/api/buildRequestItems")>()),
  listBuildRequestItems: vi.fn(async () => []),
}));
vi.mock("@/api/faits", async (orig) => ({
  ...(await orig<typeof import("@/api/faits")>()),
  listFaits: vi.fn(async () => []),
}));
vi.mock("@/api/projectFiles", async (orig) => ({
  ...(await orig<typeof import("@/api/projectFiles")>()),
  listProjectFolders: vi.fn(async () => []),
}));

import { ProjectInUseError, useDeleteProject, useProjectUsage } from "./useDeleteProject";
import { deleteProject } from "@/api/tasks";

const PROJECT = { lookupId: 7, title: "0017-AMP-5000 Refresh (dup)" };

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.mocked(deleteProject).mockClear();
  mocks.emails = ["admin@altronic-llc.com"];
  mocks.tasks = [];
  mocks.eirsFail = false;
});

describe("useDeleteProject", () => {
  it("deletes a project nothing points at", async () => {
    const { result } = renderHook(() => useDeleteProject(), { wrapper });
    await act(() => result.current.mutateAsync(PROJECT));
    expect(deleteProject).toHaveBeenCalledWith(7);
  });

  it("refuses a project still used by a task, naming the count", async () => {
    mocks.tasks = [{ parentProject: { lookupId: 7, title: "x" }, relatedProjects: [] }];
    const { result } = renderHook(() => useDeleteProject(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync(PROJECT)).rejects.toThrow(/still used by 1 task\. Move them/),
    );
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("throws ProjectInUseError for a related-project use too", async () => {
    mocks.tasks = [{ parentProject: null, relatedProjects: [{ lookupId: 7, title: "x" }] }];
    const { result } = renderHook(() => useDeleteProject(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync(PROJECT)).rejects.toBeInstanceOf(ProjectInUseError),
    );
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("refuses a non-admin", async () => {
    mocks.emails = ["someone@altronic-llc.com"];
    const { result } = renderHook(() => useDeleteProject(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync(PROJECT)).rejects.toThrow(/Only ARC admins/),
    );
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("refuses when a list can't be read: couldn't look is not unused", async () => {
    mocks.eirsFail = true;
    const { result } = renderHook(() => useDeleteProject(), { wrapper });
    await act(() =>
      expect(result.current.mutateAsync(PROJECT)).rejects.toThrow(
        /Couldn't check where this project is used/,
      ),
    );
    expect(deleteProject).not.toHaveBeenCalled();
  });
});

describe("useProjectUsage", () => {
  it("reports where the project is used", async () => {
    mocks.tasks = [{ parentProject: { lookupId: 7, title: "x" }, relatedProjects: [] }];
    const { result } = renderHook(() => useProjectUsage(7), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ label: "task", count: 1 }]);
  });

  it("does nothing with no project", () => {
    const { result } = renderHook(() => useProjectUsage(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
