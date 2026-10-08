import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CURRENT_HARNESS_YEAR,
  createHarnessLogEntry,
  deleteHarnessLogEntry,
  listHarnessLog,
  listHarnessPartUsage,
  listHarnessRecentCodes,
  updateHarnessLogEntry,
  type HarnessLogScope,
} from "@/api/harnessProductionLog";
import {
  createHarnessPartNumber,
  listHarnessPartNumbers,
  setHarnessPartNumberActive,
  updateHarnessPartNumber,
} from "@/api/harnessPartNumbers";
import { listAdmins } from "@/api/admins";
import { SP_HARNESS_PART_NUMBERS_LIST_ID, SP_HARNESS_PRODUCTION_LOG_LIST_ID, USE_MOCK } from "@/api/config";
import type { HarnessLogInput, HarnessPartNumber, HarnessPartNumberInput } from "@/types/task";
import { isAdminEmail } from "@/lib/adminAccess";
import { byFrequency } from "@/lib/harnessLogMapper";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { ADMINS_KEY } from "./useAdmins";
import { useCurrentUserEmails } from "./useCurrentUser";
import { useIsAdmin } from "./useIsAdmin";

// =============================================================================
// Harness Production Log + Harness Part Numbers.
//
// Who can do what (Tim, 2026-10-08):
//  - anyone signed in ADDS and EDITS log entries (it's the floor's log);
//  - only ARC admins DELETE one — an edit leaves a corrected record, a delete
//    leaves nothing (the Teradyne Log's rule);
//  - only ARC admins ADD, RENAME or RETIRE a part number. Everyone reads them.
//
// Every admin-only mutation asks INSIDE its mutationFn, not just on the button,
// and AWAITS the Admins list rather than trusting the render-time flag — that
// reads false while the list loads, which would refuse a real admin on first
// paint. The Build Request production guard learned the same lesson.
// As ever, SharePoint's list permissions are the real boundary.
// =============================================================================

/** Both lists configured (always true in mock mode). The view says so when not. */
export const HARNESS_CONFIGURED =
  USE_MOCK || (!!SP_HARNESS_PRODUCTION_LOG_LIST_ID && !!SP_HARNESS_PART_NUMBERS_LIST_ID);

export const HARNESS_LOG_KEY = ["harnessLog"] as const;
export const HARNESS_PARTS_KEY = ["harnessPartNumbers"] as const;
export const HARNESS_PART_USAGE_KEY = ["harnessPartUsage"] as const;

export function harnessLogKey(scope: HarnessLogScope) {
  return [...HARNESS_LOG_KEY, scope.kind === "all" ? "all" : scope.year] as const;
}

export function useHarnessLog(scope: HarnessLogScope = CURRENT_HARNESS_YEAR()) {
  return useQuery({
    queryKey: harnessLogKey(scope),
    queryFn: () => listHarnessLog(scope),
    staleTime: 120_000,
    enabled: HARNESS_CONFIGURED,
  });
}

/** Every part number, retired ones included. Long-cached: it changes rarely. */
export function useHarnessPartNumbers() {
  return useQuery({
    queryKey: HARNESS_PARTS_KEY,
    queryFn: listHarnessPartNumbers,
    staleTime: 5 * 60_000,
    enabled: HARNESS_CONFIGURED,
  });
}

/** Entries per part number across every year — the part-number screen only. */
export function useHarnessPartUsage() {
  return useQuery({
    queryKey: HARNESS_PART_USAGE_KEY,
    queryFn: listHarnessPartUsage,
    staleTime: 5 * 60_000,
    enabled: HARNESS_CONFIGURED,
  });
}

export const HARNESS_RECENT_CODES_KEY = ["harnessRecentCodes"] as const;

/**
 * Built By / Visual Check suggestions: the values used in the last 12 months,
 * most-used first, whichever year the screen shows. Derived from the log, so
 * nothing to maintain — a new clock number typed today is a suggestion on the
 * next load.
 */
export function useHarnessRecentCodes() {
  return useQuery({
    queryKey: HARNESS_RECENT_CODES_KEY,
    queryFn: () => listHarnessRecentCodes(),
    select: (codes) => ({
      builtBy: byFrequency(codes.builtBy),
      visualCheck: byFrequency(codes.visualCheck),
    }),
    staleTime: 10 * 60_000,
    enabled: HARNESS_CONFIGURED,
  });
}

/** Throws unless the signed-in user is an ARC admin, awaiting the Admins list. */
export function useRequireHarnessAdmin(): (action: string) => Promise<void> {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  const renderTimeAdmin = useIsAdmin();
  const ref = useRef({ emails, renderTimeAdmin });
  ref.current = { emails, renderTimeAdmin };
  return useCallback(
    async (action: string) => {
      const admins = await qc
        .ensureQueryData({ queryKey: ADMINS_KEY, queryFn: listAdmins })
        .catch(() => null);
      const isAdmin = admins
        ? ref.current.emails.some((e) => isAdminEmail(e, admins))
        : ref.current.renderTimeAdmin;
      if (!isAdmin) throw new Error(`Only ARC admins can ${action}.`);
    },
    [qc],
  );
}

