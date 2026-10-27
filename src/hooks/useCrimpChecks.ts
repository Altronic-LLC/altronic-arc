import { useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createCrimpCheck,
  CURRENT_CRIMP_YEAR,
  deleteCrimpCheck,
  getCrimpCheck,
  listCrimpChecks,
  listCrimpSpecUsage,
  updateCrimpCheck,
  type CrimpCheckScope,
} from "@/api/crimpChecks";
import {
  createCrimpSpec,
  deleteCrimpSpec,
  listCrimpSpecs,
  setCrimpSpecActive,
  updateCrimpSpec,
} from "@/api/crimpSpecs";
import { SP_CRIMP_CHECKS_LIST_ID, SP_CRIMP_SPECS_LIST_ID, USE_MOCK } from "@/api/config";
import { sendCrimpOutOfSpecAlert } from "@/api/email";
import type { CrimpCheck, CrimpCheckInput, CrimpSpecInput } from "@/types/crimp";
import type { Person } from "@/types/task";
import { shouldAlertOutOfSpec } from "@/lib/crimpCheck";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { useCurrentUser } from "./useCurrentUser";
import { useRequireArcAdmin } from "./useRequireArcAdmin";
import { readHarnessRecipients } from "./useHarnessAlertRecipients";

// =============================================================================
// Crimp Height Checks + Crimp Specs (BusinessIT#55).
//
// Who can do what (Tim, 2026-10-27):
//  - anyone signed in RECORDS and CORRECTS a check — it's the floor's log, the
//    Harness Production Log's rule;
//  - only ARC admins DELETE a check (an edit leaves a corrected record, a
//    delete leaves nothing), and only ARC admins ADD, EDIT, RETIRE or DELETE a
//    spec. Everyone reads the specs.
//
// Every admin-only write asks INSIDE its mutationFn (useRequireArcAdmin, which
// awaits the Admins list). SharePoint's list permissions are the real boundary.
//
// The out-of-spec email is sent from onSuccess, NOT awaited by the save: the
// check is in SharePoint by then, and the form must not sit open while mail
// goes out. Its outcome is toasted — "emailed 3 people", or that nobody is set
// up to be told — because the operator needs to know whether anyone heard.
// Who is told comes from the Harness Alert Recipients list (ARC admins manage
// it at /harness/alert-recipients), read fresh at send time.
// =============================================================================

/** Both lists configured (always true in mock mode). The views say so when not. */
export const CRIMP_CONFIGURED = USE_MOCK || (!!SP_CRIMP_SPECS_LIST_ID && !!SP_CRIMP_CHECKS_LIST_ID);

export const CRIMP_CHECKS_KEY = ["crimpChecks"] as const;
export const CRIMP_SPECS_KEY = ["crimpSpecs"] as const;
export const CRIMP_SPEC_USAGE_KEY = ["crimpSpecUsage"] as const;

export function crimpChecksKey(scope: CrimpCheckScope) {
  return [...CRIMP_CHECKS_KEY, scope.kind === "all" ? "all" : scope.year] as const;
}

export function useCrimpChecks(scope: CrimpCheckScope = CURRENT_CRIMP_YEAR()) {
  return useQuery({
    queryKey: crimpChecksKey(scope),
    queryFn: () => listCrimpChecks(scope),
    staleTime: 60_000,
    enabled: CRIMP_CONFIGURED,
  });
}

/** One check — the deep link from an alert email, when it isn't in the loaded year. */
export function useCrimpCheck(id: number | null) {
  return useQuery({
    queryKey: [...CRIMP_CHECKS_KEY, "one", id],
    queryFn: () => getCrimpCheck(id!),
    enabled: CRIMP_CONFIGURED && id !== null,
  });
}

/** Every spec, retired ones included. Long-cached: it changes rarely. */
export function useCrimpSpecs() {
  return useQuery({
    queryKey: CRIMP_SPECS_KEY,
    queryFn: listCrimpSpecs,
    staleTime: 5 * 60_000,
    enabled: CRIMP_CONFIGURED,
  });
}

/** Checks per spec across every year — the specs screen, and the delete guard. */
export function useCrimpSpecUsage() {
  return useQuery({
    queryKey: CRIMP_SPEC_USAGE_KEY,
    queryFn: listCrimpSpecUsage,
    staleTime: 60_000,
    enabled: CRIMP_CONFIGURED,
  });
}

