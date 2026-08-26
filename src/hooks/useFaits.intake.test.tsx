import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// Every new FAIT tells the intake list (Ray, 2026-08-26) — same gap Gray
// Market's intake alert closed. Nothing watches the SharePoint list itself,
// so without this a raised FAIT sits until somebody opens ARC and notices it.
// =============================================================================

const fireNewFaitAlert = vi.hoisted(() => vi.fn());
const fireFieldChangeAlert = vi.hoisted(() => vi.fn());

vi.mock("@/api/email", () => ({
  fireNewFaitAlert,
  fireFieldChangeAlert,
  notifyMentions: vi.fn(),
  notifyChangeEmails: vi.fn(),
}));

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

import { useCreateFait, useUpdateFaitFields } from "./useFaits";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  fireNewFaitAlert.mockClear();
  fireFieldChangeAlert.mockClear();
});

function firedWith() {
  return fireNewFaitAlert.mock.calls[0]?.[0] as
    | {
        target: { kind: string; id: number; title: string };
        actor: { displayName: string };
        details?: Array<{ label: string; value: string }>;
      }
    | undefined;
}

async function raise(values: Record<string, string> = {}) {
  const { result } = renderHook(() => useCreateFait(), { wrapper: wrapper() });
  let id = 0;
  await act(async () => {
    const created = await result.current.mutateAsync({
      title: "",
      status: "Open",
      projectLookupId: null,
      values,
    });
    id = created.id;
  });
  await waitFor(() => expect(fireNewFaitAlert).toHaveBeenCalledTimes(1));
  return id;
}

describe("raising a FAIT", () => {
  it("alerts the intake list", async () => {
    await raise();
    expect(firedWith()?.target.kind).toBe("fait");
  });

  it("links the email to the FAIT that was just created", async () => {
    const id = await raise();
    const target = firedWith()!.target;
    expect(target.id).toBe(id);
    expect(target.title).toBeTruthy();
  });

  it("names the raiser as the actor, so they're left off their own alert", async () => {
    await raise();
    expect(firedWith()?.actor.displayName).toBe("Ray White");
  });

  it("carries the Part-section details that were filled in", async () => {
    await raise({ sapPartNumber: "691768-1", supplierName: "Wells Manufacturing" });
    const details = firedWith()?.details ?? [];
    expect(details).toEqual(
      expect.arrayContaining([
        { label: "SAP Part Number", value: "691768-1" },
        { label: "Supplier", value: "Wells Manufacturing" },
      ]),
    );
  });

  it("still alerts when the Part section is blank", async () => {
    await raise();
    expect(fireNewFaitAlert).toHaveBeenCalledTimes(1);
  });
});

describe("changing a FAIT's status", () => {
  async function raiseThenUpdate(nextStatus: string) {
    // ONE shared client — the update reads the fait back out of the SAME
    // cache the create seeded, exactly like the two hooks would in the app.
    const wrap = wrapper();
    const createHook = renderHook(() => useCreateFait(), { wrapper: wrap });
    let id = 0;
    await act(async () => {
      const created = await createHook.result.current.mutateAsync({
        title: "",
        status: "Open",
        projectLookupId: null,
        values: {},
      });
      id = created.id;
    });
    fireFieldChangeAlert.mockClear(); // only the update's own call matters below

    const updateHook = renderHook(() => useUpdateFaitFields(), { wrapper: wrap });
    await act(async () => {
      await updateHook.result.current.mutateAsync({
        id,
        fields: { Status: nextStatus },
        patch: (f) => ({ ...f, status: nextStatus }),
      });
    });
    return id;
  }

  it("fires the generic status-change alert to watchers", async () => {
    const id = await raiseThenUpdate("Closed");
    expect(fireFieldChangeAlert).toHaveBeenCalledTimes(1);
    const args = fireFieldChangeAlert.mock.calls[0][0];
    expect(args.target).toEqual({ kind: "fait", id, title: expect.any(String) });
    expect(args.fieldLabel).toBe("status");
    expect(args.from).toBe("Open");
    expect(args.to).toBe("Closed");
  });

  it("includes the initiator as a watcher-side recipient", async () => {
    await raiseThenUpdate("Closed");
    const args = fireFieldChangeAlert.mock.calls[0][0];
    // The raiser auto-watches (see createFait), so they show up in watchers.
    expect(args.watchers.some((p: { displayName: string }) => p.displayName === "Ray White")).toBe(
      true,
    );
  });
});
