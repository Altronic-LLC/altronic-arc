import { useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createNewHire, getNewHire, listNewHires, setNewHireCancelled, setNewHireStep, updateNewHire } from "@/api/newHires";
import { notifyChangeEmails } from "@/api/email";
import { NEW_HIRES_CONFIGURED } from "@/api/config";
import type { Person } from "@/types/task";
import type { NewHire, NewHireInput, NewHirePatch, NewHireStep } from "@/types/hr";
import type { ChangeEmail } from "@/lib/changeAlerts";
import { newHireGate } from "@/lib/hrRoles";
import { missingForSubmit } from "@/lib/newHire";
import {
  buildNewHireCancelledEmails,
  buildNewHireCompleteEmails,
  buildNewHireSubmittedEmails,
  newHireReplyTo,
  type NewHireEmailKind,
} from "@/lib/newHireAlerts";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { useCurrentUser } from "./useCurrentUser";
import { readHrPeopleWithRole, requireHrGate, useResolveHrAccess } from "./useHrRoles";

// =============================================================================
// New Hires — the list, and every write. Each write asks `newHireGate` INSIDE
// its mutationFn (the roles list awaited), so a hidden button and the write
// behind it can't disagree.
//
// Emails go out from onSuccess, in the background, through notifyChangeEmails
// (which toasts its own failures):
//   * a create → the SAP and IT people (read FRESH from HR Roles) + the manager;
//   * the last step ticked (status becomes Complete) → submitter + manager;
//   * a cancellation → SAP, IT and the manager.
// A queue with nobody on it is SAID, not silently skipped. Every one is sent
// from the shared mailbox with Reply-To the HR person (newHireReplyTo).
// =============================================================================

export const NEW_HIRES_KEY = ["newHires", "list"] as const;

const SITE_LABEL = "the HR site";

export function useNewHires() {
  return useQuery<NewHire[]>({
    queryKey: NEW_HIRES_KEY,
    queryFn: listNewHires,
    staleTime: 60_000,
    enabled: NEW_HIRES_CONFIGURED,
  });
}

/** One new hire, from the list (the list is small and fetched whole). */
export function useNewHire(id: number | null) {
  const query = useNewHires();
  const hire = id === null ? undefined : query.data?.find((h) => h.id === id);
  return { ...query, data: hire };
}

function upsert(qc: QueryClient, hire: NewHire): void {
  qc.setQueryData<NewHire[]>(NEW_HIRES_KEY, (old) => {
    if (!old) return old;
    return old.some((h) => h.id === hire.id) ? old.map((h) => (h.id === hire.id ? hire : h)) : [...old, hire];
  });
}

function targetOf(hire: NewHire) {
  return { kind: "newHire" as const, id: hire.id, title: hire.displayName || `New hire #${hire.id}` };
}

/** From the shared mailbox, with replies going to the HR person (newHireReplyTo). */
function send(hire: NewHire, emails: ChangeEmail[], kind: NewHireEmailKind, actor: Person): void {
  if (emails.length === 0) return;
  void notifyChangeEmails({ target: targetOf(hire), emails, replyTo: newHireReplyTo(kind, hire, actor) });
}

async function setupQueues(qc: QueryClient): Promise<{ sap: Person[]; it: Person[] }> {
  const [sap, it] = await Promise.all([
    readHrPeopleWithRole(qc, "new hire sap").catch(() => [] as Person[]),
    readHrPeopleWithRole(qc, "new hire it").catch(() => [] as Person[]),
  ]);
  return { sap, it };
}

