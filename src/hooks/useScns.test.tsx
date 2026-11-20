import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Scn } from "@/types/task";

// =============================================================================
// The SCN hooks, driven with no screen at all: the API module is mocked so
// each test can see exactly what the hook asked it to write, and what it did
// to the cache and the mail on the way.
// =============================================================================

const api = vi.hoisted(() => ({
  listScns: vi.fn(async (): Promise<Scn[]> => []),
  getScn: vi.fn(),
  createScn: vi.fn(),
  updateScnFields: vi.fn(),
  setScnWatchers: vi.fn(),
  setScnAssigned: vi.fn(),
  setScnOwner: vi.fn(),
  addScnComment: vi.fn(),
  editScnComment: vi.fn(),
  resolveScnSiteUserLookupId: vi.fn(),
}));
const email = vi.hoisted(() => ({
  fireFieldChangeAlert: vi.fn(),
  notifyMentions: vi.fn(),
  notifyChangeEmails: vi.fn(),
}));
const pushToast = vi.hoisted(() => vi.fn());
const beginMentionAutoWatch = vi.hoisted(() => vi.fn());

vi.mock("@/api/scns", () => api);
vi.mock("@/api/email", () => email);
vi.mock("@/components/Toast", () => ({ pushToast }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));
vi.mock("./useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 }),
}));
vi.mock("./mentionAutoWatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mentionAutoWatch")>();
  return { ...actual, beginMentionAutoWatch };
});

import {
  SCNS_KEY,
  collectScnPeople,
  useAddScnComment,
  useCreateScn,
  useEditScnComment,
  useScn,
  useSetScnAssigned,
  useSetScnOwner,
  useSetScnWatchers,
  useUpdateScnFields,
} from "./useScns";

const RAY = { displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 };
const SARAH = { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com", lookupId: 120 };
const KATIE = { displayName: "Katie Fleming", email: "katie.fleming@altronic-llc.com", lookupId: 97 };
const MICHAEL = { displayName: "Michael Colaneri", email: "michael.colaneri@altronic-llc.com", lookupId: 162 };

function row(over: Partial<Scn> = {}): Scn {
  return {
    id: 7,
    scnNumber: "2026-0140",
    year: "2026",
    product: "CD200EVS",
    category: "OBS",
    status: "WIP",
    approvalStatus: "Approved",
    assignedTo: [SARAH],
    owner: [MICHAEL],
    watchers: [KATIE],
    comments: [],
    hasAttachments: false,
    values: { description: "Old" },
    checks: { projectStatus: [], preliminaryReviews: [], secondaryReview: [] },
    dates: { ltsExpires: null, ltbExpires: null, fixtureReview: null },
    taskList: null,
    createdBy: RAY,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
    ...over,
  };
}

function harness(seed: Scn[] = [row()]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(SCNS_KEY, seed);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

function cached(qc: QueryClient, id = 7): Scn | undefined {
  return qc.getQueryData<Scn[]>(SCNS_KEY)?.find((s) => s.id === id);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  for (const fn of Object.values(email)) fn.mockReset();
  pushToast.mockReset();
  beginMentionAutoWatch.mockReset();
  beginMentionAutoWatch.mockReturnValue(null);
  email.notifyMentions.mockResolvedValue({ sent: [], failed: [] });
  api.listScns.mockResolvedValue([]);
  api.resolveScnSiteUserLookupId.mockResolvedValue(9);
});

describe("useScn", () => {
  it("derives one SCN from the list cache", async () => {
    const { wrapper } = harness([row(), row({ id: 8, scnNumber: "2026-0141" })]);
    const { result } = renderHook(() => useScn(8), { wrapper });
    await waitFor(() => expect(result.current.data?.scnNumber).toBe("2026-0141"));
    const none = renderHook(() => useScn(null), { wrapper });
    expect(none.result.current.data).toBeUndefined();
  });
});

describe("useCreateScn", () => {
  it("folds the creator, assignees and owners into Watchers and seeds the cache", async () => {
    const created = row({ id: 9, scnNumber: "2026-0149" });
    api.createScn.mockResolvedValue(created);
    const { qc, wrapper } = harness([row()]);
    const { result } = renderHook(() => useCreateScn(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        product: "X",
        category: "OBS",
        approvalStatus: "Approved",
        assignedTo: [SARAH],
        owner: [MICHAEL],
        values: {},
      }),
    );

    const sent = api.createScn.mock.calls[0][0];
    expect(sent.watchers.map((p: { displayName: string }) => p.displayName).sort()).toEqual(
      ["Michael Colaneri", "Ray White", "Sarah Shaffer"],
    );
    // Seeded, not merely invalidated — the form navigates to /scn/9 at once.
    expect(cached(qc, 9)?.scnNumber).toBe("2026-0149");
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("2026-0149") }));
  });

  it("toasts a refused create in words", async () => {
    api.createScn.mockRejectedValue(new Error("Graph 403 Forbidden: accessDenied"));
    const { wrapper } = harness();
    const { result } = renderHook(() => useCreateScn(), { wrapper });
    await act(() =>
      expect(
        result.current.mutateAsync({ product: "X", category: "", approvalStatus: "Approved", assignedTo: [], owner: [], values: {} }),
      ).rejects.toThrow(),
    );
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: expect.stringContaining("ALTRONICSALESTEAM / SCN") }),
    );
  });
});

