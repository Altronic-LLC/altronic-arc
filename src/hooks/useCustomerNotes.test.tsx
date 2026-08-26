import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  collectCustomerNotePeople,
  useAddCustomerNoteComment,
  useCreateCustomerNote,
  useCustomerNote,
  useCustomerNotes,
  useDeleteCustomerNote,
  useEditCustomerNoteComment,
  useUpdateCustomerNoteDetails,
} from "./useCustomerNotes";
import type { CustomerNote } from "@/types/task";

const notifyMentions = vi.hoisted(() =>
  vi.fn((_input: unknown) => Promise.resolve({ sent: [], failed: [] })),
);

vi.mock("@/api/email", () => ({ notifyMentions }));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

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

describe("useCustomerNotes", () => {
  it("loads the list", async () => {
    const { result } = renderHook(() => useCustomerNotes(), { wrapper: hookWrapper() });
    await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  });

  it("has nothing to show for a null id", async () => {
    const { result } = renderHook(() => useCustomerNote(null), { wrapper: hookWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeUndefined();
  });
});

describe("collectCustomerNotePeople", () => {
  it("gathers CSR and KAM, deduped", () => {
    const note = (email: string): CustomerNote =>
      ({
        csr: [{ displayName: email, email }],
        kam: { displayName: email, email },
      }) as CustomerNote;
    const people = collectCustomerNotePeople([note("a@x.com"), note("a@x.com"), note("b@x.com")]);
    expect(people.map((p) => p.email).sort()).toEqual(["a@x.com", "b@x.com"]);
  });
});

describe("useCreateCustomerNote", () => {
  it("adds one and puts it in the cache", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ create: useCreateCustomerNote(), list: useCustomerNotes() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.create.mutateAsync({
        customerName: "New Co",
        oldCustomerNumber: "",
        sapCustomerNumber: "",
        group: null,
        customerTypes: [],
        csr: [],
        kam: null,
      });
    });

    await waitFor(() =>
      expect(result.current.list.data?.some((n) => n.customerName === "New Co")).toBe(true),
    );
  });
});

describe("useUpdateCustomerNoteDetails", () => {
  it("patches the cache", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ update: useUpdateCustomerNoteDetails(), list: useCustomerNotes() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const id = result.current.list.data![0].id;

    await act(async () => {
      await result.current.update.mutateAsync({ id, changed: { customerName: "Renamed" } });
    });

    await waitFor(() =>
      expect(result.current.list.data?.find((n) => n.id === id)?.customerName).toBe("Renamed"),
    );
  });
});

describe("useDeleteCustomerNote", () => {
  it("removes it from the cache", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({
        create: useCreateCustomerNote(),
        remove: useDeleteCustomerNote(),
        list: useCustomerNotes(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    let id = 0;
    await act(async () => {
      const created = await result.current.create.mutateAsync({
        customerName: "Temp",
        oldCustomerNumber: "",
        sapCustomerNumber: "",
        group: null,
        customerTypes: [],
        csr: [],
        kam: null,
      });
      id = created.id;
    });

    await act(async () => {
      await result.current.remove.mutateAsync(id);
    });

    expect(result.current.list.data?.some((n) => n.id === id)).toBe(false);
  });
});

describe("useAddCustomerNoteComment", () => {
  it("sends nothing when nobody is mentioned", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddCustomerNoteComment(), list: useCustomerNotes() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const id = result.current.list.data![0].id;

    await act(async () => {
      await result.current.add.mutateAsync({
        id,
        comment: {
          authorName: "Ray White",
          authorEmail: "ray.white@altronic-llc.com",
          bodyHtml: "<p>Called the customer.</p>",
        },
      });
    });

    expect(notifyMentions).not.toHaveBeenCalled();
  });

  it("emails only the @-mentioned — no submitter, no watchers", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddCustomerNoteComment(), list: useCustomerNotes() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const id = result.current.list.data![0].id;

    await act(async () => {
      await result.current.add.mutateAsync({
        id,
        comment: {
          authorName: "Ray White",
          authorEmail: "ray.white@altronic-llc.com",
          bodyHtml: mention("jerrod.waldron@altronic-llc.com", "Jerrod"),
        },
      });
    });

    await waitFor(() => expect(notifyMentions).toHaveBeenCalled());
    const call = notifyMentions.mock.calls[0][0] as {
      recipients: Array<{ email: string; reason: string }>;
      target: { kind: string };
    };
    expect(call.target.kind).toBe("customerNote");
    expect(call.recipients).toEqual([
      expect.objectContaining({ email: "jerrod.waldron@altronic-llc.com", reason: "mentioned" }),
    ]);
  });
});

describe("useEditCustomerNoteComment", () => {
  it("emails only the newly mentioned", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({
        add: useAddCustomerNoteComment(),
        edit: useEditCustomerNoteComment(),
        list: useCustomerNotes(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const id = result.current.list.data![0].id;

    await act(async () => {
      await result.current.add.mutateAsync({
        id,
        comment: {
          authorName: "Ray White",
          authorEmail: "ray.white@altronic-llc.com",
          bodyHtml: mention("jerrod.waldron@altronic-llc.com", "Jerrod"),
        },
      });
    });
    notifyMentions.mockClear();

    const posted = result.current.list.data?.find((n) => n.id === id)?.comments[0];
    expect(posted).toBeDefined();

    await act(async () => {
      await result.current.edit.mutateAsync({
        id,
        target: { timestamp: posted!.timestamp, authorEmail: "ray.white@altronic-llc.com" },
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
});
