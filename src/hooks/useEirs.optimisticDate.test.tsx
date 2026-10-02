// A date picked on an EIR must read as THAT day while the save is in flight,
// not the day before (Ray, 2026-09-30: picked 9/30, saw 9/29 for a few
// seconds). Pinned to a US zone — the bug doesn't exist at UTC.
// No @types/node in this project's tsconfig — reach process.env the way
// communicationParser.timezone.test.ts does. Restored after the file.
const env = (globalThis as unknown as {
  process: { env: Record<string, string | undefined> };
}).process.env;
const previousTz = env.TZ;
env.TZ = "America/Chicago";

import { describe, it, expect, vi, afterAll } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_EIRS } from "@/data/mockData";
import type { Eir } from "@/types/task";
import { toIsoDate } from "@/lib/dateInput";

vi.mock("@/api/eirs", async (orig) => ({
  ...(await orig<typeof import("@/api/eirs")>()),
  updateEirFields: vi.fn(() => new Promise(() => {})), // the save never answers
}));
vi.mock("@/api/email", () => ({ fireFieldChangeAlert: vi.fn(), notifyChangeEmails: vi.fn() }));
vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ accounts: [], instance: {} }) }));

import { useUpdateEirFields } from "./useEirs";

const KEY = ["eirs", "list"];
// Both dates cleared: MOCK_EIRS[0] already carries an LTB date of 9/30, which
// made the LTB case pass whether the fix existed or not.
const EIR: Eir = { ...MOCK_EIRS[0], ltbDate: null, requestedCompletionDate: null };

afterAll(() => {
  env.TZ = previousTz;
});

describe("useUpdateEirFields — optimistic date", () => {
  it.each([
    ["LTBDate", "ltbDate"],
    ["Requested_x0020_Completion_x0020", "requestedCompletionDate"],
  ] as const)("shows the picked day for %s before SharePoint answers", async (column, key) => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
    });
    qc.setQueryData<Eir[]>(KEY, [EIR]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateEirFields(), { wrapper });
    act(() => result.current.mutate({ id: EIR.id, fields: { [column]: "2026-09-30" } }));
    await waitFor(() => {
      const d = qc.getQueryData<Eir[]>(KEY)?.[0]?.[key];
      expect(d && toIsoDate(d)).toBe("2026-09-30");
    });
  });
});
