import { useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createCoatingCheck,
  CURRENT_COATING_YEAR,
  deleteCoatingCheck,
  getCoatingCheck,
  listCoatingChecks,
  listCoatingSpecUsage,
  updateCoatingCheck,
  type CoatingCheckScope,
} from "@/api/coatingChecks";
import {
  createCoatingSpec,
  deleteCoatingSpec,
  listCoatingSpecs,
  setCoatingSpecActive,
  updateCoatingSpec,
} from "@/api/coatingSpecs";
import { SP_COATING_CHECKS_LIST_ID, SP_COATING_SPECS_LIST_ID, USE_MOCK } from "@/api/config";
import { sendCoatingOutOfSpecAlert } from "@/api/email";
import type { CoatingCheck, CoatingCheckInput, CoatingSpecInput } from "@/types/coating";
import type { Person } from "@/types/task";
import { shouldAlertCoatingOutOfSpec } from "@/lib/coatingCheck";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { useCurrentUser } from "./useCurrentUser";
import { useRequireArcAdmin } from "./useRequireArcAdmin";
import { readOperationsRecipients } from "./useOperationsAlertRecipients";

// =============================================================================
// Conformal Coating Thickness Checks + Coating Specs (BusinessIT#60).
//
// Who can do what — the crimp log's rules (Tim, 2026-11-04):
//  - anyone signed in RECORDS and CORRECTS a check — it's the floor's log;
//  - only ARC admins DELETE a check (an edit leaves a corrected record, a
//    delete leaves nothing), and only ARC admins ADD, EDIT, RETIRE or DELETE a
//    spec. Everyone reads the specs.
//
// Every admin-only write asks INSIDE its mutationFn (useRequireArcAdmin, which
// awaits the Admins list). SharePoint's list permissions are the real boundary.
//
// The out-of-spec email is sent from onSuccess, NOT awaited by the save, and
// its outcome is toasted so the operator knows whether anyone heard. Who is
// told comes from Operations Alert Recipients, read fresh at send time.
// =============================================================================

/** Both lists configured (always true in mock mode). The views say so when not. */
export const COATING_CONFIGURED = USE_MOCK || (!!SP_COATING_SPECS_LIST_ID && !!SP_COATING_CHECKS_LIST_ID);

export const COATING_CHECKS_KEY = ["coatingChecks"] as const;
export const COATING_SPECS_KEY = ["coatingSpecs"] as const;
export const COATING_SPEC_USAGE_KEY = ["coatingSpecUsage"] as const;

export function coatingChecksKey(scope: CoatingCheckScope) {
  return [...COATING_CHECKS_KEY, scope.kind === "all" ? "all" : scope.year] as const;
}

export function useCoatingChecks(scope: CoatingCheckScope = CURRENT_COATING_YEAR()) {
  return useQuery({
    queryKey: coatingChecksKey(scope),
    queryFn: () => listCoatingChecks(scope),
    staleTime: 60_000,
    enabled: COATING_CONFIGURED,
  });
}

/** One check — the deep link from an alert email, when it isn't in the loaded year. */
export function useCoatingCheck(id: number | null) {
  return useQuery({
    queryKey: [...COATING_CHECKS_KEY, "one", id],
    queryFn: () => getCoatingCheck(id!),
    enabled: COATING_CONFIGURED && id !== null,
  });
}

/** Every spec, retired ones included. Long-cached: it changes rarely. */
export function useCoatingSpecs() {
  return useQuery({
    queryKey: COATING_SPECS_KEY,
    queryFn: listCoatingSpecs,
    staleTime: 5 * 60_000,
    enabled: COATING_CONFIGURED,
  });
}

/** Checks per spec across every year — the specs screen, and the delete guard. */
export function useCoatingSpecUsage() {
  return useQuery({
    queryKey: COATING_SPEC_USAGE_KEY,
    queryFn: listCoatingSpecUsage,
    staleTime: 60_000,
    enabled: COATING_CONFIGURED,
  });
}

function invalidateChecks(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: COATING_CHECKS_KEY });
  qc.invalidateQueries({ queryKey: COATING_SPEC_USAGE_KEY });
}

/** Send the out-of-spec email and say what became of it. Never throws. */
async function alertAndReport(qc: QueryClient, check: CoatingCheck, actor: Person): Promise<void> {
  try {
    const recipients = await readOperationsRecipients(qc, "Coating out of spec");
    if (recipients.length === 0) {
      pushToast({
        message:
          "This coating check is out of spec, but nobody is set up to be emailed about it yet. Tell your supervisor.",
        variant: "error",
      });
      return;
    }
    const result = await sendCoatingOutOfSpecAlert({ check, actor, recipients });
    if (result.sent.length > 0) {
      const n = result.sent.length;
      pushToast({ message: `Out of spec — emailed ${n} ${n === 1 ? "person" : "people"}.` });
    }
    // A failed send toasts itself (api/email.ts "Mail that doesn't send says so").
  } catch {
    pushToast({ message: "This coating check is out of spec, but the email couldn't be sent.", variant: "error" });
  }
}

