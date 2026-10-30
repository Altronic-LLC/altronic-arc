import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// BusinessIT#56 (Brandon Mirto): one part number can sit on several open build
// requests, and their emails used to read identically — the part number and
// nothing else. A part comment's email now names the build request too, and
// it still does when the requests list hasn't been loaded yet.
// =============================================================================

const email = vi.hoisted(() => ({
  notifyMentions: vi.fn(() => Promise.resolve({ sent: [], failed: [] })),
}));
vi.mock("@/api/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/email")>()),
  notifyMentions: email.notifyMentions,
}));
vi.mock("@/hooks/useCommentMirror", () => ({ fanOutComment: vi.fn() }));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 }),
  useCurrentUserEmails: () => ["ray.white@altronic-llc.com"],
}));

import { listBuildRequests } from "@/api/buildRequests";
import { listBuildRequestItems } from "@/api/buildRequestItems";
import { buildRequestPartEmailTitle } from "@/lib/buildRequestAlerts";
import { BUILD_REQUEST_ITEMS_KEY, BUILD_REQUESTS_KEY, useAddBuildRequestItemComment } from "./useBuildRequests";

const MENTIONED = "mention.person@altronic-llc.com";
const body = `<p><span class="mention" data-email="${MENTIONED}">@Mention Person</span> please look</p>`;

async function setup(loadRequests: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const items = await listBuildRequestItems();
  const requests = await listBuildRequests();
  const item = items.find((i) => requests.some((r) => r.id === i.buildRequestLookupId))!;
  const parent = requests.find((r) => r.id === item.buildRequestLookupId)!;
  qc.setQueryData(BUILD_REQUEST_ITEMS_KEY, items);
  if (loadRequests) qc.setQueryData(BUILD_REQUESTS_KEY, requests);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useAddBuildRequestItemComment(), { wrapper });
  return { result, item, parent };
}

beforeEach(() => {
  email.notifyMentions.mockClear();
});

describe("part comment emails name the build request (BusinessIT#56)", () => {
  it.each([
    ["the requests list is cached", true],
    ["the requests list isn't loaded yet", false],
  ])("when %s", async (_label, loadRequests) => {
    const { result, item, parent } = await setup(loadRequests);
    expect(parent.brNo || parent.title).toBeTruthy();
    await act(() =>
      result.current.mutateAsync({
        id: item.id,
        comment: { authorName: "Ray White", authorEmail: "ray.white@altronic-llc.com", bodyHtml: body },
      }),
    );
    await waitFor(() => expect(email.notifyMentions).toHaveBeenCalledTimes(1));
    const target = (email.notifyMentions.mock.calls[0] as unknown as [{ target: { kind: string; id: number; title: string } }])[0].target;
    expect(target).toEqual({
      kind: "buildRequestItem",
      id: item.id,
      title: buildRequestPartEmailTitle(item, parent),
    });
    expect(target.title).toContain(" on ");
  });
});