describe("useUpdateScnFields", () => {
  it("patches the cache optimistically and hands the API the PRE-patch row", async () => {
    let seenPrevious: Scn | undefined;
    let cacheDuringWrite: Scn | undefined;
    const { qc, wrapper } = harness();
    api.updateScnFields.mockImplementation(async (_id: number, _patch: unknown, previous: Scn) => {
      seenPrevious = previous;
      cacheDuringWrite = cached(qc);
      return row({ status: "CLOSED" });
    });
    const { result } = renderHook(() => useUpdateScnFields(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 7, patch: { status: "CLOSED" } }));

    expect(cacheDuringWrite?.status).toBe("CLOSED"); // optimistic
    expect(seenPrevious?.status).toBe("WIP"); // the row BEFORE the patch — what the diff needs
    expect(cached(qc)?.status).toBe("CLOSED");
    expect(api.updateScnFields).toHaveBeenCalledWith(7, { status: "CLOSED" }, expect.objectContaining({ status: "WIP" }));
  });

  it("reads the row fresh when it isn't cached", async () => {
    const { wrapper } = harness([]);
    api.getScn.mockResolvedValue(row());
    api.updateScnFields.mockResolvedValue(row({ status: "CLOSED" }));
    const { result } = renderHook(() => useUpdateScnFields(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 7, patch: { status: "CLOSED" } }));
    expect(api.getScn).toHaveBeenCalledWith(7);
    expect(api.updateScnFields).toHaveBeenCalled();
  });

  it("fires the status alert to watchers + assignees + owners when Status actually changed", async () => {
    const { wrapper } = harness();
    api.updateScnFields.mockResolvedValue(row({ status: "CLOSED" }));
    const { result } = renderHook(() => useUpdateScnFields(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 7, patch: { status: "CLOSED" } }));

    expect(email.fireFieldChangeAlert).toHaveBeenCalledTimes(1);
    const arg = email.fireFieldChangeAlert.mock.calls[0][0];
    expect(arg.target).toMatchObject({ kind: "scn", id: 7 });
    expect(arg.fieldLabel).toBe("SCN Status");
    expect(arg.from).toBe("WIP");
    expect(arg.to).toBe("CLOSED");
    expect(arg.actor.email).toBe("ray.white@altronic-llc.com");
    expect(arg.watchers).toEqual([KATIE]);
    expect(arg.assignees.map((p: { displayName: string }) => p.displayName).sort()).toEqual(
      ["Michael Colaneri", "Sarah Shaffer"],
    );
  });

  it("stays quiet when the status is re-saved unchanged — presence is not change", async () => {
    // The fixture is ALREADY at the target status; a fixture starting
    // elsewhere passes whether the guard exists or not.
    const { wrapper } = harness([row({ status: "CLOSED" })]);
    api.updateScnFields.mockResolvedValue(row({ status: "CLOSED" }));
    const { result } = renderHook(() => useUpdateScnFields(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 7, patch: { status: "CLOSED", description: "x" } }));
    expect(email.fireFieldChangeAlert).not.toHaveBeenCalled();
  });

  it("stays quiet for a change to anything but Status", async () => {
    const { wrapper } = harness();
    api.updateScnFields.mockResolvedValue(row({ values: { description: "New" } }));
    const { result } = renderHook(() => useUpdateScnFields(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 7, patch: { description: "New" } }));
    expect(email.fireFieldChangeAlert).not.toHaveBeenCalled();
  });

  it("rolls back and toasts the refusal in words", async () => {
    const { qc, wrapper } = harness();
    api.updateScnFields.mockRejectedValue(new Error("Graph 403 Forbidden: accessDenied"));
    const { result } = renderHook(() => useUpdateScnFields(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ id: 7, patch: { status: "CLOSED" } })).rejects.toThrow());
    expect(cached(qc)?.status).toBe("WIP");
    const toast = pushToast.mock.calls[0][0];
    expect(toast.variant).toBe("error");
    expect(toast.message).toMatch(/SharePoint wouldn't let you save that change/);
    expect(toast.message).toContain("ALTRONICSALESTEAM / SCN");
    expect(toast.message).toContain("editing");
  });
});

