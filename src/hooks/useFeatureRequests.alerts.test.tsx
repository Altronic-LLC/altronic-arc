import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Person } from "@/types/task";

// =============================================================================
// ARC Feature Request alerts — WHEN they fire, not what they say.
//
// Nothing watched the Feature Requests list, so a suggestion sat until
// somebody opened the screen, and a status change told nobody at all (Ray,
// 2026-09-16: "hard coded alerts to new ARC Feature Requests to email
// myself... ensure watching and comment mention alerts are wired in for these
// for status changes etc").
//
// The wording lives in `lib/featureRequestAlerts.test.ts`. This file pins the
// GUARD, which is where every status alert in this app has gone wrong before:
//
//   `"Status" in fields` is PRESENCE, not change.
//
// The sidebar re-sends whatever it holds, so re-saving an unchanged status
// must not re-announce it. The "stays quiet" case below therefore starts from
// a fixture ALREADY at the target status — a fixture starting elsewhere passes
// whether the guard exists or not, which is the exact trap CLAUDE.md records
// this repo being caught by twice.
// =============================================================================

const ACTOR: Person = {
  displayName: "Demo User",
  email: "demo.user@altronic-llc.com",
  lookupId: 3,
};

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ACTOR,
}));

const fireNewFeatureRequestAlert = vi.hoisted(() => vi.fn());
const fireFeatureRequestStatusAlert = vi.hoisted(() => vi.fn());
const fireFieldChangeAlert = vi.hoisted(() => vi.fn());

vi.mock("@/api/email", () => ({
  fireNewFeatureRequestAlert,
  fireFeatureRequestStatusAlert,
  fireFieldChangeAlert,
  notifyMentions: vi.fn(),
}));

import {
  useCreateFeatureRequest,
  useFeatureRequests,
  useUpdateFeatureRequestFields,
} from "./useFeatureRequests";
import { __resetFeatureRequestMockStore } from "@/api/featureRequests";
import { MOCK_FEATURE_REQUESTS } from "@/data/featureRequestMockData";

function hookWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

/** A fixture at a known status, so a transition can be asserted either way. */
function fixtureAt(status: string) {
  const found = MOCK_FEATURE_REQUESTS.find((r) => r.status === status);
  if (!found) throw new Error(`No mock feature request with status "${status}"`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetFeatureRequestMockStore();
});

describe("a new feature request", () => {
  it("alerts the intake list", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(() => useCreateFeatureRequest(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        title: "Bulk-edit tasks",
        description: "Select several and set their status at once.",
        department: "Engineering",
        priority: "Medium",
      });
    });

    await waitFor(() => expect(fireNewFeatureRequestAlert).toHaveBeenCalledTimes(1));
    const arg = fireNewFeatureRequestAlert.mock.calls[0][0];
    expect(arg.target.kind).toBe("featureRequest");
    expect(arg.target.title).toBe("Bulk-edit tasks");
    expect(arg.actor).toEqual(ACTOR);
  });

  it("carries the department, priority and description", async () => {
    const wrapper = hookWrapper();
    const { result } = renderHook(() => useCreateFeatureRequest(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        title: "Bulk-edit tasks",
        description: "Select several and set their status at once.",
        department: "Engineering",
        priority: "Medium",
      });
    });

    await waitFor(() => expect(fireNewFeatureRequestAlert).toHaveBeenCalled());
    const labels = fireNewFeatureRequestAlert.mock.calls[0][0].details.map(
      (d: { label: string }) => d.label,
    );
    expect(labels).toEqual(["Department", "Priority", "Description"]);
  });
});

describe("a status change", () => {
  it("alerts BOTH the watchers and the intake list", async () => {
    const request = fixtureAt("Pending Review");
    const wrapper = hookWrapper();
    const list = renderHook(() => useFeatureRequests(), { wrapper });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const { result } = renderHook(() => useUpdateFeatureRequestFields(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: request.id, fields: { Status: "In Work" } });
    });

    // The generic note reaches watchers + the requester — which is how the
    // person who suggested it hears that their own request moved.
    await waitFor(() => expect(fireFieldChangeAlert).toHaveBeenCalledTimes(1));
    const generic = fireFieldChangeAlert.mock.calls[0][0];
    expect(generic.fieldLabel).toBe("status");
    expect(generic.from).toBe("Pending Review");
    expect(generic.to).toBe("In Work");
    expect(generic.watchers.length).toBeGreaterThan(0);

    // And the intake queue, who track the list itself.
    expect(fireFeatureRequestStatusAlert).toHaveBeenCalledTimes(1);
    const intake = fireFeatureRequestStatusAlert.mock.calls[0][0];
    expect(intake.from).toBe("Pending Review");
    expect(intake.to).toBe("In Work");
    expect(intake.target.id).toBe(request.id);
  });

  it("STAYS QUIET when the status is re-saved unchanged", async () => {
    // Starts from a fixture ALREADY at the target status — the whole point.
    // With a fixture starting elsewhere this passes whether the `to !== from`
    // guard exists or not.
    const request = fixtureAt("Pending Review");
    const wrapper = hookWrapper();
    const list = renderHook(() => useFeatureRequests(), { wrapper });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const { result } = renderHook(() => useUpdateFeatureRequestFields(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: request.id, fields: { Status: "Pending Review" } });
    });

    expect(fireFeatureRequestStatusAlert).not.toHaveBeenCalled();
    expect(fireFieldChangeAlert).not.toHaveBeenCalled();
  });

  it("stays quiet about a change that ISN'T the status", async () => {
    const request = fixtureAt("Pending Review");
    const wrapper = hookWrapper();
    const list = renderHook(() => useFeatureRequests(), { wrapper });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    const { result } = renderHook(() => useUpdateFeatureRequestFields(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: request.id, fields: { Priority: "High" } });
    });

    expect(fireFeatureRequestStatusAlert).not.toHaveBeenCalled();
    expect(fireFieldChangeAlert).not.toHaveBeenCalled();
  });
});
