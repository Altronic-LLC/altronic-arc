import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Work-order comments: who is notified, and who starts watching.
//
// The one thing that MUST be right here and can't be seen from a rendered
// page: auto-watch resolves a cold-start mention against the **PMO** site.
// A site user lookupId is per site collection, so Engineering's resolver would
// write a wrong (or non-existent) user into the Watchers column. That is why
// `resolveLookupId` is a required parameter on `autoWatchFromMentions`.
// =============================================================================

const pushToast = vi.hoisted(() => vi.fn());
const notifyMentions = vi.hoisted(() => vi.fn());
const autoWatchFromMentions = vi.hoisted(() =>
  vi.fn(async (_args: unknown): Promise<unknown[]> => []),
);
const resolvePmoSiteUserLookupId = vi.hoisted(() => vi.fn(async () => 0));

vi.mock("@/components/Toast", () => ({ pushToast }));
vi.mock("@/api/email", () => ({
  notifyMentions,
  fireFieldChangeAlert: vi.fn(),
  fireAssigneeChangeAlert: vi.fn(),
}));
vi.mock("@/api/autoWatch", () => ({ autoWatchFromMentions }));
vi.mock("@/api/operationsTasks", () => ({ resolvePmoSiteUserLookupId }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));

const ME = { displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 999 };
vi.mock("./useCurrentUser", () => ({ useCurrentUser: () => ME }));
vi.mock("./useIsAdmin", () => ({
  useIsAdmin: () => false,
  useAdminAccess: () => ({ isAdmin: false, isResolving: false }),
}));

import { resetMaintenanceMockStore, setMaintenanceTaskWatchers } from "@/api/maintenanceTasks";
import {
  useAddMaintenanceComment,
  useEditMaintenanceComment,
  useMaintenanceTasks,
} from "./useMaintenanceTasks";
import type { MaintenanceTask } from "@/types/task";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

async function loaded(wrap: ReturnType<typeof wrapper>): Promise<MaintenanceTask[]> {
  const { result } = renderHook(() => useMaintenanceTasks(), { wrapper: wrap });
  await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  return result.current.data!;
}

const mention = (email: string, name: string) =>
  `<p>Hi <span class="mention" data-email="${email}">@${name}</span>, can you look?</p>`;

const AUTHOR = {
  authorName: "Demo User",
  authorEmail: "demo.user@altronic-llc.com",
};

beforeEach(() => {
  resetMaintenanceMockStore();
  pushToast.mockClear();
  notifyMentions.mockClear();
  autoWatchFromMentions.mockClear();
});

describe("posting a comment", () => {
  it("notifies the watchers and the assignee, tagged as a work order", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => t.watchers.length > 0)!;

    const { result } = renderHook(() => useAddMaintenanceComment(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({
        id: target.id,
        comment: { ...AUTHOR, bodyHtml: "<p>Cooler cleaned.</p>" },
      });
    });

    await waitFor(() => expect(notifyMentions).toHaveBeenCalled());
    const call = notifyMentions.mock.calls[0][0];
    expect(call.target).toMatchObject({ kind: "maintenanceTask", id: target.id });
    expect(call.recipients.length).toBeGreaterThan(0);
    // Never the author, even when they're a watcher.
    expect(call.recipients.map((r: { email: string }) => r.email)).not.toContain(AUTHOR.authorEmail);
  });

  it("says nothing when there is nobody to tell", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => !t.assigned)!;
    await setMaintenanceTaskWatchers(target.id, []);

    // A fresh client, so the list is re-read with the watchers now cleared —
    // the recipient math runs off the loaded list, not off the store.
    const fresh = wrapper();
    await loaded(fresh);
    const { result } = renderHook(() => useAddMaintenanceComment(), { wrapper: fresh });
    await act(async () => {
      await result.current.mutateAsync({
        id: target.id,
        comment: { ...AUTHOR, bodyHtml: "<p>Note to self.</p>" },
      });
    });
    expect(notifyMentions).not.toHaveBeenCalled();
  });

  it("auto-watches an @-mention against the PMO site's resolver", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);

    const { result } = renderHook(() => useAddMaintenanceComment(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({
        id: tasks[0].id,
        comment: {
          ...AUTHOR,
          bodyHtml: mention("alyssa.garrett@altronic-llc.com", "Alyssa Garrett"),
        },
      });
    });

    await waitFor(() => expect(autoWatchFromMentions).toHaveBeenCalled());
    const args = autoWatchFromMentions.mock.calls[0][0] as unknown as {
      resolveLookupId: unknown;
      recipients: Array<{ email: string }>;
    };
    // The PMO resolver, not Engineering's — a lookupId is per site collection.
    expect(args.resolveLookupId).toBe(resolvePmoSiteUserLookupId);
    expect(args.recipients.map((r) => r.email)).toContain("alyssa.garrett@altronic-llc.com");
  });

  it("doesn't reach for the resolver when nobody was mentioned", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const { result } = renderHook(() => useAddMaintenanceComment(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({
        id: tasks[0].id,
        comment: { ...AUTHOR, bodyHtml: "<p>No mentions here.</p>" },
      });
    });
    expect(autoWatchFromMentions).not.toHaveBeenCalled();
  });
});

describe("editing a comment", () => {
  it("notifies only the NEWLY added mention, not everyone again", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks[0];

    const add = renderHook(() => useAddMaintenanceComment(), { wrapper: wrap });
    let posted: MaintenanceTask | undefined;
    await act(async () => {
      posted = await add.result.current.mutateAsync({
        id: target.id,
        comment: { ...AUTHOR, bodyHtml: mention("eric.gilkinson@altronic-llc.com", "Eric") },
      });
    });
    notifyMentions.mockClear();

    const edit = renderHook(() => useEditMaintenanceComment(), { wrapper: wrap });
    await act(async () => {
      await edit.result.current.mutateAsync({
        id: target.id,
        target: {
          timestamp: posted!.comments[0].timestamp,
          authorEmail: AUTHOR.authorEmail,
        },
        newBodyHtml:
          mention("eric.gilkinson@altronic-llc.com", "Eric") +
          mention("amanda.hoagland@altronic-llc.com", "Amanda"),
      });
    });

    await waitFor(() => expect(notifyMentions).toHaveBeenCalled());
    const emails = notifyMentions.mock.calls[0][0].recipients.map(
      (r: { email: string }) => r.email,
    );
    expect(emails).toEqual(["amanda.hoagland@altronic-llc.com"]);
  });

  it("re-notifies everyone when the author asks for it", async () => {
    const wrap = wrapper();
    const tasks = await loaded(wrap);
    const target = tasks.find((t) => t.watchers.length > 0)!;

    const add = renderHook(() => useAddMaintenanceComment(), { wrapper: wrap });
    let posted: MaintenanceTask | undefined;
    await act(async () => {
      posted = await add.result.current.mutateAsync({
        id: target.id,
        comment: { ...AUTHOR, bodyHtml: "<p>First take.</p>" },
      });
    });
    notifyMentions.mockClear();

    const edit = renderHook(() => useEditMaintenanceComment(), { wrapper: wrap });
    await act(async () => {
      await edit.result.current.mutateAsync({
        id: target.id,
        target: {
          timestamp: posted!.comments[0].timestamp,
          authorEmail: AUTHOR.authorEmail,
        },
        newBodyHtml: "<p>Second take — this one matters.</p>",
        renotify: true,
      });
    });

    await waitFor(() => expect(notifyMentions).toHaveBeenCalled());
    expect(notifyMentions.mock.calls[0][0].recipients.length).toBeGreaterThan(0);
  });
});