describe("people", () => {
  it("useSetScnWatchers patches optimistically and lands the returned row", async () => {
    const { qc, wrapper } = harness();
    api.setScnWatchers.mockResolvedValue(row({ watchers: [KATIE, RAY] }));
    const { result } = renderHook(() => useSetScnWatchers(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 7, people: [KATIE, RAY] }));
    expect(api.setScnWatchers).toHaveBeenCalledWith(7, [KATIE, RAY]);
    expect(cached(qc)?.watchers).toEqual([KATIE, RAY]);
  });

  it("useSetScnAssigned shows the assignee as a watcher immediately, and reverts on failure", async () => {
    const { qc, wrapper } = harness();
    let duringWrite: Scn | undefined;
    api.setScnAssigned.mockImplementation(async () => {
      duringWrite = cached(qc);
      throw new Error("nope");
    });
    const { result } = renderHook(() => useSetScnAssigned(), { wrapper });
    await act(() => expect(result.current.mutateAsync({ id: 7, people: [RAY] })).rejects.toThrow());
    expect(duringWrite?.assignedTo).toEqual([RAY]);
    expect(duringWrite?.watchers.map((w) => w.displayName)).toEqual(["Katie Fleming", "Ray White"]);
    // Rolled back.
    expect(cached(qc)?.assignedTo).toEqual([SARAH]);
    expect(cached(qc)?.watchers).toEqual([KATIE]);
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("useSetScnOwner writes through setScnOwner", async () => {
    const { qc, wrapper } = harness();
    api.setScnOwner.mockResolvedValue(row({ owner: [RAY], watchers: [KATIE, RAY] }));
    const { result } = renderHook(() => useSetScnOwner(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 7, people: [RAY] }));
    expect(api.setScnOwner).toHaveBeenCalledWith(7, [RAY]);
    expect(cached(qc)?.owner).toEqual([RAY]);
  });
});

const mention = (p: { displayName: string; email: string }) =>
  `<span class="mention" data-email="${p.email}">@${p.displayName}</span>`;

