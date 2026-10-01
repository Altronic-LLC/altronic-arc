import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// EIRs and build requests (header AND part threads): an @-mentioned person
// shows as a watcher the instant Post is pressed — while the comment write is
// still pending — not after its SharePoint round trip. See
// hooks/mentionAutoWatch.ts.
// =============================================================================

vi.mock("@/api/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/email")>()),
  notifyMentions: vi.fn(() => Promise.resolve({ sent: [], failed: [] })),
  notifyChangeEmails: vi.fn(() => Promise.resolve({ sent: [], failed: [] })),
}));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

// Lets a test hold the EIR comment write open, or fail it.
const eirCommentGate = vi.hoisted(() => ({ fail: false }));
vi.mock("@/api/eirs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/api/eirs")>();
  return {
    ...real,
    addEirComment: vi.fn(async (...args: Parameters<typeof real.addEirComment>) => {
      if (eirCommentGate.fail) throw new Error("refused");
      return real.addEirComment(...args);
    }),
  };
});

import { useAddEirComment, useEditEirComment, useEirs } from "./useEirs";
import {
  useAddBuildRequestComment,
  useAddBuildRequestItemComment,
  useBuildRequestItems,
  useBuildRequests,
} from "./useBuildRequests";

const NEWCOMER = "mention.newcomer@altronic-llc.com";
const mention = (email: string, name: string) =>
  `<p><span class="mention" data-email="${email}">@${name}</span> please look</p>`;
const hasNewcomer = (watchers: { email?: string | null }[] | undefined) =>
  !!watchers?.some((w) => w.email === NEWCOMER);

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const author = { authorName: "Ray White", authorEmail: "ray.white@altronic-llc.com" };

beforeEach(() => {
  eirCommentGate.fail = false;
});

describe("EIR comments — mention auto-watch timing", () => {
  it("shows the mentioned person as a watcher while the comment is still posting", async () => {
    const { result } = renderHook(() => ({ add: useAddEirComment(), list: useEirs() }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const eir = result.current.list.data![0];
    expect(hasNewcomer(eir.watchers)).toBe(false);

    act(() => {
      result.current.add.mutate({ id: eir.id, comment: { ...author, bodyHtml: mention(NEWCOMER, "Newcomer") } });
    });

    await waitFor(() => {
      expect(result.current.add.isPending).toBe(true);
      expect(hasNewcomer(result.current.list.data?.find((e) => e.id === eir.id)?.watchers)).toBe(true);
    });
    await waitFor(() => expect(result.current.add.isSuccess).toBe(true));
    // And it sticks once the write and the refetch have landed.
    await waitFor(() =>
      expect(hasNewcomer(result.current.list.data?.find((e) => e.id === eir.id)?.watchers)).toBe(true),
    );
  });

  it("takes the optimistic watcher back when the comment fails", async () => {
    eirCommentGate.fail = true;
    const { result } = renderHook(() => ({ add: useAddEirComment(), list: useEirs() }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const eir = result.current.list.data![1];

    act(() => {
      result.current.add.mutate({ id: eir.id, comment: { ...author, bodyHtml: mention(NEWCOMER, "Newcomer") } });
    });
    await waitFor(() => expect(result.current.add.isError).toBe(true));
    expect(hasNewcomer(result.current.list.data?.find((e) => e.id === eir.id)?.watchers)).toBe(false);
  });

  it("an edited comment's new mention also watches immediately", async () => {
    const { result } = renderHook(() => ({ edit: useEditEirComment(), list: useEirs() }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const eir = result.current.list.data!.find((e) => e.comments.length > 0)!;
    const target = eir.comments[0];

    act(() => {
      result.current.edit.mutate({
        id: eir.id,
        target: { timestamp: target.timestamp, authorEmail: target.authorEmail ?? "" },
        newBodyHtml: mention(NEWCOMER, "Newcomer"),
      });
    });
    await waitFor(() => {
      expect(result.current.edit.isPending).toBe(true);
      expect(hasNewcomer(result.current.list.data?.find((e) => e.id === eir.id)?.watchers)).toBe(true);
    });
    await waitFor(() => expect(result.current.edit.isSuccess).toBe(true));
  });
});

describe("Build request comments — mention auto-watch timing", () => {
  it("a header comment shows the mentioned person as a watcher while posting", async () => {
    const { result } = renderHook(
      () => ({ add: useAddBuildRequestComment(), list: useBuildRequests() }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const br = result.current.list.data![0];

    act(() => {
      result.current.add.mutate({ id: br.id, comment: { ...author, bodyHtml: mention(NEWCOMER, "Newcomer") } });
    });
    await waitFor(() => {
      expect(result.current.add.isPending).toBe(true);
      expect(hasNewcomer(result.current.list.data?.find((b) => b.id === br.id)?.watchers)).toBe(true);
    });
    await waitFor(() => expect(result.current.add.isSuccess).toBe(true));
  });

  it("a part comment watches the PART (not its header) while posting", async () => {
    const { result } = renderHook(
      () => ({
        add: useAddBuildRequestItemComment(),
        items: useBuildRequestItems(),
        brs: useBuildRequests(),
      }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.items.data?.length).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.brs.data?.length).toBeGreaterThan(0));
    const item = result.current.items.data![0];

    act(() => {
      result.current.add.mutate({ id: item.id, comment: { ...author, bodyHtml: mention(NEWCOMER, "Newcomer") } });
    });
    await waitFor(() => {
      expect(result.current.add.isPending).toBe(true);
      expect(hasNewcomer(result.current.items.data?.find((i) => i.id === item.id)?.watchers)).toBe(true);
    });
    await waitFor(() => expect(result.current.add.isSuccess).toBe(true));
    await waitFor(() =>
      expect(hasNewcomer(result.current.items.data?.find((i) => i.id === item.id)?.watchers)).toBe(true),
    );
  });
});
