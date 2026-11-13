import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { __resetPartsRolesMockStore } from "@/api/partsRoles";
import { __resetAltronicPartsMockStore, listAltronicParts } from "@/api/altronicParts";
import { __resetAltronicComponentsMockStore } from "@/api/altronicComponents";
import type { AltronicPart, PartsRoleEntry } from "@/types/task";

// =============================================================================
// A part's page reads its ONE row, and a list's screen reads ITS rows — neither
// starts the ~14,000-row Part List download (Tim, 2026-10-26). What matters:
//  - the whole-list query is never fetched by them;
//  - a whole list already cached shows at once, and the fresher copy wins;
//  - a write lands in the single-row and list caches too, and an edit made
//    before the whole list loaded still emails the SAP admins what changed.
// Mock mode; the demo user is the actor.
// =============================================================================

const notifyChangeEmails = vi.hoisted(() => vi.fn(async () => ({ sent: [], failed: [] })));
vi.mock("@/api/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/email")>();
  return { ...actual, notifyChangeEmails };
});
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

import {
  ALTRONIC_PARTS_KEY,
  PARTS_SLICE_KEY,
  upsert,
  useAltronicPart,
  useAltronicPartsInLists,
  useUpdateAltronicPart,
} from "./useAltronicParts";

const DEMO = "demo.user@altronic-llc.com";
const role = (id: number, email: string, displayName: string, roles: PartsRoleEntry["roles"]): PartsRoleEntry => ({
  id,
  email,
  displayName,
  roles,
  note: "",
});
const SHEILA = role(4, "sheila.horn@altronic-llc.com", "Sheila Horn", ["sap admin"]);

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, Wrapper };
}

/** Has the whole Part List been downloaded into this client? */
function wholeListFetched(qc: QueryClient): boolean {
  return (qc.getQueryCache().find({ queryKey: ALTRONIC_PARTS_KEY, exact: true })?.state.dataUpdateCount ?? 0) > 0;
}

async function part309(): Promise<AltronicPart> {
  return (await listAltronicParts()).find((p) => p.partNumber === "309114")!;
}

beforeEach(() => {
  notifyChangeEmails.mockClear();
  __resetAltronicPartsMockStore();
  __resetAltronicComponentsMockStore();
  __resetPartsRolesMockStore();
});

describe("useAltronicPart — a part's page", () => {
  it("reads the one part, without downloading the whole list", async () => {
    const target = await part309();
    const { qc, Wrapper } = wrapper();
    const { result } = renderHook(() => useAltronicPart(target.id), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.part?.partNumber).toBe("309114"));
    expect(wholeListFetched(qc)).toBe(false);
  });

  it("shows a whole list already cached at once", async () => {
    const target = await part309();
    const { qc, Wrapper } = wrapper();
    qc.setQueryData(ALTRONIC_PARTS_KEY, [target]);
    const { result } = renderHook(() => useAltronicPart(target.id), { wrapper: Wrapper });
    expect(result.current.part?.partNumber).toBe("309114");
    expect(result.current.isLoading).toBe(false);
  });

  it("prefers its own fresh read over an older cached copy", async () => {
    const target = await part309();
    const { qc, Wrapper } = wrapper();
    qc.setQueryData(ALTRONIC_PARTS_KEY, [{ ...target, description: "STALE", modifiedAt: new Date(0) }]);
    const { result } = renderHook(() => useAltronicPart(target.id), { wrapper: Wrapper });
    expect(result.current.part?.description).toBe("STALE");
    await waitFor(() => expect(result.current.part?.description).toBe(target.description));
  });

  it("keeps the cached copy when IT is the newer one", async () => {
    const target = await part309();
    const { qc, Wrapper } = wrapper();
    const later = new Date(target.modifiedAt.getTime() + 60_000);
    qc.setQueryData(ALTRONIC_PARTS_KEY, [{ ...target, description: "EDITED JUST NOW", modifiedAt: later }]);
    const { result } = renderHook(() => useAltronicPart(target.id), { wrapper: Wrapper });
    await waitFor(() =>
      expect(qc.getQueryData([PARTS_SLICE_KEY, "part", "item", target.id])).toBeTruthy(),
    );
    expect(result.current.part?.description).toBe("EDITED JUST NOW");
  });

  it("is null for a part that isn't on the list, and for an id that isn't a number", async () => {
    const { Wrapper } = wrapper();
    const missing = renderHook(() => useAltronicPart(987654), { wrapper: Wrapper });
    await waitFor(() => expect(missing.result.current.part).toBeNull());
    const junk = renderHook(() => useAltronicPart(Number("abc")), { wrapper: Wrapper });
    expect(junk.result.current.part).toBeNull();
    expect(junk.result.current.isLoading).toBe(false);
  });

  it("an edit before the whole list has loaded still emails what changed, and shows at once", async () => {
    __resetPartsRolesMockStore([role(1, DEMO, "Demo User", ["hco editor"]), SHEILA]);
    const target = await part309();
    const { qc, Wrapper } = wrapper();
    const { result } = renderHook(() => ({ page: useAltronicPart(target.id), edit: useUpdateAltronicPart() }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.page.part).toBeTruthy());
    await act(() => result.current.edit.mutateAsync({ id: target.id, patch: { sapNumber: "1003-0114-40" } }));
    expect(result.current.page.part?.sapNumber).toBe("1003-0114-40");
    await waitFor(() => expect(notifyChangeEmails).toHaveBeenCalled());
    const calls = notifyChangeEmails.mock.calls as unknown as Array<[{ emails: Array<{ email: string }> }]>;
    expect(calls[0][0].emails.map((e) => e.email)).toEqual([SHEILA.email]);
    expect(wholeListFetched(qc)).toBe(false);
  });
});

