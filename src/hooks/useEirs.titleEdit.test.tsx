import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Renaming an EIR reaches the EIR list and board (2026-10-27). Both screens
// render `eir.title` from the same list cache the detail page reads, so the
// rename must survive the refetch that follows the save — not only the
// optimistic patch. Reported together with the task-list bug (whose cause was
// the numbered title, lib/taskNumbering.ts).
// =============================================================================

vi.mock("@/api/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/email")>()),
  notifyMentions: vi.fn(() => Promise.resolve({ sent: [], failed: [] })),
  fireFieldChangeAlert: vi.fn(),
}));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

import { useEirs, useUpdateEirFields } from "./useEirs";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useUpdateEirFields — a title edit", () => {
  it("lands in the list the EIR list and board render, and survives the refetch", async () => {
    const { result } = renderHook(() => ({ list: useEirs(), update: useUpdateEirFields() }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const id = result.current.list.data![0].id;

    await act(() => result.current.update.mutateAsync({ id, fields: { Title: "Renamed from the detail page" } }));

    // After the save settles and the list is fetched again.
    await waitFor(() => expect(result.current.list.isFetching).toBe(false));
    expect(result.current.list.data!.find((e) => e.id === id)?.title).toBe("Renamed from the detail page");
  });
});
