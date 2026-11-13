import { useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  McnMovedOnError,
  McnNumberUnconfirmedError,
  addMcnComment,
  createMcn,
  editMcnComment,
  getMcn,
  listMcns,
  resolveMcnSiteUserLookupId,
  setMcnOperationsTask,
  setMcnPerson,
  setMcnWatchers,
  transitionMcn,
  updateMcnFields,
} from "@/api/mcns";
import { notifyChangeEmails, notifyMentions } from "@/api/email";
import type { Person } from "@/types/task";
import type { Mcn, McnInput, McnPatch } from "@/types/mcn";
import { applyMcnPatch, mcnLabel } from "@/lib/mcnMapper";
import {
  buildMcnApprovedEmails,
  buildMcnImplementedEmails,
  buildMcnRejectedEmails,
  buildMcnSubmittedEmails,
} from "@/lib/mcnAlerts";
import { raiseMcnGate } from "@/lib/mcnRoles";
import { mcnActionGate, mcnEditGate, needsReason, type McnAction, type McnSection } from "@/lib/mcnWorkflow";
import { autoWatchers, mergePeople } from "@/lib/people";
import { commentNotifyRecipients, extractMentionedRecipients, newlyMentionedHtml } from "@/lib/mentions";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { htmlToPlainText } from "@/lib/htmlText";
import type { ChangeTarget } from "@/lib/changeAlerts";
import { afterMentionAutoWatch, beginMentionAutoWatch, type MentionAutoWatch } from "./mentionAutoWatch";
import { readMcnApprovers, requireMcnGate, useResolveMcnAccess } from "./useMcnRoles";
import { useCurrentUser } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Manufacturing Change Notice hooks.
//
// Every write asks its gate INSIDE the mutationFn, against the roles list
// awaited (useResolveMcnAccess) and — for an edit or a workflow step — the MCN
// read FRESH. The page asks the same gates to grey its controls; the two can't
// disagree, and a cached page an hour old can't approve an MCN that has since
// moved on.
// =============================================================================

export const MCNS_KEY = ["mcns"] as const;

const SITE_LABEL = "Altronic_PMO";

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useMcns() {
  return useQuery({ queryKey: MCNS_KEY, queryFn: listMcns, staleTime: 60_000 });
}

/** One MCN out of the cached register. */
export function useMcn(id: number | null) {
  const { data: mcns = [], ...rest } = useMcns();
  return { ...rest, data: id === null ? undefined : mcns.find((m) => m.id === id) };
}

/** Everyone already on an MCN — the @-mention picker's starting point. */
export function collectMcnPeople(mcns: Mcn[]): Person[] {
  return mergePeople(
    ...mcns.map((m) =>
      [m.originatedBy, m.assignedEngineer, m.approvedBy, ...m.watchers].filter((p): p is Person => !!p),
    ),
  );
}

/** The people a comment reaches besides the watchers. */
function mcnAssignees(m: Mcn): Person[] {
  return [m.originatedBy, m.assignedEngineer].filter((p): p is Person => !!p);
}

export function mcnTarget(m: Mcn): ChangeTarget {
  return { kind: "mcn", id: m.id, title: mcnLabel(m) };
}

function patchMcn(qc: QueryClient, id: number, update: (m: Mcn) => Mcn) {
  qc.setQueryData<Mcn[]>(MCNS_KEY, (old) => old?.map((m) => (m.id === id ? update(m) : m)));
}

