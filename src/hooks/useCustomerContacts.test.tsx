import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useContactsFor,
  useCreateCustomerContact,
  useCustomerContacts,
  useDeleteCustomerContact,
  useUpdateCustomerContact,
} from "./useCustomerContacts";

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

function hookWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useCustomerContacts", () => {
  it("loads the list", async () => {
    const { result } = renderHook(() => useCustomerContacts(), { wrapper: hookWrapper() });
    await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  });
});

describe("useContactsFor", () => {
  it("scopes contacts to one customer, and returns [] for a null id", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(() => useContactsFor(1), { wrapper });
    await waitFor(() => expect(result.current.data.length).toBeGreaterThan(0));
    expect(result.current.data.every((c) => c.customerId === 1)).toBe(true);

    const { result: nullResult } = renderHook(() => useContactsFor(null), { wrapper });
    expect(nullResult.current.data).toEqual([]);
  });
});

describe("create / update / delete", () => {
  it("round-trips a contact through the cache", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(
      () => ({
        create: useCreateCustomerContact(),
        update: useUpdateCustomerContact(),
        remove: useDeleteCustomerContact(),
        list: useCustomerContacts(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));

    let id = 0;
    await act(async () => {
      const created = await result.current.create.mutateAsync({
        name: "New Contact",
        customerId: 1,
        email: "",
        phoneNumber: "",
        jobTitle: "",
        contactNotes: "",
      });
      id = created.id;
    });
    expect(result.current.list.data?.some((c) => c.id === id)).toBe(true);

    await act(async () => {
      await result.current.update.mutateAsync({ id, changed: { jobTitle: "Buyer" } });
    });
    expect(result.current.list.data?.find((c) => c.id === id)?.jobTitle).toBe("Buyer");

    await act(async () => {
      await result.current.remove.mutateAsync(id);
    });
    expect(result.current.list.data?.some((c) => c.id === id)).toBe(false);
  });
});