describe("useAddScnComment", () => {
  it("inserts optimistically and notifies watchers + assignees + owners + mentions, minus the author", async () => {
    const { qc, wrapper } = harness();
    api.addScnComment.mockImplementation(async () => cached(qc)!);
    const { result } = renderHook(() => useAddScnComment(), { wrapper });
    const bodyHtml = `<p>${mention(RAY)} please look</p>`;

    await act(() =>
      result.current.mutateAsync({
        id: 7,
        comment: { authorName: "Katie Fleming", authorEmail: KATIE.email, bodyHtml },
      }),
    );

    expect(cached(qc)?.comments[0].bodyHtml).toBe(bodyHtml);
    expect(email.notifyMentions).toHaveBeenCalledTimes(1);
    const arg = email.notifyMentions.mock.calls[0][0];
    expect(arg.target).toMatchObject({ kind: "scn", id: 7 });
    const byEmail = Object.fromEntries(arg.recipients.map((r: { email: string; reason: string }) => [r.email, r.reason]));
    expect(byEmail[RAY.email]).toBe("mentioned");
    expect(byEmail[SARAH.email]).toBe("assigned"); // Assigned to
    expect(byEmail[MICHAEL.email]).toBe("assigned"); // Owner counts as assigned too
    expect(byEmail).not.toHaveProperty(KATIE.email); // the author, though watching
  });

  it("starts the mention auto-watch against the SCN site's resolver, and commits it on success", async () => {
    const handle = { commit: vi.fn(), cancel: vi.fn(), settled: Promise.resolve() };
    beginMentionAutoWatch.mockReturnValue(handle as never);
    const { qc, wrapper } = harness();
    api.addScnComment.mockImplementation(async () => cached(qc)!);
    const { result } = renderHook(() => useAddScnComment(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        id: 7,
        comment: { authorName: "Katie", authorEmail: KATIE.email, bodyHtml: `<p>${mention(RAY)}</p>` },
      }),
    );

    expect(beginMentionAutoWatch).toHaveBeenCalledTimes(1);
    const args = beginMentionAutoWatch.mock.calls[0][0] as unknown as {
      resolveLookupId: unknown;
      currentWatchers: unknown;
      noun: string;
      write: (p: unknown[]) => Promise<unknown>;
    };
    expect(args.resolveLookupId).toBe(api.resolveScnSiteUserLookupId);
    expect(args.currentWatchers).toEqual([KATIE]);
    expect(args.noun).toBe("SCN");
    await args.write([RAY]);
    expect(api.setScnWatchers).toHaveBeenCalledWith(7, [RAY]);
    expect(handle.commit).toHaveBeenCalled();
    expect(handle.cancel).not.toHaveBeenCalled();
  });

  it("cancels the auto-watch and rolls back when the comment fails", async () => {
    const handle = { commit: vi.fn(), cancel: vi.fn(), settled: Promise.resolve() };
    beginMentionAutoWatch.mockReturnValue(handle as never);
    const { qc, wrapper } = harness();
    api.addScnComment.mockRejectedValue(new Error("409"));
    const { result } = renderHook(() => useAddScnComment(), { wrapper });

    await act(() =>
      expect(
        result.current.mutateAsync({
          id: 7,
          comment: { authorName: "Katie", authorEmail: KATIE.email, bodyHtml: `<p>${mention(RAY)}</p>` },
        }),
      ).rejects.toThrow(),
    );

    expect(handle.cancel).toHaveBeenCalled();
    expect(handle.commit).not.toHaveBeenCalled();
    expect(cached(qc)?.comments).toEqual([]);
    expect(email.notifyMentions).not.toHaveBeenCalled();
  });
});

describe("useEditScnComment", () => {
  it("emails ONLY the newly mentioned", async () => {
    const { qc, wrapper } = harness();
    api.editScnComment.mockImplementation(async () => cached(qc)!);
    const { result } = renderHook(() => useEditScnComment(), { wrapper });
    const target = { timestamp: new Date(), authorEmail: KATIE.email };

    await act(() =>
      result.current.mutateAsync({
        id: 7,
        target,
        previousBodyHtml: `<p>${mention(RAY)}</p>`,
        bodyHtml: `<p>${mention(RAY)} ${mention(SARAH)}</p>`,
      }),
    );

    expect(api.editScnComment).toHaveBeenCalledWith(7, target, `<p>${mention(RAY)} ${mention(SARAH)}</p>`);
    const arg = email.notifyMentions.mock.calls[0][0];
    expect(arg.recipients.map((r: { email: string }) => r.email)).toEqual([SARAH.email]);
    expect(arg.recipients[0].reason).toBe("mentioned");
  });

  it("sends nothing when the edit adds no mention", async () => {
    const { qc, wrapper } = harness();
    api.editScnComment.mockImplementation(async () => cached(qc)!);
    const { result } = renderHook(() => useEditScnComment(), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        id: 7,
        target: { timestamp: new Date(), authorEmail: KATIE.email },
        previousBodyHtml: "<p>a</p>",
        bodyHtml: "<p>b</p>",
      }),
    );
    expect(email.notifyMentions).not.toHaveBeenCalled();
    // No new mention → no auto-watch is even started.
    expect(beginMentionAutoWatch).not.toHaveBeenCalled();
  });
});

describe("collectScnPeople", () => {
  it("gathers assignees, owners, watchers and the raiser, de-duped", () => {
    const people = collectScnPeople([row(), row({ id: 8, assignedTo: [RAY], owner: [], watchers: [SARAH] })]);
    expect(people.map((p) => p.displayName)).toEqual([
      "Katie Fleming",
      "Michael Colaneri",
      "Ray White",
      "Sarah Shaffer",
    ]);
  });
});