async function freshMcn(id: number): Promise<Mcn> {
  const mcn = await getMcn(id);
  if (!mcn) throw new Error("That MCN no longer exists.");
  return mcn;
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export function useCreateMcn() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  const resolve = useResolveMcnAccess();
  return useMutation({
    mutationFn: async (input: McnInput) => {
      requireMcnGate(raiseMcnGate(await resolve()));
      try {
        // Whoever raises an MCN watches it, beside the originator and engineer.
        return await createMcn({ ...input, watchers: autoWatchers(input.watchers, actor) });
      } catch (err) {
        // The MCN exists; only its number couldn't be confirmed. A create,
        // with a warning — never a failure (the EIR numbering rule).
        if (err instanceof McnNumberUnconfirmedError) {
          pushToast({ message: err.message, variant: "error" });
          return err.mcn;
        }
        throw err;
      }
    },
    onSuccess: (created) => {
      // Seeded, not just invalidated: the form navigates to the new MCN's page
      // the moment this resolves, and useMcn() derives from this cache.
      qc.setQueryData<Mcn[]>(MCNS_KEY, (old) => (old ? [created, ...old] : [created]));
      void qc.invalidateQueries({ queryKey: MCNS_KEY });
      pushToast({ message: `Raised ${mcnLabel(created)} as a draft.` });
    },
    onError: (err: unknown) =>
      errorToast(describeListWriteFailure(err, { action: "raise the MCN", site: SITE_LABEL, permission: "creating items" })),
  });
}

// -----------------------------------------------------------------------------
// Field edits
// -----------------------------------------------------------------------------

/**
 * One card's edit. `section` says which card, because what may change depends
 * on it: content in Draft only, the implementation card after approval.
 */
export function useUpdateMcnFields() {
  const qc = useQueryClient();
  const resolve = useResolveMcnAccess();
  return useMutation({
    mutationFn: async (vars: { id: number; section: McnSection; patch: McnPatch }) => {
      const [access, before] = await Promise.all([resolve(), freshMcn(vars.id)]);
      requireMcnGate(mcnEditGate(vars.section, before, access));
      return updateMcnFields(vars.id, vars.patch, before);
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: MCNS_KEY });
      const previous = qc.getQueryData<Mcn[]>(MCNS_KEY);
      patchMcn(qc, vars.id, (m) => applyMcnPatch(m, vars.patch));
      return { previous };
    },
    onSuccess: (updated) => patchMcn(qc, updated.id, () => updated),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(MCNS_KEY, ctx.previous);
      errorToast(describeListWriteFailure(err, { action: "save that change", site: SITE_LABEL, permission: "editing" }));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MCNS_KEY }),
  });
}

/** Originated By / Assigned Engineer — content, so Draft only. The engineer also watches. */
export function useSetMcnPerson() {
  const qc = useQueryClient();
  const resolve = useResolveMcnAccess();
  return useMutation({
    mutationFn: async (vars: { id: number; column: "originatedBy" | "assignedEngineer"; person: Person | null }) => {
      const [access, before] = await Promise.all([resolve(), freshMcn(vars.id)]);
      requireMcnGate(mcnEditGate("details", before, access));
      return setMcnPerson(vars.id, vars.column, vars.person);
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: MCNS_KEY });
      const previous = qc.getQueryData<Mcn[]>(MCNS_KEY);
      patchMcn(qc, vars.id, (m) => ({
        ...m,
        [vars.column]: vars.person,
        watchers: vars.column === "assignedEngineer" ? autoWatchers(m.watchers, vars.person) : m.watchers,
      }));
      return { previous };
    },
    onSuccess: (updated) => patchMcn(qc, updated.id, () => updated),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(MCNS_KEY, ctx.previous);
      errorToast(describeListWriteFailure(err, { action: "update that person", site: SITE_LABEL, permission: "editing" }));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MCNS_KEY }),
  });
}

/** Watching is a subscription, not content — anyone may change it, in any status. */
export function useSetMcnWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) => setMcnWatchers(id, people),
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: MCNS_KEY });
      const previous = qc.getQueryData<Mcn[]>(MCNS_KEY);
      patchMcn(qc, id, (m) => ({ ...m, watchers: people }));
      return { previous };
    },
    onSuccess: (updated) => patchMcn(qc, updated.id, () => updated),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(MCNS_KEY, ctx.previous);
      errorToast(describeListWriteFailure(err, { action: "update the watchers", site: SITE_LABEL, permission: "editing" }));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MCNS_KEY }),
  });
}

