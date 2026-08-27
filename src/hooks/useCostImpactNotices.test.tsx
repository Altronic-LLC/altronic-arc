import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  collectCostImpactNoticePeople,
  useAddCostImpactNoticeComment,
  useCostImpactNotice,
  useCostImpactNotices,
  useEditCostImpactNoticeComment,
  useUpdateCostImpactNoticeFields,
} from "./useCostImpactNotices";
import type { CostImpactNotice } from "@/types/task";

const notifyMentions = vi.hoisted(() =>
  vi.fn((_input: unknown) => Promise.resolve({ sent: [], failed: [] })),
);

vi.mock("@/api/email", () => ({ notifyMentions, fireNewCostImpactNoticeAlert: vi.fn() }));

vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

const mention = (email: string, name: string) =>
  `<p><span class="mention" data-email="${email}">@${name}</span> please look</p>`;

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

describe("useCostImpactNotices", () => {
  it("loads the list", async () => {
    const { result } = renderHook(() => useCostImpactNotices(), { wrapper: hookWrapper() });
    await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  });

  it("picks one out of the loaded list", async () => {
    const { result } = renderHook(() => useCostImpactNotice(1), { wrapper: hookWrapper() });
    await waitFor(() => expect(result.current.data?.title).toBe("DATA LOGGING MODULE"));
  });

  it("has nothing to show for a null id", async () => {
    const { result } = renderHook(() => useCostImpactNotice(null), { wrapper: hookWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeUndefined();
  });
});

describe("collectCostImpactNoticePeople", () => {
  it("gathers the submitters, deduped", () => {
    const notice = (email: string): CostImpactNotice =>
      ({ submittedBy: { displayName: email, email } }) as CostImpactNotice;
    const people = collectCostImpactNoticePeople([notice("a@x.com"), notice("a@x.com"), notice("b@x.com")]);
    expect(people.map((p) => p.email).sort()).toEqual(["a@x.com", "b@x.com"]);
  });

  it("copes with a notice whose creator Graph never sent", () => {
    const notice = { submittedBy: null } as unknown as CostImpactNotice;
    expect(collectCostImpactNoticePeople([notice])).toEqual([]);
  });
});

describe("useUpdateCostImpactNoticeFields", () => {
  it("patches optimistically", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ update: useUpdateCostImpactNoticeFields(), list: useCostImpactNotices() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.update.mutateAsync({
        id: 1,
        fields: { TimeofImpact: "Immediate" },
        patch: (n) => ({ ...n, timeOfImpact: "Immediate" }),
      });
    });

    await waitFor(() =>
      expect(result.current.list.data?.find((n) => n.id === 1)?.timeOfImpact).toBe("Immediate"),
    );
  });
});

describe("useAddCostImpactNoticeComment", () => {
  it("emails the submitter even with nobody mentioned", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddCostImpactNoticeComment(), list: useCostImpactNotices() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.add.mutateAsync({
        id: 2, // submitted by David Bell in the fixtures
        comment: {
          authorName: "Ray White",
          authorEmail: "ray.white@altronic-llc.com",
          bodyHtml: "<p>Confirmed.</p>",
        },
      });
    });

    await waitFor(() => expect(notifyMentions).toHaveBeenCalled());
    const call = notifyMentions.mock.calls[0][0] as {
      recipients: Array<{ email: string; reason: string }>;
      target: { kind: string };
    };
    expect(call.target.kind).toBe("costImpactNotice");
    expect(call.recipients).toEqual([
      expect.objectContaining({ email: "david.bell@altronic-llc.com", reason: "submitted" }),
    ]);
  });

  it("emails the mentioned alongside the submitter", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddCostImpactNoticeComment(), list: useCostImpactNotices() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.add.mutateAsync({
        id: 2,
        comment: {
          authorName: "Ray White",
          authorEmail: "ray.white@altronic-llc.com",
          bodyHtml: mention("jerrod.waldron@altronic-llc.com", "Jerrod"),
        },
      });
    });

    await waitFor(() => expect(notifyMentions).toHaveBeenCalled());
    const call = notifyMentions.mock.calls[0][0] as { recipients: Array<{ email: string }> };
    expect(call.recipients.map((r) => r.email).sort()).toEqual([
      "david.bell@altronic-llc.com",
      "jerrod.waldron@altronic-llc.com",
    ]);
  });

  it("sends nothing when the author is the submitter and mentioned nobody", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddCostImpactNoticeComment(), list: useCostImpactNotices() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.add.mutateAsync({
        id: 1, // submitted by Mark Balent in the fixtures
        comment: {
          authorName: "Mark Balent",
          authorEmail: "mark.balent@altronic-llc.com",
          bodyHtml: "<p>Note to self.</p>",
        },
      });
    });

    expect(notifyMentions).not.toHaveBeenCalled();
  });
});

describe("useEditCostImpactNoticeComment", () => {
  it("emails only the newly mentioned", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({
        add: useAddCostImpactNoticeComment(),
        edit: useEditCostImpactNoticeComment(),
        list: useCostImpactNotices(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.add.mutateAsync({
        id: 3,
        comment: {
          authorName: "Ray White",
          authorEmail: "ray.white@altronic-llc.com",
          bodyHtml: mention("jerrod.waldron@altronic-llc.com", "Jerrod"),
        },
      });
    });
    notifyMentions.mockClear();

    const posted = result.current.list.data?.find((n) => n.id === 3)?.comments[0];
    expect(posted).toBeDefined();

    await act(async () => {
      await result.current.edit.mutateAsync({
        id: 3,
        target: { timestamp: posted!.timestamp, authorEmail: "ray.white@altronic-llc.com" },
        previousBodyHtml: mention("jerrod.waldron@altronic-llc.com", "Jerrod"),
        bodyHtml:
          mention("jerrod.waldron@altronic-llc.com", "Jerrod") +
          mention("mark.balent@altronic-llc.com", "Mark"),
      });
    });

    await waitFor(() => expect(notifyMentions).toHaveBeenCalled());
    const call = notifyMentions.mock.calls[0][0] as { recipients: Array<{ email: string }> };
    expect(call.recipients.map((r) => r.email)).toEqual(["mark.balent@altronic-llc.com"]);
  });
});
