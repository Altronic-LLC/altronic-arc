import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useAddSupplierContactComment,
  useCreateSupplierContact,
  useDeleteSupplierContact,
  useSupplierContacts,
  useSupplierContactsFor,
  useUpdateSupplierContactFields,
} from "./useSupplierContacts";

const notifyMentions = vi.hoisted(() =>
  vi.fn((_input: unknown) => Promise.resolve({ sent: [], failed: [] })),
);

vi.mock("@/api/email", () => ({ notifyMentions }));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 }),
}));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));

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

describe("useSupplierContactsFor", () => {
  it("scopes contacts to one supplier, and returns [] for a null id", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(() => useSupplierContactsFor(25), { wrapper });
    await waitFor(() => expect(result.current.data.length).toBeGreaterThan(0));
    expect(result.current.data.every((c) => c.supplierId === 25)).toBe(true);

    const { result: nullResult } = renderHook(() => useSupplierContactsFor(null), { wrapper });
    expect(nullResult.current.data).toEqual([]);
  });
});

describe("create / update / delete", () => {
  it("round-trips a contact, auto-watching the creator", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({
        create: useCreateSupplierContact(),
        update: useUpdateSupplierContactFields(),
        remove: useDeleteSupplierContact(),
        list: useSupplierContacts(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    let id = 0;
    await act(async () => {
      const created = await result.current.create.mutateAsync({
        name: "New Contact",
        firstName: "New",
        lastName: "Contact",
        supplierId: 25,
        email: "",
        phone: "",
        status: null,
        contactNotes: "",
        watchers: [],
      });
      id = created.id;
    });
    expect(result.current.list.data?.find((c) => c.id === id)?.watchers.some((w) => w.email === "ray.white@altronic-llc.com")).toBe(true);

    await act(async () => {
      await result.current.update.mutateAsync({ id, changed: { phone: "555-1234" } });
    });
    expect(result.current.list.data?.find((c) => c.id === id)?.phone).toBe("555-1234");

    await act(async () => {
      await result.current.remove.mutateAsync(id);
    });
    expect(result.current.list.data?.some((c) => c.id === id)).toBe(false);
  });
});

describe("useAddSupplierContactComment", () => {
  it("emails only watchers + mentioned — a contact has no assignee", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({ add: useAddSupplierContactComment(), list: useSupplierContacts() }),
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
      recipients: Array<{ email: string }>;
      target: { kind: string };
    };
    expect(call.target.kind).toBe("supplierContact");
    expect(call.recipients.map((r) => r.email)).toContain("jerrod.waldron@altronic-llc.com");
  });
});