describe("useAltronicPartsInLists — one list's screen", () => {
  it("reads that list's live parts, without downloading the whole list", async () => {
    const { qc, Wrapper } = wrapper();
    const { result } = renderHook(() => useAltronicPartsInLists(["309"]), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.rows?.map((p) => p.partNumber)).toEqual(["309114", "309115"]));
    expect(result.current.sourceEmpty).toBe(false);
    expect(wholeListFetched(qc)).toBe(false);
  });

  it("shows the whole list's rows for it at once when that is cached", async () => {
    const all = await listAltronicParts();
    const { qc, Wrapper } = wrapper();
    qc.setQueryData(ALTRONIC_PARTS_KEY, all);
    const { result } = renderHook(() => useAltronicPartsInLists(["309"]), { wrapper: Wrapper });
    expect(result.current.rows?.map((p) => p.partNumber)).toEqual(["309114", "309115"]);
  });

  it("an empty list on a list that has rows is just empty — not a permission problem", async () => {
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useAltronicPartsInLists(["411"]), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.state.isLoading).toBe(false));
    expect(result.current.rows).toEqual([]);
    expect(result.current.sourceEmpty).toBe(false);
  });
});

describe("upsert — a written row lands in every cache that holds it", () => {
  it("updates the single-row read and the list slices, and adds a new part only to its own list", async () => {
    const target = await part309();
    const { qc } = wrapper();
    qc.setQueryData([PARTS_SLICE_KEY, "part", "item", target.id], target);
    qc.setQueryData([PARTS_SLICE_KEY, "part", "list", "309"], [target]);
    qc.setQueryData([PARTS_SLICE_KEY, "part", "list", "604"], []);

    upsert(qc, ALTRONIC_PARTS_KEY, { ...target, description: "CHANGED" });
    expect(qc.getQueryData<AltronicPart>([PARTS_SLICE_KEY, "part", "item", target.id])?.description).toBe("CHANGED");
    expect(qc.getQueryData<AltronicPart[]>([PARTS_SLICE_KEY, "part", "list", "309"])?.[0].description).toBe("CHANGED");

    const created = { ...target, id: 99999, partNumber: "309999" };
    upsert(qc, ALTRONIC_PARTS_KEY, created);
    expect(qc.getQueryData<AltronicPart[]>([PARTS_SLICE_KEY, "part", "list", "309"])).toHaveLength(2);
    expect(qc.getQueryData<AltronicPart[]>([PARTS_SLICE_KEY, "part", "list", "604"])).toHaveLength(0);
    // Never seeds a single-row read nobody asked for.
    expect(qc.getQueryData([PARTS_SLICE_KEY, "part", "item", 99999])).toBeUndefined();
  });
});