function invalidateChecks(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: CRIMP_CHECKS_KEY });
  qc.invalidateQueries({ queryKey: CRIMP_SPEC_USAGE_KEY });
}

/**
 * Send the out-of-spec email and say what became of it. Never throws.
 * Recipients come from Harness Alert Recipients, read FRESH.
 */
async function alertAndReport(qc: QueryClient, check: CrimpCheck, actor: Person): Promise<void> {
  try {
    const recipients = await readHarnessRecipients(qc, "Crimp out of spec");
    if (recipients.length === 0) {
      pushToast({
        message:
          "This check is out of spec, but nobody is set up to be emailed about it yet. Tell your supervisor.",
        variant: "error",
      });
      return;
    }
    const result = await sendCrimpOutOfSpecAlert({ check, actor, recipients });
    if (result.sent.length > 0) {
      const n = result.sent.length;
      pushToast({ message: `Out of spec — emailed ${n} ${n === 1 ? "person" : "people"}.` });
    }
    // A failed send toasts itself (api/email.ts "Mail that doesn't send says so").
  } catch {
    pushToast({ message: "This check is out of spec, but the email couldn't be sent.", variant: "error" });
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

export function useCreateCrimpCheck() {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: (input: CrimpCheckInput) => createCrimpCheck(input),
    onSuccess: (check) => {
      if (shouldAlertOutOfSpec(null, check)) void alertAndReport(qc, check, actor.current);
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

export function useUpdateCrimpCheck() {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: ({ before, input }: { before: CrimpCheck; input: CrimpCheckInput }) =>
      updateCrimpCheck(before.id, input),
    onSuccess: (check, { before }) => {
      if (shouldAlertOutOfSpec(before, check)) void alertAndReport(qc, check, actor.current);
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
export function useDeleteCrimpCheck() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async (id: number) => {
      await requireAdmin("delete a crimp height check");
      return deleteCrimpCheck(id);
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

export function useCreateCrimpSpec() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async (input: CrimpSpecInput) => {
      await requireAdmin("add a crimp spec");
      return createCrimpSpec(input);
    },
    onSuccess: (spec) => pushToast({ message: `Added the spec for ${spec.terminal}.` }),
    onError: (err) => errorToast(err, "Couldn't add that spec."),
    onSettled: () => qc.invalidateQueries({ queryKey: CRIMP_SPECS_KEY }),
  });
}

export function useUpdateCrimpSpec() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: CrimpSpecInput }) => {
      await requireAdmin("change a crimp spec");
      return updateCrimpSpec(id, input);
    },
    onSuccess: () => pushToast({ message: "Spec saved. Checks already recorded keep the figures they were measured against." }),
    onError: (err) => errorToast(err, "Couldn't save that spec."),
    onSettled: () => qc.invalidateQueries({ queryKey: CRIMP_SPECS_KEY }),
  });
}

export function useSetCrimpSpecActive() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      await requireAdmin(active ? "restore a crimp spec" : "retire a crimp spec");
      return setCrimpSpecActive(id, active);
    },
    onSuccess: (spec) =>
      pushToast({
        message: spec.active
          ? `The spec for ${spec.terminal} is available again.`
          : `The spec for ${spec.terminal} is retired — checks already using it still show it.`,
      }),
    onError: (err) => errorToast(err, "Couldn't change that spec."),
    onSettled: () => qc.invalidateQueries({ queryKey: CRIMP_SPECS_KEY }),
  });
}

/**
 * Delete a spec — ARC admins only, and only while NO check points at it.
 * Usage is read FRESH here (not the screen's cached count): a check recorded a
 * minute ago against this spec must stop the delete, or its SpecRef dangles.
 */
export function useDeleteCrimpSpec() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async (id: number) => {
      await requireAdmin("delete a crimp spec");
      const usage = await listCrimpSpecUsage();
      const used = usage.get(id) ?? 0;
      if (used > 0) {
        throw new Error(
          `${used} ${used === 1 ? "check was" : "checks were"} measured against this spec, so it can't be deleted. Retire it instead.`,
        );
      }
      return deleteCrimpSpec(id);
    },
    onSuccess: () => pushToast({ message: "Spec deleted." }),
    onError: (err) => errorToast(err, "Couldn't delete that spec."),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CRIMP_SPECS_KEY });
      qc.invalidateQueries({ queryKey: CRIMP_SPEC_USAGE_KEY });
    },
  });
}
