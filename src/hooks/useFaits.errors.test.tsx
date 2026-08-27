import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// FAIT writes that go wrong — and what the user is told.
//
// "A failed save appears to fail silently, which is why this went unnoticed
// across several fields" (2026-08-27). Two of those silences are pinned here,
// because both made a write that WORKED look like one that didn't:
//
//  1. **The re-read after a successful PATCH** used to be reported as
//     "FAIT n disappeared after update", and the hook rolled the change off
//     the screen. The write had landed. Rolling back is the lie.
//  2. **A create whose Initiator column couldn't be written** would have to
//     either lose the FAIT (it exists) or say nothing (it's the column people
//     reported as blank). It completes and warns.
// =============================================================================

const pushToast = vi.hoisted(() => vi.fn());
const updateFaitFields = vi.hoisted(() => vi.fn());
const createFait = vi.hoisted(() => vi.fn());
const listFaits = vi.hoisted(() => vi.fn());

vi.mock("@/api/faits", async (importOriginal) => {
  // The two error TYPES are the contract under test, so they come from the
  // real module — a hand-rolled stand-in would pass whether the hook checks
  // `instanceof` correctly or not.
  const actual = await importOriginal<typeof import("@/api/faits")>();
  return {
    ...actual,
    listFaits,
    createFait,
    updateFaitFields,
    updateFaitAssignedEngineer: vi.fn(),
    updateFaitKam: vi.fn(),
    setFaitWatchers: vi.fn(),
    addFaitComment: vi.fn(),
    editFaitComment: vi.fn(),
  };
});

vi.mock("@/api/email", () => ({
  fireFaitClosedAlert: vi.fn(),
  fireFieldChangeAlert: vi.fn(),
  fireNewFaitAlert: vi.fn(),
  notifyMentions: vi.fn(),
  notifyChangeEmails: vi.fn(),
}));

vi.mock("@/components/Toast", () => ({ pushToast }));

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));

vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

import { FaitInitiatorNotSetError, FaitReadBackError } from "@/api/faits";
import { FAITS_KEY, useCreateFait, useFaits, useUpdateFaitFields } from "./useFaits";
import type { Fait } from "@/types/task";

function aFait(overrides: Partial<Fait> = {}): Fait {
  return {
    id: 1,
    title: "",
    status: "Open",
    parentProject: null,
    eirLookupId: null,
    testDocumentLookupId: null,
    initiator: null,
    assignedEngineer: null,
    kam: null,
    watchers: [],
    comments: [],
    hasAttachments: false,
    values: { sapPartNumber: "710213", description: "Bearing" },
    createdAt: new Date("2026-08-01T12:00:00Z"),
    modifiedAt: new Date("2026-08-01T12:00:00Z"),
    ...overrides,
  };
}

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

/**
 * Load the list, then stop observing it — the cache keeps its data.
 *
 * `onSettled` invalidates after every outcome, and an invalidation only
 * refetches a query something is still watching. Dropping the observer is
 * what makes "did the hook roll the change back" observable at all: with a
 * refetch in flight the cache ends up at the server's value either way, so
 * the assertion would pass whether the rollback happened or not.
 */
async function loadThenStopWatching(wrapper: Parameters<typeof renderHook>[1]) {
  const list = renderHook(() => useFaits(), wrapper);
  await waitFor(() => expect(list.result.current.data).toHaveLength(1));
  list.unmount();
}

/** Every message that reached a toast, whatever its variant. */
function toastMessages(): string[] {
  return pushToast.mock.calls.map(([arg]) => String((arg as { message: string }).message));
}

beforeEach(() => {
  pushToast.mockClear();
  updateFaitFields.mockReset();
  createFait.mockReset();
  listFaits.mockReset();
  listFaits.mockResolvedValue([aFait()]);
});

