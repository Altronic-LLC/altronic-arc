import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  collectEcnPeople,
  useAddEcnComment,
  useCreateEcn,
  useEcn,
  useEcns,
  useEditEcnComment,
  useUpdateEcnFields,
} from "./useEcns";
import type { Ecn } from "@/types/task";

const notifyMentions = vi.hoisted(() =>
  vi.fn((_input: unknown) => Promise.resolve({ sent: [], failed: [] })),
);

vi.mock("@/api/email", () => ({ notifyMentions }));

vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

// useCurrentUser reads MSAL context; there's no MsalProvider in a hook test.
vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

const mention = (email: string, name: string) =>
  `<p><span class="mention" data-email="${email}">@${name}</span> please look</p>`;

/** A provider wrapper with retries off, so a failure surfaces immediately. */
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

async function loadedEcns() {
  const { result } = renderHook(() => useEcns(), { wrapper: hookWrapper() });
  await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  return result;
}

describe("useEcns", () => {
  it("loads the list", async () => {
    const result = await loadedEcns();
    expect(result.current.data?.[0].logNo).toBe("260062");
  });

  it("picks one out of the loaded list", async () => {
    const { result } = renderHook(() => useEcn(2), { wrapper: hookWrapper() });
    await waitFor(() => expect(result.current.data?.logNo).toBe("260059R1"));
  });

  it("has nothing to show for a null id", async () => {
    const { result } = renderHook(() => useEcn(null), { wrapper: hookWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeUndefined();
  });
});

describe("collectEcnPeople", () => {
  it("gathers the submitters, deduped", () => {
    const ecn = (email: string): Ecn =>
      ({
        id: 1,
        title: "",
        logNo: "",
        parentProject: null,
        submittedBy: { displayName: email, email },
        comments: [],
        hasAttachments: false,
        values: {},
        createdAt: new Date(0),
        modifiedAt: new Date(0),
      }) as Ecn;
    const people = collectEcnPeople([ecn("a@x.com"), ecn("a@x.com"), ecn("b@x.com")]);
    expect(people.map((p) => p.email).sort()).toEqual(["a@x.com", "b@x.com"]);
  });

  it("copes with a notice whose creator Graph never sent", () => {
    const ecn = { submittedBy: null, values: {} } as unknown as Ecn;
    expect(collectEcnPeople([ecn])).toEqual([]);
  });
});

describe("useCreateEcn", () => {
  it("raises one and puts it at the top of the cache", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ create: useCreateEcn(), list: useEcns() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.create.mutateAsync({
        title: "New notice",
        logNo: "269001",
        projectLookupId: null,
        values: {},
      });
    });

    await waitFor(() =>
      expect(result.current.list.data?.some((e) => e.logNo === "269001")).toBe(true),
    );
  });
});

describe("useUpdateEcnFields", () => {
  it("patches optimistically", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ update: useUpdateEcnFields(), list: useEcns() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.update.mutateAsync({
        id: 1,
        fields: { field_12: "Complete" },
        patch: (e) => ({ ...e, values: { ...e.values, signOffStatus: "Complete" } }),
      });
    });

    await waitFor(() =>
      expect(
        result.current.list.data?.find((e) => e.id === 1)?.values.signOffStatus,
      ).toBe("Complete"),
    );
  });
});

