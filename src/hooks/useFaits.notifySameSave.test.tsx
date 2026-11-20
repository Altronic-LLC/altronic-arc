import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// =============================================================================
// BusinessIT#75: an engineer signing off AND ticking Notify Initiator in ONE
// save of the Sign-off card was refused, because the "every sign-off done?"
// check read the FAIT as it was BEFORE the save — when the engineer's
// approval was still missing. The check now reads the row as the save leaves
// it.
//
// Each case first moves its fixture back to "engineering hasn't signed yet",
// so the only way the close can pass is by counting the approval in the
// same write.
// =============================================================================

const fireFaitClosedAlert = vi.hoisted(() => vi.fn());
const fireFaitNotifyInitiatorAlert = vi.hoisted(() => vi.fn());
const fireFaitSignOffRequest = vi.hoisted(() => vi.fn());

vi.mock("@/api/email", () => ({
  fireFaitClosedAlert,
  fireFieldChangeAlert: vi.fn(),
  fireFaitNotifyInitiatorAlert,
  fireNewFaitAlert: vi.fn(),
  fireFaitAssignmentHeadsUp: vi.fn(),
  fireFaitSignOffRequest,
  fireFaitSqeFailedAlert: vi.fn(),
  fireFaitWithSqeAlert: vi.fn(),
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

import { useFaits, useUpdateFaitFields } from "./useFaits";
import type { Fait } from "@/types/task";

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  fireFaitClosedAlert.mockClear();
  fireFaitNotifyInitiatorAlert.mockClear();
  fireFaitSignOffRequest.mockClear();
});

function setup() {
  const wrap = wrapper();
  return renderHook(() => ({ update: useUpdateFaitFields(), list: useFaits() }), {
    wrapper: wrap,
  });
}

type Hook = ReturnType<typeof setup>["result"];

async function loaded(result: Hook): Promise<void> {
  await waitFor(() => expect(result.current.list.data?.length).toBeGreaterThan(0));
}

function row(result: Hook, id: number): Fait {
  return result.current.list.data!.find((f) => f.id === id)!;
}

/** Put the FAIT back to "with engineering, not signed off by engineering". */
async function unsignEngineering(result: Hook, id: number): Promise<void> {
  await act(async () => {
    await result.current.update.mutateAsync({
      id,
      fields: { Status: "This is with ENG", EngSignOff: null, NotifyInitiator: false },
      patch: (f) => ({
        ...f,
        status: "This is with ENG",
        values: { ...f.values, engSignOff: "", notifyInitiator: "" },
      }),
    });
  });
  fireFaitClosedAlert.mockClear();
  fireFaitNotifyInitiatorAlert.mockClear();
  fireFaitSignOffRequest.mockClear();
}

/** The one save under test: engineering signs AND Notify Initiator is ticked. */
function signAndNotify(result: Hook, id: number) {
  return result.current.update.mutateAsync({
    id,
    fields: { EngSignOff: "Approved", NotifyInitiator: true },
    patch: (f) => ({
      ...f,
      values: { ...f.values, engSignOff: "Approved", notifyInitiator: "Yes" },
    }),
  });
}

describe("engineering sign-off and Notify Initiator in one save", () => {
  it("closes the FAIT when that approval was the last one it owed", async () => {
    // Fixture 3: SQE approved, no KAM owed.
    const { result } = setup();
    await loaded(result);
    await unsignEngineering(result, 3);
    expect(row(result, 3).values.engSignOff).toBe("");

    await act(async () => {
      await signAndNotify(result, 3);
    });

    await waitFor(() => expect(row(result, 3).status).toBe("Closed"));
    expect(row(result, 3).values.engSignOff).toBe("Approved");
    expect(fireFaitNotifyInitiatorAlert).toHaveBeenCalledTimes(1);
    expect(fireFaitClosedAlert).toHaveBeenCalledTimes(1);
  });

  it("asks the KAM for nothing when the KAM had already signed", async () => {
    // Fixture 5: OEM impact, a KAM assigned and already Approved. Closing in
    // the same save must not also email the KAM for a signature.
    const { result } = setup();
    await loaded(result);
    await unsignEngineering(result, 5);

    await act(async () => {
      await signAndNotify(result, 5);
    });

    await waitFor(() => expect(row(result, 5).status).toBe("Closed"));
    expect(fireFaitSignOffRequest).not.toHaveBeenCalled();
  });

  it("still refuses when another sign-off is missing", async () => {
    // Fixture 6: SQE still Pending. Engineering signing in the same save
    // doesn't finish the chain, so the close is refused as before.
    const { result } = setup();
    await loaded(result);
    const statusBefore = row(result, 6).status;

    await act(() =>
      expect(signAndNotify(result, 6)).rejects.toThrow(/sign-off/i),
    );

    await waitFor(() => expect(row(result, 6).status).toBe(statusBefore));
    expect(fireFaitNotifyInitiatorAlert).not.toHaveBeenCalled();
  });
});