/** The Operations task link isn't approved content — a team member can set it in any status. */
export function useSetMcnOperationsTask() {
  const qc = useQueryClient();
  const resolve = useResolveMcnAccess();
  return useMutation({
    mutationFn: async ({ id, task }: { id: number; task: { lookupId: number; title: string } | null }) => {
      requireMcnGate(raiseMcnGate(await resolve()));
      return setMcnOperationsTask(id, task);
    },
    onSuccess: (updated) => patchMcn(qc, updated.id, () => updated),
    onError: (err: unknown) =>
      errorToast(describeListWriteFailure(err, { action: "link the task", site: SITE_LABEL, permission: "editing" })),
    onSettled: () => qc.invalidateQueries({ queryKey: MCNS_KEY }),
  });
}

// -----------------------------------------------------------------------------
// The workflow
// -----------------------------------------------------------------------------

export interface McnTransitionVars {
  id: number;
  action: McnAction;
  reason?: string;
  distributedTo?: Person[];
  dateImplemented?: Date | null;
  affected?: string;
}

const DONE: Record<McnAction, string> = {
  submit: "submitted for approval",
  approve: "approved and sent",
  reject: "rejected",
  implement: "marked implemented",
  reopen: "reopened to Draft",
};

/**
 * Move an MCN one step. The gate is asked against the MCN read FRESH and the
 * roles list awaited; the API then refuses a step from a status the row is no
 * longer in. The emails go out after the write lands, never before.
 */
export function useMcnTransition() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  const actorRef = useRef(actor);
  actorRef.current = actor;
  const resolve = useResolveMcnAccess();
  return useMutation({
    mutationFn: async (vars: McnTransitionVars) => {
      const [access, current] = await Promise.all([resolve(), freshMcn(vars.id)]);
      requireMcnGate(mcnActionGate(vars.action, current, access));
      if (needsReason(vars.action) && !vars.reason?.trim()) throw new Error("A reason is needed — it goes on the record.");
      if (vars.action === "approve" && !(vars.distributedTo ?? []).some((p) => p.email)) {
        throw new Error("Add at least one person to send the approved MCN to.");
      }
      if (vars.action === "implement" && !vars.dateImplemented) throw new Error("Enter the date it was implemented.");
      return transitionMcn(vars.id, vars.action, { ...vars, actor: actorRef.current });
    },
    onSuccess: async (updated, vars) => {
      patchMcn(qc, updated.id, () => updated);
      pushToast({ message: `${updated.mcnNumber} ${DONE[vars.action]}.` });
      const actor = actorRef.current;
      const target = mcnTarget(updated);
      let emails;
      if (vars.action === "submit") {
        const approvers = await readMcnApprovers(qc).catch(() => []);
        emails = buildMcnSubmittedEmails({ mcn: updated, approvers, actor });
        if (emails.length === 0) {
          errorToast("Nobody holds the approver role yet, so nobody was emailed. Ask an MCN admin to add one in MCN Settings.");
        }
      } else if (vars.action === "approve") {
        emails = buildMcnApprovedEmails({ mcn: updated, recipients: updated.distributedTo, actor });
      } else if (vars.action === "reject") {
        emails = buildMcnRejectedEmails({ mcn: updated, reason: vars.reason ?? "", actor });
      } else if (vars.action === "implement") {
        emails = buildMcnImplementedEmails({ mcn: updated, actor });
      }
      if (emails && emails.length > 0) void notifyChangeEmails({ target, emails });
    },
    onError: (err: unknown) => {
      if (err instanceof McnMovedOnError) void qc.invalidateQueries({ queryKey: MCNS_KEY });
      errorToast(
        err instanceof McnMovedOnError
          ? err.message
          : describeListWriteFailure(err, { action: "move the MCN on", site: SITE_LABEL, permission: "editing" }),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MCNS_KEY }),
  });
}