describe("a field write whose re-read fails afterwards", () => {
  it("KEEPS the change on screen — the PATCH landed", async () => {
    updateFaitFields.mockRejectedValue(new FaitReadBackError(1, new Error("429 throttled")));
    const { qc, wrapper } = setup();
    await loadThenStopWatching({ wrapper });

    const update = renderHook(() => useUpdateFaitFields(), { wrapper });
    await act(async () => {
      await update.result.current
        .mutateAsync({
          id: 1,
          fields: { Status: "Closed" },
          patch: (f) => ({ ...f, status: "Closed" }),
        })
        .catch(() => undefined);
    });

    expect(qc.getQueryData<Fait[]>(FAITS_KEY)?.[0].status).toBe("Closed");
  });

  it("says the change SAVED and the screen is behind, not that it failed", async () => {
    updateFaitFields.mockRejectedValue(new FaitReadBackError(1, new Error("429 throttled")));
    const { wrapper } = setup();
    await loadThenStopWatching({ wrapper });

    const update = renderHook(() => useUpdateFaitFields(), { wrapper });
    await act(async () => {
      await update.result.current
        .mutateAsync({ id: 1, fields: { Status: "Closed" }, patch: (f) => f })
        .catch(() => undefined);
    });

    const messages = toastMessages().join(" | ");
    expect(messages).toMatch(/was saved/i);
    expect(messages).not.toMatch(/reverted/i);
  });

  it("still reverts, and says so, for a write that genuinely failed", async () => {
    // The read-back case must not become a blanket "never roll back" — a
    // refused PATCH has to put the old value back.
    updateFaitFields.mockRejectedValue(new Error("Graph 403 Forbidden"));
    const { qc, wrapper } = setup();
    await loadThenStopWatching({ wrapper });

    const update = renderHook(() => useUpdateFaitFields(), { wrapper });
    await act(async () => {
      await update.result.current
        .mutateAsync({
          id: 1,
          fields: { Status: "Closed" },
          patch: (f) => ({ ...f, status: "Closed" }),
        })
        .catch(() => undefined);
    });

    expect(qc.getQueryData<Fait[]>(FAITS_KEY)?.[0].status).toBe("Open");
    expect(toastMessages().join(" | ")).toMatch(/reverted/i);
  });
});

describe("raising a FAIT whose Initiator couldn't be set", () => {
  it("completes the create rather than reporting a failure", async () => {
    const created = aFait({ id: 9, initiator: null });
    createFait.mockRejectedValue(
      new FaitInitiatorNotSetError(created, {
        displayName: "Ray White",
        email: "ray.white@altronic-llc.com",
      }),
    );
    const { qc, wrapper } = setup();

    const create = renderHook(() => useCreateFait(), { wrapper });
    let returned: Fait | undefined;
    await act(async () => {
      returned = await create.result.current.mutateAsync({
        title: "",
        status: "Open",
        projectLookupId: null,
        values: { sapPartNumber: "710213" },
      });
    });

    expect(returned?.id).toBe(9);
    expect(qc.getQueryData<Fait[]>(FAITS_KEY)?.some((f) => f.id === 9)).toBe(true);
  });

  it("warns about the one column that didn't land", async () => {
    const created = aFait({ id: 9, initiator: null });
    createFait.mockRejectedValue(
      new FaitInitiatorNotSetError(created, {
        displayName: "Ray White",
        email: "ray.white@altronic-llc.com",
      }),
    );
    const { wrapper } = setup();

    const create = renderHook(() => useCreateFait(), { wrapper });
    await act(async () => {
      await create.result.current.mutateAsync({
        title: "",
        status: "Open",
        projectLookupId: null,
        values: {},
      });
    });

    const messages = toastMessages().join(" | ");
    expect(messages).toMatch(/Initiator couldn't be set/i);
    // And the create is still reported as the success it was.
    expect(messages).toMatch(/Raised/i);
  });

  it("still fails loudly when the create itself fails", async () => {
    createFait.mockRejectedValue(new Error("Graph 400 invalidRequest"));
    const { wrapper } = setup();

    const create = renderHook(() => useCreateFait(), { wrapper });
    await act(async () => {
      await create.result.current
        .mutateAsync({ title: "", status: "Open", projectLookupId: null, values: {} })
        .catch(() => undefined);
    });

    expect(toastMessages().join(" | ")).toMatch(/Couldn't raise the FAIT/i);
  });
});