function useActor() {
  const user = useCurrentUser();
  const ref = useRef(user);
  ref.current = user;
  return ref;
}

// -----------------------------------------------------------------------------
// Checks
// -----------------------------------------------------------------------------

export function useCreateCoatingCheck() {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: (input: CoatingCheckInput) => createCoatingCheck(input),
    onSuccess: (check) => {
      if (shouldAlertCoatingOutOfSpec(null, check)) void alertAndReport(qc, check, actor.current);
      else pushToast({ message: "Check recorded." });
    },
    onError: (err) =>
      pushToast({
        message: describeListWriteFailure(err, { action: "record this check", site: "Altronic_PMO", permission: "editing" }),
        variant: "error",
      }),
    onSettled: () => invalidateChecks(qc),
  });
}

export function useUpdateCoatingCheck() {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: ({ before, input }: { before: CoatingCheck; input: CoatingCheckInput }) =>
      updateCoatingCheck(before.id, input),
    onSuccess: (check, { before }) => {
      if (shouldAlertCoatingOutOfSpec(before, check)) void alertAndReport(qc, check, actor.current);
      else pushToast({ message: "Saved." });
    },
    onError: (err) =>
      pushToast({
        message: describeListWriteFailure(err, { action: "save this check", site: "Altronic_PMO", permission: "editing" }),
        variant: "error",
      }),
    onSettled: () => invalidateChecks(qc),
  });
}

/** ARC admins only — asked here, not just by the bin button. */
export function useDeleteCoatingCheck() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async (id: number) => {
      await requireAdmin("delete a coating check");
      return deleteCoatingCheck(id);
    },
    onSuccess: () => pushToast({ message: "Check deleted." }),
    onError: (err) =>
      pushToast({
        message:
          err instanceof Error && err.message.startsWith("Only ARC admins")
            ? err.message
            : describeListWriteFailure(err, { action: "delete this check", site: "Altronic_PMO" }),
        variant: "error",
      }),
    onSettled: () => invalidateChecks(qc),
  });
}

// -----------------------------------------------------------------------------
// Specs — every write is ARC-admin only
// -----------------------------------------------------------------------------

function errorToast(err: unknown, fallback: string) {
  pushToast({ message: err instanceof Error ? err.message : fallback, variant: "error" });
}

export function useCreateCoatingSpec() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async (input: CoatingSpecInput) => {
      await requireAdmin("add a coating spec");
      return createCoatingSpec(input);
    },
    onSuccess: (spec) => pushToast({ message: `Added the "${spec.name}" spec.` }),
    onError: (err) => errorToast(err, "Couldn't add that spec."),
    onSettled: () => qc.invalidateQueries({ queryKey: COATING_SPECS_KEY }),
  });
}

export function useUpdateCoatingSpec() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: CoatingSpecInput }) => {
      await requireAdmin("change a coating spec");
      return updateCoatingSpec(id, input);
    },
    onSuccess: () => pushToast({ message: "Spec saved. Checks already recorded keep the figures they were judged by." }),
    onError: (err) => errorToast(err, "Couldn't save that spec."),
    onSettled: () => qc.invalidateQueries({ queryKey: COATING_SPECS_KEY }),
  });
}

export function useSetCoatingSpecActive() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      await requireAdmin(active ? "restore a coating spec" : "retire a coating spec");
      return setCoatingSpecActive(id, active);
    },
    onSuccess: (spec) =>
      pushToast({
        message: spec.active
          ? `"${spec.name}" is available again.`
          : `"${spec.name}" is retired — checks already using it still show it.`,
      }),
    onError: (err) => errorToast(err, "Couldn't change that spec."),
    onSettled: () => qc.invalidateQueries({ queryKey: COATING_SPECS_KEY }),
  });
}

/**
 * Delete a spec — ARC admins only, and only while NO check points at it.
 * Usage is read FRESH here, not from the screen's cached count: a check
 * recorded a minute ago against this spec must stop the delete.
 */
export function useDeleteCoatingSpec() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async (id: number) => {
      await requireAdmin("delete a coating spec");
      const used = (await listCoatingSpecUsage()).get(id) ?? 0;
      if (used > 0) {
        throw new Error(
          `${used} ${used === 1 ? "check was" : "checks were"} judged against this spec, so it can't be deleted. Retire it instead.`,
        );
      }
      return deleteCoatingSpec(id);
    },
    onSuccess: () => pushToast({ message: "Spec deleted." }),
    onError: (err) => errorToast(err, "Couldn't delete that spec."),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: COATING_SPECS_KEY });
      qc.invalidateQueries({ queryKey: COATING_SPEC_USAGE_KEY });
    },
  });
}