// -----------------------------------------------------------------------------
// Comments — open to everyone signed in, the standard thread.
// -----------------------------------------------------------------------------

export function useAddMcnComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: number; comment: { authorName: string; authorEmail: string; bodyHtml: string } }) =>
      addMcnComment(id, comment),
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: MCNS_KEY });
      const previous = qc.getQueryData<Mcn[]>(MCNS_KEY);
      patchMcn(qc, id, (m) => ({
        ...m,
        comments: [{ timestamp: new Date(), ...comment, attachments: [] }, ...m.comments],
      }));
      return { previous, autoWatch: beginMcnMentionAutoWatch(qc, id, comment.bodyHtml) };
    },
    onSuccess: (_data, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });
      const mcn = qc.getQueryData<Mcn[]>(MCNS_KEY)?.find((m) => m.id === id);
      if (!mcn) return;
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: mcn.watchers,
        assignees: mcnAssignees(mcn),
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender: { displayName: comment.authorName, email: comment.authorEmail },
          target: mcnTarget(mcn),
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      if (ctx?.previous) qc.setQueryData(MCNS_KEY, ctx.previous);
      errorToast("Couldn't post comment — it's back in the comment box to send again.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => {
        void qc.invalidateQueries({ queryKey: MCNS_KEY });
      }),
  });
}

export function useEditMcnComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      target,
      bodyHtml,
    }: {
      id: number;
      target: { timestamp: Date; authorEmail: string };
      bodyHtml: string;
      previousBodyHtml: string;
    }) => editMcnComment(id, target, bodyHtml),
    onMutate: async ({ id, bodyHtml, previousBodyHtml }) => {
      const newMentions = newlyMentionedHtml(previousBodyHtml, bodyHtml);
      if (newMentions) await qc.cancelQueries({ queryKey: MCNS_KEY });
      return { autoWatch: beginMcnMentionAutoWatch(qc, id, newMentions) };
    },
    onSuccess: (_data, { id, target, bodyHtml, previousBodyHtml }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment updated." });
      const mcn = qc.getQueryData<Mcn[]>(MCNS_KEY)?.find((m) => m.id === id);
      if (!mcn) return;
      const before = new Set(extractMentionedRecipients(previousBodyHtml).map((r) => r.email.toLowerCase()));
      const added = extractMentionedRecipients(bodyHtml).filter((r) => !before.has(r.email.toLowerCase()));
      if (added.length === 0) return;
      void notifyMentions({
        recipients: added.map((r) => ({ displayName: r.displayName, email: r.email, reason: "mentioned" as const })),
        sender: { displayName: "", email: target.authorEmail },
        target: mcnTarget(mcn),
        commentExcerpt: htmlToPlainText(bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      errorToast("Couldn't update the comment — please retry.");
    },
    onSettled: (_data, _err, _vars, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => {
        void qc.invalidateQueries({ queryKey: MCNS_KEY });
      }),
  });
}

/** Mentioned people watch NOW and are written once the comment lands. Resolved on PMO. */
function beginMcnMentionAutoWatch(qc: QueryClient, id: number, bodyHtml: string): MentionAutoWatch | null {
  const mcn = qc.getQueryData<Mcn[]>(MCNS_KEY)?.find((m) => m.id === id);
  if (!mcn || !bodyHtml) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: mcn.watchers,
    directory: () => collectMcnPeople(qc.getQueryData<Mcn[]>(MCNS_KEY) ?? []),
    resolveLookupId: resolveMcnSiteUserLookupId,
    patch: (watchers) => patchMcn(qc, id, (m) => ({ ...m, watchers })),
    write: (watchers) => setMcnWatchers(id, watchers),
    onWriteFailed: () => void qc.invalidateQueries({ queryKey: MCNS_KEY }),
    noun: "MCN",
  });
}
