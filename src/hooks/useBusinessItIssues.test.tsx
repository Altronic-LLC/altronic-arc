import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FeatureRequest } from "@/types/task";
import { featureRequestMarker, type GitHubIssue } from "@/lib/featureRequestIssues";

const state = vi.hoisted(() => ({ emails: ["ray.white@altronic-llc.com"] as string[] }));

vi.mock("@/api/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/config")>();
  return { ...actual, USE_MOCK: false };
});
vi.mock("./useCurrentUser", () => ({ useCurrentUserEmails: () => state.emails }));

const api = vi.hoisted(() => ({
  listBusinessItIssues: vi.fn(),
  listBusinessItLabels: vi.fn(),
  createBusinessItIssue: vi.fn(),
  addIssueToBusinessItProject: vi.fn(),
  getBusinessItIssue: vi.fn(),
  updateBusinessItIssueBody: vi.fn(),
}));
vi.mock("@/api/githubIssues", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/githubIssues")>();
  return { ...actual, ...api };
});

import {
  BUSINESS_IT_BOARD_KEY,
  BUSINESS_IT_ISSUES_KEY,
  useCreateBusinessItIssue,
  useLinkBusinessItIssue,
} from "./useBusinessItIssues";
import { setGitHubToken } from "./useGitHubToken";

const REQUEST = { id: 12, title: "Dark mode", description: "", department: null, priority: null,
  status: "Pending Review", requestedBy: null } as unknown as FeatureRequest;

function issue(number: number, body = ""): GitHubIssue {
  return { number, nodeId: `I_${number}`, title: `#${number}`, state: "open", htmlUrl: `u/${number}`, body };
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...renderHook(() => useCreateBusinessItIssue(), { wrapper }) };
}

beforeEach(() => {
  state.emails = ["ray.white@altronic-llc.com"];
  for (const fn of Object.values(api)) fn.mockReset();
  api.listBusinessItLabels.mockResolvedValue(["ARC"]);
  setGitHubToken("tok");
});

describe("useCreateBusinessItIssue", () => {
  it("creates the issue with the saved token and puts it on the board", async () => {
    api.listBusinessItIssues.mockResolvedValue([issue(1)]);
    api.createBusinessItIssue.mockResolvedValue(issue(27));
    api.addIssueToBusinessItProject.mockResolvedValue(undefined);
    const { result, qc } = setup();
    qc.setQueryData(BUSINESS_IT_BOARD_KEY, { 1: "Done" });

    const out = await act(() => result.current.mutateAsync(REQUEST));

    expect(out).toEqual({ issue: issue(27), alreadyExisted: false, projectError: null });
    // Issue Status reads Backlog straight away, without re-reading the board.
    expect(qc.getQueryData(BUSINESS_IT_BOARD_KEY)).toEqual({ 1: "Done", 27: "Backlog" });
    const [token, draft] = api.createBusinessItIssue.mock.calls[0];
    expect(token).toBe("tok");
    expect(draft.labels).toEqual(["ARC"]);
    expect(draft.title).toBe("ARC: Dark mode");
    expect(draft.body).toContain(featureRequestMarker(12));
    // The LIVE app, never the dev server's localhost (BusinessIT #28 had one).
    expect(draft.body).toContain("https://altronic-llc.github.io/altronic-arc/feature-request/12");
    expect(api.addIssueToBusinessItProject).toHaveBeenCalledWith("tok", "I_27");
    // Cache updated so the row turns into a link without another scan.
    expect(qc.getQueryData<GitHubIssue[]>(BUSINESS_IT_ISSUES_KEY)?.map((i) => i.number)).toEqual([27, 1]);
  });

  it("re-scans first and creates NOTHING when the issue appeared in the meantime", async () => {
    // Ray and Tim on the same request: the cached scan says "none", GitHub says #31.
    api.listBusinessItIssues.mockResolvedValue([issue(31, featureRequestMarker(12))]);
    const { result } = setup();

    const out = await act(() => result.current.mutateAsync(REQUEST));

    expect(out.alreadyExisted).toBe(true);
    expect(out.issue.number).toBe(31);
    expect(api.createBusinessItIssue).not.toHaveBeenCalled();
  });

  it("still succeeds, with a warning, when the board add is refused", async () => {
    api.listBusinessItIssues.mockResolvedValue([]);
    api.createBusinessItIssue.mockResolvedValue(issue(27));
    api.addIssueToBusinessItProject.mockRejectedValue(new Error("Resource not accessible"));
    const { result, qc } = setup();
    qc.setQueryData(BUSINESS_IT_BOARD_KEY, {});

    const out = await act(() => result.current.mutateAsync(REQUEST));

    expect(out.issue.number).toBe(27);
    expect(out.projectError).toBe("Resource not accessible");
    // Not on the board, so it must not CLAIM Backlog.
    expect(qc.getQueryData(BUSINESS_IT_BOARD_KEY)).toEqual({});
  });

  it("refuses anyone but Ray and Tim, before touching GitHub", async () => {
    state.emails = ["sheila.horn@altronic-llc.com"];
    const { result } = setup();

    await act(() => expect(result.current.mutateAsync(REQUEST)).rejects.toThrow(/Ray White and Tim Webster/));

    expect(api.listBusinessItIssues).not.toHaveBeenCalled();
    expect(api.createBusinessItIssue).not.toHaveBeenCalled();
  });
});

