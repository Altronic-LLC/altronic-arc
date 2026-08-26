import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useAddSupplierIssueComment,
  useCreateSupplierIssue,
  useSupplierIssues,
  useSupplierIssuesFor,
  useUpdateSupplierIssueFields,
} from "./useSupplierIssues";

const notifyMentions = vi.hoisted(() =>
  vi.fn((_input: unknown) => Promise.resolve({ sent: [], failed: [] })),
);

vi.mock("@/api/email", () => ({ notifyMentions }));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 }),
}));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));

function hookWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  notifyMentions.mockClear();
});

describe("useSupplierIssuesFor", () => {
  it("scopes issues to one supplier, and returns [] for a null id", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(() => useSupplierIssuesFor(29), { wrapper });
    await waitFor(() => expect(result.current.data.length).toBeGreaterThan(0));
    expect(result.current.data.every((i) => i.supplierId === 29)).toBe(true);

    const { result: nullResult } = renderHook(() => useSupplierIssuesFor(null), { wrapper });
    expect(nullResult.current.data).toEqual([]);
  });
});

describe("create / update", () => {
  it("round-trips an issue, auto-watching the creator", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({
        create: useCreateSupplierIssue(),
        update: useUpdateSupplierIssueFields(),
        list: useSupplierIssues(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    let id = 0;
    await act(async () => {
      const created = await result.current.create.mutateAsync({
        title: "New issue",
        supplierId: 29,
        description: "",
        status: null,
        severity: null,
        watchers: [],
      });
      id = created.id;
    });
    expect(
      result.current.list.data?.find((i) => i.id === id)?.watchers.some((w) => w.email === "ray.white@altronic-llc.com"),
    ).toBe(true);

    await act(async () => {
      await result.current.update.mutateAsync({ id, changed: { resolution: "Fixed" } });
    });
    expect(result.current.list.data?.find((i) => i.id === id)?.resolution).toBe("Fixed");
  });
});

describe("useAddSupplierIssueComment", () => {
  it("emails the issue's watchers", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddSupplierIssueComment(), list: useSupplierIssues() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const issue = result.current.list.data!.find((i) => i.id === 1)!; // fixture already has a watcher

    await act(async () => {
      await result.current.add.mutateAsync({
        id: issue.id,
        comment: { authorName: "Ray White", authorEmail: "ray.white@altronic-llc.com", bodyHtml: "<p>Update.</p>" },
      });
    });

    await waitFor(() => expect(notifyMentions).toHaveBeenCalled());
    const call = notifyMentions.mock.calls[0][0] as {
      recipients: Array<{ email: string }>;
      target: { kind: string };
    };
    expect(call.target.kind).toBe("supplierIssue");
    expect(call.recipients.map((r) => r.email)).toContain("Chandana.Ramisetty@altronic-llc.com");
  });
});
