import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Posting an EIR comment hands it to the fan-out, so it reaches the task the
// EIR was promoted into (2026-10-27). The routing itself is tested in
// useCommentMirror.eir.test.tsx; this pins the one line that wires the EIR
// thread to it, which is the line that would quietly go missing.
// =============================================================================

const fanOutComment = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/hooks/useCommentMirror", () => ({ fanOutComment }));
vi.mock("@/api/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/email")>()),
  notifyMentions: vi.fn(() => Promise.resolve({ sent: [], failed: [] })),
}));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

import { useAddEirComment, useEirs } from "./useEirs";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useAddEirComment → the EIR ⇄ task mirror", () => {
  it("fans a posted EIR comment out, as an EIR", async () => {
    const { result } = renderHook(() => ({ add: useAddEirComment(), list: useEirs() }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
    const id = result.current.list.data![0].id;
    const comment = { authorName: "Ray White", authorEmail: "ray.white@altronic-llc.com", bodyHtml: "<p>hi</p>" };

    await act(() => result.current.add.mutateAsync({ id, comment }));

    expect(fanOutComment).toHaveBeenCalledTimes(1);
    expect(fanOutComment).toHaveBeenCalledWith(
      expect.objectContaining({ source: { kind: "eir", id }, comment }),
    );
  });
});