function setupLink() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...renderHook(() => useLinkBusinessItIssue(), { wrapper }) };
}

describe("useLinkBusinessItIssue", () => {
  it("appends the link to the issue's CURRENT body and updates the scan", async () => {
    api.getBusinessItIssue.mockResolvedValue(issue(5, "Edited since the scan\n\n"));
    api.updateBusinessItIssueBody.mockImplementation(async (_t, n, body) => issue(n, body));
    const { result, qc } = setupLink();
    qc.setQueryData(BUSINESS_IT_ISSUES_KEY, [issue(5, "stale"), issue(6)]);

    const out = await act(() => result.current.mutateAsync({ request: REQUEST, issue: issue(5, "stale") }));

    const [token, number, body] = api.updateBusinessItIssueBody.mock.calls[0];
    expect([token, number]).toEqual(["tok", 5]);
    expect(body.startsWith("Edited since the scan\n\n---")).toBe(true);
    expect(body).toContain(featureRequestMarker(12));
    expect(out.alreadyLinked).toBe(false);
    expect(qc.getQueryData<GitHubIssue[]>(BUSINESS_IT_ISSUES_KEY)?.[0].body).toBe(body);
  });

  it("writes nothing when the issue is already linked to this request", async () => {
    api.getBusinessItIssue.mockResolvedValue(issue(5, featureRequestMarker(12)));
    const { result } = setupLink();
    const out = await act(() => result.current.mutateAsync({ request: REQUEST, issue: issue(5) }));
    expect(out.alreadyLinked).toBe(true);
    expect(api.updateBusinessItIssueBody).not.toHaveBeenCalled();
  });

  it("refuses an issue linked to ANOTHER request", async () => {
    api.getBusinessItIssue.mockResolvedValue(issue(5, featureRequestMarker(40)));
    const { result } = setupLink();
    await act(() =>
      expect(result.current.mutateAsync({ request: REQUEST, issue: issue(5) })).rejects.toThrow(/Request #40/),
    );
    expect(api.updateBusinessItIssueBody).not.toHaveBeenCalled();
  });

  it("refuses anyone but Ray and Tim", async () => {
    state.emails = ["sheila.horn@altronic-llc.com"];
    const { result } = setupLink();
    await act(() =>
      expect(result.current.mutateAsync({ request: REQUEST, issue: issue(5) })).rejects.toThrow(/Ray White/),
    );
    expect(api.getBusinessItIssue).not.toHaveBeenCalled();
  });
});