describe("useAddEcnComment", () => {
  it("emails the submitter even with nobody mentioned", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddEcnComment(), list: useEcns() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.add.mutateAsync({
        id: 1, // submitted by Sarah Shaffer in the fixtures
        comment: {
          authorName: "Ray White",
          authorEmail: "ray.white@altronic-llc.com",
          bodyHtml: "<p>SAP updated.</p>",
        },
      });
    });

    await waitFor(() => expect(notifyMentions).toHaveBeenCalled());
    const call = notifyMentions.mock.calls[0][0] as {
      recipients: Array<{ email: string; reason: string }>;
      target: { kind: string };
    };
    expect(call.target.kind).toBe("ecn");
    expect(call.recipients).toEqual([
      expect.objectContaining({
        email: "sarah.shaffer@altronic-llc.com",
        reason: "submitted",
      }),
    ]);
  });

  it("emails the mentioned alongside the submitter", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddEcnComment(), list: useEcns() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.add.mutateAsync({
        id: 1,
        comment: {
          authorName: "Ray White",
          authorEmail: "ray.white@altronic-llc.com",
          bodyHtml: mention("jerrod.waldron@altronic-llc.com", "Jerrod"),
        },
      });
    });

    await waitFor(() => expect(notifyMentions).toHaveBeenCalled());
    const call = notifyMentions.mock.calls[0][0] as {
      recipients: Array<{ email: string }>;
    };
    expect(call.recipients.map((r) => r.email).sort()).toEqual([
      "jerrod.waldron@altronic-llc.com",
      "sarah.shaffer@altronic-llc.com",
    ]);
  });

  // The whole point of the ECN rule: no watchers anywhere, and a mention
  // doesn't subscribe anyone to the thread either.
  it("doesn't add the mentioned person as a watcher", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddEcnComment(), list: useEcns() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.add.mutateAsync({
        id: 1,
        comment: {
          authorName: "Ray White",
          authorEmail: "ray.white@altronic-llc.com",
          bodyHtml: mention("jerrod.waldron@altronic-llc.com", "Jerrod"),
        },
      });
    });

    const ecn = result.current.list.data?.find((e) => e.id === 1);
    expect(ecn).toBeDefined();
    expect(ecn).not.toHaveProperty("watchers");
  });

  it("sends nothing when the author is the submitter and mentioned nobody", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddEcnComment(), list: useEcns() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.add.mutateAsync({
        id: 2, // submitted by Ray White in the fixtures
        comment: {
          authorName: "Ray White",
          authorEmail: "ray.white@altronic-llc.com",
          bodyHtml: "<p>Note to self.</p>",
        },
      });
    });

    expect(notifyMentions).not.toHaveBeenCalled();
  });
});

describe("useEditEcnComment", () => {
  it("emails only the newly mentioned", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddEcnComment(), edit: useEditEcnComment(), list: useEcns() }),
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

    const posted = result.current.list.data?.find((e) => e.id === 3)?.comments[0];
    expect(posted).toBeDefined();

    await act(async () => {
      await result.current.edit.mutateAsync({
        id: 3,
        target: {
          timestamp: posted!.timestamp,
          authorEmail: "ray.white@altronic-llc.com",
        },
        previousBodyHtml: mention("jerrod.waldron@altronic-llc.com", "Jerrod"),
        bodyHtml:
          mention("jerrod.waldron@altronic-llc.com", "Jerrod") +
          mention("sarah.shaffer@altronic-llc.com", "Sarah"),
      });
    });

    await waitFor(() => expect(notifyMentions).toHaveBeenCalled());
    const call = notifyMentions.mock.calls[0][0] as { recipients: Array<{ email: string }> };
    expect(call.recipients.map((r) => r.email)).toEqual(["sarah.shaffer@altronic-llc.com"]);
  });

  it("sends nothing when the edit added no mentions", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddEcnComment(), edit: useEditEcnComment(), list: useEcns() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.add.mutateAsync({
        id: 4,
        comment: {
          authorName: "Ray White",
          authorEmail: "ray.white@altronic-llc.com",
          bodyHtml: "<p>Frist</p>",
        },
      });
    });
    notifyMentions.mockClear();

    const posted = result.current.list.data?.find((e) => e.id === 4)?.comments[0];
    await act(async () => {
      await result.current.edit.mutateAsync({
        id: 4,
        target: {
          timestamp: posted!.timestamp,
          authorEmail: "ray.white@altronic-llc.com",
        },
        previousBodyHtml: "<p>Frist</p>",
        bodyHtml: "<p>First</p>",
      });
    });

    expect(notifyMentions).not.toHaveBeenCalled();
  });
});
