import { useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createPullTest,
  CURRENT_PULL_TEST_YEAR,
  deletePullTest,
  getPullTest,
  listPullTests,
  listPullTestSpecUsage,
  updatePullTest,
  type PullTestScope,
} from "@/api/pullTests";
import {
  createPullTestSpec,
  deletePullTestSpec,
  listPullTestSpecs,
  setPullTestSpecActive,
  updatePullTestSpec,
} from "@/api/pullTestSpecs";
import { SP_PULL_TEST_SPECS_LIST_ID, SP_PULL_TESTS_LIST_ID, USE_MOCK } from "@/api/config";
import { sendPullTestFailedAlert } from "@/api/email";
import type { PullTest, PullTestInput, PullTestSpecInput } from "@/types/pullTest";
import type { Person } from "@/types/task";
import { shouldAlertPullFailed, pullSpecLabel } from "@/lib/pullTest";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { useCurrentUser } from "./useCurrentUser";
import { useRequireArcAdmin } from "./useRequireArcAdmin";
import { readHarnessRecipients } from "./useHarnessAlertRecipients";

// =============================================================================
// Pull Tests + Pull Test Specs (BusinessIT#64) — the Crimp Height Checks
// rules, copied on purpose (Tim, 2026-11-09: "yes copy that"):
//  - anyone signed in RECORDS and CORRECTS a test;
//  - only ARC admins DELETE a test, and only ARC admins ADD, EDIT, RETIRE or
//    DELETE a spec. Everyone reads the specs.
//
// Every admin-only write asks INSIDE its mutationFn (useRequireArcAdmin, which
// awaits the Admins list). SharePoint's list permissions are the real boundary.
//
// The failed-pull email is sent from onSuccess, NOT awaited by the save, and
// its outcome is toasted — "emailed 2 people", or that nobody is set up to be
// told. Who is told: the "Pull test failed" people on Harness Alert
// Recipients, read fresh at send time.
// =============================================================================

/** Both lists configured (always true in mock mode). The views say so when not. */
export const PULL_TESTS_CONFIGURED = USE_MOCK || (!!SP_PULL_TEST_SPECS_LIST_ID && !!SP_PULL_TESTS_LIST_ID);

export const PULL_TESTS_KEY = ["pullTests"] as const;
export const PULL_TEST_SPECS_KEY = ["pullTestSpecs"] as const;
export const PULL_TEST_SPEC_USAGE_KEY = ["pullTestSpecUsage"] as const;

export function pullTestsKey(scope: PullTestScope) {
  return [...PULL_TESTS_KEY, scope.kind === "all" ? "all" : scope.year] as const;
}

export function usePullTests(scope: PullTestScope = CURRENT_PULL_TEST_YEAR()) {
  return useQuery({
    queryKey: pullTestsKey(scope),
    queryFn: () => listPullTests(scope),
    staleTime: 60_000,
    enabled: PULL_TESTS_CONFIGURED,
  });
}

/** One test — the deep link from an alert email, when it isn't in the loaded year. */
export function usePullTest(id: number | null) {
  return useQuery({
    queryKey: [...PULL_TESTS_KEY, "one", id],
    queryFn: () => getPullTest(id!),
    enabled: PULL_TESTS_CONFIGURED && id !== null,
  });
}

/** Every spec, retired ones included. Long-cached: it changes rarely. */
export function usePullTestSpecs() {
  return useQuery({
    queryKey: PULL_TEST_SPECS_KEY,
    queryFn: listPullTestSpecs,
    staleTime: 5 * 60_000,
    enabled: PULL_TESTS_CONFIGURED,
  });
}

/** Tests per spec across every year — the specs screen, and the delete guard. */
export function usePullTestSpecUsage() {
  return useQuery({
    queryKey: PULL_TEST_SPEC_USAGE_KEY,
    queryFn: listPullTestSpecUsage,
    staleTime: 60_000,
    enabled: PULL_TESTS_CONFIGURED,
  });
}

function invalidateTests(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: PULL_TESTS_KEY });
  qc.invalidateQueries({ queryKey: PULL_TEST_SPEC_USAGE_KEY });
}

/** Send the failed-pull email and say what became of it. Never throws. */
async function alertAndReport(qc: QueryClient, test: PullTest, actor: Person): Promise<void> {
  try {
    const recipients = await readHarnessRecipients(qc, "Pull test failed");
    if (recipients.length === 0) {
      pushToast({
        message: "This pull test failed, but nobody is set up to be emailed about it yet. Tell your supervisor.",
        variant: "error",
      });
      return;
    }
    const result = await sendPullTestFailedAlert({ test, actor, recipients });
    if (result.sent.length > 0) {
      const n = result.sent.length;
      pushToast({ message: `Pull test failed — emailed ${n} ${n === 1 ? "person" : "people"}.` });
    }
    // A failed send toasts itself (api/email.ts "Mail that doesn't send says so").
  } catch {
    pushToast({ message: "This pull test failed, but the email couldn't be sent.", variant: "error" });
  }
}