function errorToast(err: unknown, fallback: string) {
  pushToast({ message: err instanceof Error ? err.message : fallback, variant: "error" });
}

function partTitleFor(qc: ReturnType<typeof useQueryClient>, lookupId: number | null): string | null {
  if (lookupId === null) return null;
  const parts = qc.getQueryData<HarnessPartNumber[]>(HARNESS_PARTS_KEY) ?? [];
  return parts.find((p) => p.lookupId === lookupId)?.title ?? null;
}

// -----------------------------------------------------------------------------
// Log entries
// -----------------------------------------------------------------------------

export function useCreateHarnessLogEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HarnessLogInput) => createHarnessLogEntry(input, partTitleFor(qc, input.partLookupId)),
    onSuccess: () => pushToast({ message: "Entry added." }),
    onError: (err) =>
      pushToast({
        message: describeListWriteFailure(err, { action: "add this entry", site: "Altronic_PMO", permission: "editing" }),
        variant: "error",
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: HARNESS_LOG_KEY });
      qc.invalidateQueries({ queryKey: HARNESS_PART_USAGE_KEY });
      qc.invalidateQueries({ queryKey: HARNESS_RECENT_CODES_KEY });
    },
  });
}

export function useUpdateHarnessLogEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: HarnessLogInput }) =>
      updateHarnessLogEntry(id, input, partTitleFor(qc, input.partLookupId)),
    onSuccess: () => pushToast({ message: "Saved." }),
    onError: (err) =>
      pushToast({
        message: describeListWriteFailure(err, { action: "save this entry", site: "Altronic_PMO", permission: "editing" }),
        variant: "error",
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: HARNESS_LOG_KEY });
      qc.invalidateQueries({ queryKey: HARNESS_PART_USAGE_KEY });
      qc.invalidateQueries({ queryKey: HARNESS_RECENT_CODES_KEY });
    },
  });
}

/** ARC admins only — asked here, not just by the bin button. */
export function useDeleteHarnessLogEntry() {
  const qc = useQueryClient();
  const requireAdmin = useRequireHarnessAdmin();
  return useMutation({
    mutationFn: async (id: number) => {
      await requireAdmin("delete a harness log entry");
      return deleteHarnessLogEntry(id);
    },
    onSuccess: () => pushToast({ message: "Entry deleted." }),
    onError: (err) =>
      pushToast({
        message:
          err instanceof Error && err.message.startsWith("Only ARC admins")
            ? err.message
            : describeListWriteFailure(err, { action: "delete this entry", site: "Altronic_PMO" }),
        variant: "error",
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: HARNESS_LOG_KEY });
      qc.invalidateQueries({ queryKey: HARNESS_PART_USAGE_KEY });
      qc.invalidateQueries({ queryKey: HARNESS_RECENT_CODES_KEY });
    },
  });
}

// -----------------------------------------------------------------------------
// Part numbers — every write is ARC-admin only
// -----------------------------------------------------------------------------

export function useCreateHarnessPartNumber() {
  const qc = useQueryClient();
  const requireAdmin = useRequireHarnessAdmin();
  return useMutation({
    mutationFn: async (input: HarnessPartNumberInput) => {
      await requireAdmin("add a part number");
      return createHarnessPartNumber(input);
    },
    onSuccess: (part) => pushToast({ message: `Added ${part.title}.` }),
    onError: (err) => errorToast(err, "Couldn't add that part number."),
    onSettled: () => qc.invalidateQueries({ queryKey: HARNESS_PARTS_KEY }),
  });
}

export function useUpdateHarnessPartNumber() {
  const qc = useQueryClient();
  const requireAdmin = useRequireHarnessAdmin();
  return useMutation({
    mutationFn: async ({ lookupId, input }: { lookupId: number; input: HarnessPartNumberInput }) => {
      await requireAdmin("rename a part number");
      return updateHarnessPartNumber(lookupId, input);
    },
    onSuccess: () => pushToast({ message: "Saved." }),
    onError: (err) => errorToast(err, "Couldn't save that part number."),
    // A rename changes what every log row displays, so the log refetches too.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: HARNESS_PARTS_KEY });
      qc.invalidateQueries({ queryKey: HARNESS_LOG_KEY });
    },
  });
}

export function useSetHarnessPartNumberActive() {
  const qc = useQueryClient();
  const requireAdmin = useRequireHarnessAdmin();
  return useMutation({
    mutationFn: async ({ lookupId, active }: { lookupId: number; active: boolean }) => {
      await requireAdmin(active ? "restore a part number" : "retire a part number");
      return setHarnessPartNumberActive(lookupId, active);
    },
    onSuccess: (part) =>
      pushToast({
        message: part.active
          ? `${part.title} is available again.`
          : `${part.title} retired — entries already using it still show it.`,
      }),
    onError: (err) => errorToast(err, "Couldn't change that part number."),
    onSettled: () => qc.invalidateQueries({ queryKey: HARNESS_PARTS_KEY }),
  });
}