function errorToast(err: unknown, action: string): void {
  pushToast({
    message:
      err instanceof Error && /^(Only people HR|Couldn't check|Fill in|Say why|This new hire|That new hire)/.test(err.message)
        ? err.message
        : describeListWriteFailure(err, { action, site: SITE_LABEL, permission: "editing" }),
    variant: "error",
  });
}

/** When a write moved the hire to Complete, tell the submitter and the manager. */
function announceIfCompleted(before: NewHire | undefined, after: NewHire, actor: Person): void {
  if (before?.status !== "Complete" && after.status === "Complete") {
    send(after, buildNewHireCompleteEmails({ hire: after, actor }), "complete", actor);
  }
}

function useActorRef() {
  const actor = useCurrentUser();
  const ref = useRef(actor);
  ref.current = actor;
  return ref;
}

export function useCreateNewHire() {
  const qc = useQueryClient();
  const resolve = useResolveHrAccess();
  const actorRef = useActorRef();
  return useMutation({
    mutationFn: async (input: NewHireInput) => {
      requireHrGate(newHireGate(await resolve()));
      const missing = missingForSubmit(input);
      if (missing.length > 0) throw new Error(`Fill in ${missing.join(", ")} first.`);
      return createNewHire(input, actorRef.current);
    },
    onSuccess: async (hire) => {
      upsert(qc, hire);
      const actor = actorRef.current;
      const { sap, it } = await setupQueues(qc);
      send(hire, buildNewHireSubmittedEmails({ hire, sap, it, actor }), "submitted", actor);
      const nobody = [sap.length === 0 && "add people to SAP", it.length === 0 && "raise IT tickets"].filter(Boolean);
      if (nobody.length > 0) {
        pushToast({
          message: `Nobody is set up to ${nobody.join(" or ")}, so they weren't emailed. Ask an HR admin to add them in HR Access.`,
          variant: "error",
        });
      }
    },
    onError: (err) => errorToast(err, "submit the new hire"),
    onSettled: () => qc.invalidateQueries({ queryKey: NEW_HIRES_KEY }),
  });
}

async function previousRow(qc: QueryClient, id: number): Promise<NewHire> {
  const cached = qc.getQueryData<NewHire[]>(NEW_HIRES_KEY)?.find((h) => h.id === id);
  if (cached) return cached;
  const fresh = await getNewHire(id);
  if (!fresh) throw new Error("That new hire no longer exists.");
  return fresh;
}

export function useUpdateNewHire() {
  const qc = useQueryClient();
  const resolve = useResolveHrAccess();
  const actorRef = useActorRef();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: NewHirePatch }) => {
      requireHrGate(newHireGate(await resolve()));
      const before = await previousRow(qc, id);
      const after = await updateNewHire(id, patch, before);
      return { before, after };
    },
    onSuccess: ({ before, after }) => {
      upsert(qc, after);
      announceIfCompleted(before, after, actorRef.current);
    },
    onError: (err) => errorToast(err, "save the new hire"),
    onSettled: () => qc.invalidateQueries({ queryKey: NEW_HIRES_KEY }),
  });
}

export function useSetNewHireStep() {
  const qc = useQueryClient();
  const resolve = useResolveHrAccess();
  const actorRef = useActorRef();
  return useMutation({
    mutationFn: async ({ id, step, done }: { id: number; step: NewHireStep; done: boolean }) => {
      requireHrGate(newHireGate(await resolve()));
      const before = qc.getQueryData<NewHire[]>(NEW_HIRES_KEY)?.find((h) => h.id === id);
      const after = await setNewHireStep(id, step, done, actorRef.current);
      return { before, after };
    },
    onSuccess: ({ before, after }) => {
      upsert(qc, after);
      announceIfCompleted(before, after, actorRef.current);
    },
    onError: (err) => errorToast(err, "tick that step"),
    onSettled: () => qc.invalidateQueries({ queryKey: NEW_HIRES_KEY }),
  });
}

/** `reason` cancels; `null` reopens. */
export function useSetNewHireCancelled() {
  const qc = useQueryClient();
  const resolve = useResolveHrAccess();
  const actorRef = useActorRef();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string | null }) => {
      requireHrGate(newHireGate(await resolve()));
      const before = qc.getQueryData<NewHire[]>(NEW_HIRES_KEY)?.find((h) => h.id === id);
      const after = await setNewHireCancelled(id, reason, actorRef.current);
      return { before, after };
    },
    onSuccess: async ({ before, after }) => {
      upsert(qc, after);
      if (!before?.cancelled && after.cancelled) {
        const { sap, it } = await setupQueues(qc);
        const actor = actorRef.current;
        send(after, buildNewHireCancelledEmails({ hire: after, sap, it, actor }), "cancelled", actor);
      }
    },
    onError: (err) => errorToast(err, "change the new hire"),
    onSettled: () => qc.invalidateQueries({ queryKey: NEW_HIRES_KEY }),
  });
}