function useActor() {
  const user = useCurrentUser();
  const ref = useRef(user);
  ref.current = user;
  return ref;
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

export function useCreatePullTest() {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: (input: PullTestInput) => createPullTest(input),
    onSuccess: (test) => {
      if (shouldAlertPullFailed(null, test)) void alertAndReport(qc, test, actor.current);
      else pushToast({ message: "Pull test recorded." });
    },
    onError: (err) =>
      pushToast({
        message: describeListWriteFailure(err, { action: "record this pull test", site: "Altronic_PMO", permission: "editing" }),
        variant: "error",
      }),
    onSettled: () => invalidateTests(qc),
  });
}

export function useUpdatePullTest() {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: ({ before, input }: { before: PullTest; input: PullTestInput }) => updatePullTest(before.id, input),
    onSuccess: (test, { before }) => {
      if (shouldAlertPullFailed(before, test)) void alertAndReport(qc, test, actor.current);
      else pushToast({ message: "Saved." });
    },
    onError: (err) =>
      pushToast({
        message: describeListWriteFailure(err, { action: "save this pull test", site: "Altronic_PMO", permission: "editing" }),
        variant: "error",
      }),
    onSettled: () => invalidateTests(qc),
  });
}

/** ARC admins only — asked here, not just by the bin button. */
export function useDeletePullTest() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async (id: number) => {
      await requireAdmin("delete a pull test");
      return deletePullTest(id);
    },
    onSuccess: () => pushToast({ message: "Pull test deleted." }),
    onError: (err) =>
      pushToast({
        message:
          err instanceof Error && err.message.startsWith("Only ARC admins")
            ? err.message
            : describeListWriteFailure(err, { action: "delete this pull test", site: "Altronic_PMO" }),
        variant: "error",
      }),
    onSettled: () => invalidateTests(qc),
  });
}

// -----------------------------------------------------------------------------
// Specs — every write is ARC-admin only
// -----------------------------------------------------------------------------

function errorToast(err: unknown, fallback: string) {
  pushToast({ message: err instanceof Error ? err.message : fallback, variant: "error" });
}

export function useCreatePullTestSpec() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async (input: PullTestSpecInput) => {
      await requireAdmin("add a pull test spec");
      return createPullTestSpec(input);
    },
    onSuccess: (spec) => pushToast({ message: `Added the spec for ${pullSpecLabel(spec)}.` }),
    onError: (err) => errorToast(err, "Couldn't add that spec."),
    onSettled: () => qc.invalidateQueries({ queryKey: PULL_TEST_SPECS_KEY }),
  });
}

export function useUpdatePullTestSpec() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: PullTestSpecInput }) => {
      await requireAdmin("change a pull test spec");
      return updatePullTestSpec(id, input);
    },
    onSuccess: () => pushToast({ message: "Spec saved. Tests already recorded keep the minimum they were judged by." }),
    onError: (err) => errorToast(err, "Couldn't save that spec."),
    onSettled: () => qc.invalidateQueries({ queryKey: PULL_TEST_SPECS_KEY }),
  });
}

export function useSetPullTestSpecActive() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      await requireAdmin(active ? "restore a pull test spec" : "retire a pull test spec");
      return setPullTestSpecActive(id, active);
    },
    onSuccess: (spec) =>
      pushToast({
        message: spec.active
          ? `The spec for ${pullSpecLabel(spec)} is available again.`
          : `The spec for ${pullSpecLabel(spec)} is retired — tests already using it still show it.`,
      }),
    onError: (err) => errorToast(err, "Couldn't change that spec."),
    onSettled: () => qc.invalidateQueries({ queryKey: PULL_TEST_SPECS_KEY }),
  });
}

/**
 * Delete a spec — ARC admins only, and only while NO test points at it. Usage
 * is read FRESH here, not the screen's cached count: a test recorded a minute
 * ago against this spec must stop the delete, or its SpecRef dangles.
 */
export function useDeletePullTestSpec() {
  const qc = useQueryClient();
  const requireAdmin = useRequireArcAdmin();
  return useMutation({
    mutationFn: async (id: number) => {
      await requireAdmin("delete a pull test spec");
      const used = (await listPullTestSpecUsage()).get(id) ?? 0;
      if (used > 0) {
        throw new Error(
          `${used} ${used === 1 ? "test was" : "tests were"} judged by this spec, so it can't be deleted. Retire it instead.`,
        );
      }
      return deletePullTestSpec(id);
    },
    onSuccess: () => pushToast({ message: "Spec deleted." }),
    onError: (err) => errorToast(err, "Couldn't delete that spec."),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: PULL_TEST_SPECS_KEY });
      qc.invalidateQueries({ queryKey: PULL_TEST_SPEC_USAGE_KEY });
    },
  });
}
