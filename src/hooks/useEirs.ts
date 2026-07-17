import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addEirComment,
  createEir,
  editEirComment,
  listEirs,
  setEirAssignedEngineers,
  setEirReporter,
  setEirWatchers,
  updateEirFields,
  type CreateEirInput,
} from "@/api/eirs";
import { createTask } from "@/api/tasks";
import type {
  Eir,
  EirRequestType,
  EirResolution,
  EirStatus,
  Person,
  ProjectReference,
  Task,
} from "@/types/task";
import { pushToast } from "@/components/Toast";
import { multiLookupField } from "@/lib/graphFields";
import {
  commentNotifyRecipients,
  commentRenotifyRecipients,
  extractMentionedRecipients,
  mockLookupIdForEmail,
} from "@/lib/mentions";
import {
  fireAssigneeChangeAlert,
  fireChecklistToggleAlert,
  fireFieldChangeAlert,
  firePromotionAlert,
  notifyMentions,
} from "@/api/email";
import { diffChecklistToggles } from "@/lib/descriptionChecklist";
import { buildPromotedCommunication } from "@/lib/eirPromotion";
import { appItemUrl } from "@/lib/appUrl";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { resolveCurrentUserLookupId } from "@/api/currentUser";
import { USE_MOCK } from "@/api/config";

const EIRS_KEY = ["eirs", "list"] as const;

export function useEirs() {
  return useQuery({
    queryKey: EIRS_KEY,
    queryFn: listEirs,
    staleTime: 120_000,
  });
}

export function useEir(id: number | null) {
  const list = useEirs();
  return {
    ...list,
    data: id !== null ? list.data?.find((e) => e.id === id) ?? null : null,
  };
}

// =============================================================================
// Optimistic mutations + toast/undo — same pattern as src/hooks/useTasks.ts
// =============================================================================

type EirCtx = { previous?: Eir[]; prevEir?: Eir };

async function snapshotAndPatch(
  qc: QueryClient,
  id: number,
  patch: (eirs: Eir[]) => Eir[],
): Promise<EirCtx> {
  await qc.cancelQueries({ queryKey: EIRS_KEY });
  const previous = qc.getQueryData<Eir[]>(EIRS_KEY);
  const prevEir = previous?.find((e) => e.id === id);
  qc.setQueryData<Eir[]>(EIRS_KEY, (old) => (old ? patch(old) : []));
  return { previous, prevEir };
}

function rollback(qc: QueryClient, ctx: EirCtx | undefined) {
  if (ctx?.previous) qc.setQueryData(EIRS_KEY, ctx.previous);
}

function invalidate(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: EIRS_KEY });
}

function patchEir(id: number, transform: (e: Eir) => Eir) {
  return (eirs: Eir[]) => eirs.map((e) => (e.id === id ? transform(e) : e));
}

function buildUndo(
  qc: QueryClient,
  snapshot: Eir[] | undefined,
  revert: () => Promise<unknown>,
): (() => void) | undefined {
  if (!snapshot) return undefined;
  return () => {
    qc.setQueryData<Eir[]>(EIRS_KEY, snapshot);
    revert().catch((err) => {
      console.error("EIR undo failed:", err);
      pushToast({ message: "Couldn't undo on SharePoint. Refreshing.", variant: "error" });
      qc.invalidateQueries({ queryKey: EIRS_KEY });
    });
  };
}

export function useCreateEir() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEirInput) => createEir(input),
    onSuccess: (created) => {
      qc.setQueryData<Eir[]>(EIRS_KEY, (old) => (old ? [created, ...old] : [created]));
      qc.invalidateQueries({ queryKey: EIRS_KEY });
      pushToast({ message: `Created ${created.eirNo || created.title}.` });
    },
    onError: () => pushToast({ message: "Couldn't create EIR — please retry.", variant: "error" }),
  });
}

const TASK_LIST_KEY = ["tasks", "list"] as const;

export interface PromoteEirInput {
  eir: Eir;
  /** Title for the new task — defaults to the EIR's title but is editable. */
  title: string;
  /** Parent project for the new task (drives numbering + the Parent Project). */
  project: ProjectReference | null;
  /** Watchers carried from the EIR onto the task. */
  watchers: Person[];
  /** Pre-computed NumberedTitle (see computeNumberedTitle). */
  numberedTitle: string;
  /** Who is promoting — authors the "Promoted from EIR …" header comment. */
  promotedBy: { displayName: string; email: string };
}

/**
 * Promote an EIR to a Task. Creates the task (carrying the EIR's title,
 * description, project, watchers, EIRReference link, and its whole comment
 * thread tagged as from the EIR), then stamps the EIR: Resolution =
 * "Promoted to Task", TaskPromotedFlag = true, and TaskReference pointed at
 * the new task's numbered title (so the EIR's Linked Task card resolves it).
 *
 * Returns the created task so the caller can navigate to it.
 */
export function usePromoteEirToTask() {
  const qc = useQueryClient();
  return useMutation<Task, unknown, PromoteEirInput>({
    mutationFn: async ({ eir, title, project, watchers, numberedTitle, promotedBy }) => {
      const now = new Date();
      const communication = buildPromotedCommunication({ eir, promotedBy, now });
      const task = await createTask({
        title,
        numberedTitle,
        description: eir.description || undefined,
        parentProjectLookupId: project?.lookupId ?? null,
        watchers,
        eirReference: {
          url: appItemUrl("eir", eir.id),
          label: eir.eirNo || `EIR #${eir.id}`,
        },
        communication: communication || undefined,
      });
      await updateEirFields(eir.id, {
        Resolution: "Promoted to Task",
        TaskPromotedFlag: true,
        TaskReference: task.numberedTitle,
      });
      // Notify the EIR's watchers + reporter (minus the promoter) with a link
      // to the new task. Fire-and-forget — never block the promotion on mail.
      firePromotionAlert({
        eir: {
          id: eir.id,
          eirNo: eir.eirNo,
          title: eir.title,
          watchers: eir.watchers,
          reporter: eir.reporter,
        },
        task: { id: task.id, numberedTitle: task.numberedTitle, title: task.title },
        actor: { displayName: promotedBy.displayName, email: promotedBy.email },
      });
      return task;
    },
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
      qc.invalidateQueries({ queryKey: EIRS_KEY });
      pushToast({ message: `Created task ${task.numberedTitle || task.title} from EIR.` });
    },
    onError: (err) => {
      const detail = err instanceof Error ? err.message : String(err);
      pushToast({
        message: `Couldn't promote EIR to a task. ${truncate(detail, 200)}`,
        variant: "error",
      });
    },
  });
}

export function useUpdateEirFields() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      updateEirFields(id, fields),
    onMutate: ({ id, fields }) =>
      snapshotAndPatch(qc, id, patchEir(id, (e) => applyFieldsLocally(e, fields))),
    onSuccess: (_data, { id, fields }, ctx) => {
      const inverse = ctx?.prevEir ? buildInverseFields(ctx.prevEir, fields) : null;
      pushToast({
        message: messageForFieldsUpdate(fields),
        undo:
          inverse && Object.keys(inverse).length > 0
            ? buildUndo(qc, ctx?.previous, () => updateEirFields(id, inverse))
            : undefined,
      });
      // Status + Resolution are the notify-worthy EIR field changes. Both may
      // change in one update (e.g. completing a linked task closes the EIR),
      // so fire each independently. Recipients = watchers + assigned engineers
      // + reporter, minus the actor.
      if (ctx?.prevEir) {
        const target = {
          kind: "eir" as const,
          id,
          title: eirTargetTitle(ctx.prevEir),
        };
        const recipients = {
          actor,
          watchers: ctx.prevEir.watchers,
          assignees: ctx.prevEir.assignedEngineers,
          reporter: ctx.prevEir.reporter,
        };
        if ("Status" in fields) {
          fireFieldChangeAlert({
            target,
            fieldLabel: "status",
            from: ctx.prevEir.status,
            to: String(fields.Status ?? ""),
            ...recipients,
          });
        }
        if ("Resolution" in fields) {
          fireFieldChangeAlert({
            target,
            fieldLabel: "resolution",
            from: ctx.prevEir.resolution,
            to: String(fields.Resolution ?? ""),
            ...recipients,
          });
        }
        // Description-checklist toggles alert watchers + assigned engineers
        // only (no reporter — checklist ticks are working detail).
        if ("Description" in fields) {
          fireChecklistToggleAlert({
            target,
            toggles: diffChecklistToggles(
              ctx.prevEir.description ?? "",
              String(fields.Description ?? ""),
            ),
            actor,
            watchers: ctx.prevEir.watchers,
            assignees: ctx.prevEir.assignedEngineers,
          });
        }
      }
    },
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      const detail = err instanceof Error ? err.message : String(err);
      pushToast({
        message: `Couldn't save changes — reverted. ${truncate(detail, 240)}`,
        variant: "error",
      });
    },
    onSettled: () => invalidate(qc),
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function useSetEirReporter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person | null }) =>
      setEirReporter(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(qc, id, patchEir(id, (e) => ({ ...e, reporter: person, modifiedAt: new Date() }))),
    onSuccess: (_d, { id }, ctx) => {
      const prev = ctx?.prevEir?.reporter ?? null;
      pushToast({
        message: "Reporter updated.",
        undo: buildUndo(qc, ctx?.previous, () => setEirReporter(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: "Couldn't update reporter — reverted.", variant: "error" });
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetEirAssignedEngineers() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setEirAssignedEngineers(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatch(qc, id, patchEir(id, (e) => ({ ...e, assignedEngineers: people, modifiedAt: new Date() }))),
    onSuccess: (_d, { id, people }, ctx) => {
      const prev = ctx?.prevEir?.assignedEngineers ?? [];
      pushToast({
        message: "Assigned engineers updated.",
        undo: buildUndo(qc, ctx?.previous, () => setEirAssignedEngineers(id, prev)),
      });
      if (ctx?.prevEir) {
        fireAssigneeChangeAlert({
          target: { kind: "eir", id, title: eirTargetTitle(ctx.prevEir) },
          prev,
          next: people,
          actor,
          watchers: ctx.prevEir.watchers,
          reporter: ctx.prevEir.reporter,
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: "Couldn't update engineers — reverted.", variant: "error" });
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetEirWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) => setEirWatchers(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatch(qc, id, patchEir(id, (e) => ({ ...e, watchers: people, modifiedAt: new Date() }))),
    onSuccess: (_d, { id }, ctx) => {
      const prev = ctx?.prevEir?.watchers ?? [];
      pushToast({
        message: "Watchers updated.",
        undo: buildUndo(qc, ctx?.previous, () => setEirWatchers(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: "Couldn't update watchers — reverted.", variant: "error" });
    },
    onSettled: () => invalidate(qc),
  });
}

export function useAddEirComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addEirComment(id, comment),
    onMutate: ({ id, comment }) =>
      snapshotAndPatch(
        qc,
        id,
        patchEir(id, (e) => ({
          ...e,
          comments: [
            {
              timestamp: new Date(),
              authorName: comment.authorName,
              authorEmail: comment.authorEmail,
              bodyHtml: comment.bodyHtml,
              attachments: [],
            },
            ...e.comments,
          ],
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const eirs = qc.getQueryData<Eir[]>(EIRS_KEY);
      const eir = eirs?.find((e) => e.id === id);
      if (!eir) return;

      // Email everyone watching this EIR + everyone @-mentioned, minus the
      // author (unless they self-mentioned). Fire-and-forget; failures are
      // logged inside notifyMentions and never surface to the user.
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: eir.watchers,
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender: { displayName: comment.authorName, email: comment.authorEmail },
          target: {
            kind: "eir",
            id: eir.id,
            title: [eir.eirNo, eir.title].filter(Boolean).join(" — ") || eir.title,
          },
          commentExcerpt: eirCommentExcerpt(comment.bodyHtml),
          attachments: [],
        });
      }

      // Auto-watch: anyone @-mentioned becomes a watcher on this EIR (unless
      // they already are).
      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchEirFromMentions({
        recipients: mentioned,
        currentWatchers: eir.watchers,
        directory: eirs ? collectPeopleFromEirs(eirs) : [],
      })
        .then((additions) => applyEirWatcherAdditions(qc, id, eir.watchers, additions))
        .catch((err) => {
          console.error("Auto-watch failed for EIR comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: "Couldn't post comment — please retry.", variant: "error" });
    },
    onSettled: () => invalidate(qc),
  });
}

/**
 * Apply auto-watch additions optimistically — watcher chips + toast show
 * immediately, the SharePoint write happens in the background (re-patching
 * the cache after it lands in case a refetch overwrote the optimistic
 * version). On failure: error toast + refetch so the UI doesn't lie.
 */
async function applyEirWatcherAdditions(
  qc: QueryClient,
  id: number,
  currentWatchers: Person[],
  additions: Person[],
): Promise<void> {
  if (additions.length === 0) return;
  const next = [...currentWatchers, ...additions];
  const patch = () =>
    qc.setQueryData<Eir[]>(EIRS_KEY, (old) =>
      old?.map((e) => (e.id === id ? { ...e, watchers: next } : e)),
    );
  patch();
  pushToast({
    message:
      additions.length === 1
        ? `${additions[0].displayName} is now watching this EIR.`
        : `${additions.length} people are now watching this EIR.`,
  });
  try {
    await setEirWatchers(id, next);
    patch();
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    pushToast({
      message: "Couldn't add the mentioned person as a watcher — refreshing.",
      variant: "error",
    });
    qc.invalidateQueries({ queryKey: EIRS_KEY });
  }
}

/**
 * Resolve which @-mentioned people should become new watchers on an EIR.
 * Prefers the EIR-derived directory (reporter/assignees/watchers across all
 * EIRs); for someone mentioned for the first time who's never appeared
 * there, falls back to resolving their SharePoint lookupId on demand from
 * the site's User Information List — otherwise a cold-start mention (never
 * an EIR participant before) could never be auto-watched.
 */
async function autoWatchEirFromMentions({
  recipients,
  currentWatchers,
  directory,
}: {
  recipients: Person[];
  currentWatchers: Person[];
  directory: Person[];
}): Promise<Person[]> {
  const alreadyWatching = new Set(
    currentWatchers.map((w) => (w.email ?? w.displayName).toLowerCase()),
  );
  const byEmail = new Map<string, Person>();
  for (const p of directory) {
    if (p.email && p.lookupId) byEmail.set(p.email.toLowerCase(), p);
  }
  const additions: Person[] = [];
  for (const r of recipients) {
    const key = (r.email ?? r.displayName).toLowerCase();
    if (alreadyWatching.has(key)) continue;
    if (!r.email) continue;
    let resolved = byEmail.get(r.email.toLowerCase());
    if (!resolved) {
      const lookupId = USE_MOCK
        ? mockLookupIdForEmail(r.email)
        : await resolveCurrentUserLookupId(r.email);
      if (!lookupId) continue;
      resolved = { displayName: r.displayName, email: r.email, lookupId };
    }
    additions.push(resolved);
    alreadyWatching.add(key);
  }
  return additions;
}

/** Flatten every Person across the EIR list, deduped, lookupId-only. */
function collectPeopleFromEirs(eirs: Eir[]): Person[] {
  const map = new Map<string, Person>();
  for (const e of eirs) {
    const candidates: Person[] = [];
    if (e.reporter) candidates.push(e.reporter);
    candidates.push(...e.assignedEngineers, ...e.watchers);
    for (const p of candidates) {
      const key = (p.email ?? p.displayName).toLowerCase();
      if (!map.has(key) && p.lookupId) map.set(key, p);
    }
  }
  return [...map.values()];
}

export function useEditEirComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      target,
      newBodyHtml,
    }: {
      id: number;
      target: { timestamp: Date; authorEmail: string };
      newBodyHtml: string;
      /** Author opted in to "Notify everyone again" — see onSuccess below. */
      renotify?: boolean;
    }) => editEirComment(id, target, newBodyHtml),
    onMutate: ({ id, target, newBodyHtml }) =>
      snapshotAndPatch(
        qc,
        id,
        patchEir(id, (e) => ({
          ...e,
          comments: e.comments.map((c) =>
            c.timestamp.getTime() === target.timestamp.getTime() &&
            (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
              ? { ...c, bodyHtml: newBodyHtml }
              : c,
          ),
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_d, { id, target, newBodyHtml, renotify }, ctx) => {
      const prevComment = ctx?.prevEir?.comments.find(
        (c) =>
          c.timestamp.getTime() === target.timestamp.getTime() &&
          (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase(),
      );
      const prevBody = prevComment?.bodyHtml;
      pushToast({
        message: "Comment updated.",
        undo:
          prevBody !== undefined
            ? buildUndo(qc, ctx?.previous, () => editEirComment(id, target, prevBody))
            : undefined,
      });

      if (!prevComment) return;
      const eirs = qc.getQueryData<Eir[]>(EIRS_KEY);
      const eir = eirs?.find((e) => e.id === id);
      if (!eir) return;

      if (renotify) {
        // Author explicitly asked to renotify the group — resend to everyone
        // who'd hear about this comment (watchers + current AND previously
        // @-mentioned people), tagged "edited" so the email reads as an
        // update, not a brand-new comment.
        const recipients = commentRenotifyRecipients({
          bodyHtml: newBodyHtml,
          previousBodyHtml: prevBody,
          watchers: eir.watchers,
          authorEmail: prevComment.authorEmail,
        });
        if (recipients.length > 0) {
          void notifyMentions({
            recipients,
            sender: { displayName: prevComment.authorName, email: prevComment.authorEmail },
            target: { kind: "eir", id: eir.id, title: eirTargetTitle(eir) },
            commentExcerpt: eirCommentExcerpt(newBodyHtml),
            attachments: prevComment.attachments ?? [],
          });
        }
      }

      // Auto-watch: anyone @-mentioned in the edited body becomes a watcher
      // on this EIR (unless already watching) — same rule as posting a new
      // comment, regardless of whether renotify was requested.
      const mentioned = extractMentionedRecipients(newBodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchEirFromMentions({
        recipients: mentioned,
        currentWatchers: eir.watchers,
        directory: eirs ? collectPeopleFromEirs(eirs) : [],
      })
        .then((additions) => applyEirWatcherAdditions(qc, id, eir.watchers, additions))
        .catch((err) => {
          console.error("Auto-watch failed for edited EIR comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      pushToast({ message: "Couldn't save comment — reverted.", variant: "error" });
    },
    onSettled: () => invalidate(qc),
  });
}

// =============================================================================
// Helpers
// =============================================================================

/** Human-readable EIR label for email subjects/callouts ("EIR_2026-0042 — Title"). */
function eirTargetTitle(e: Eir): string {
  return [e.eirNo, e.title].filter(Boolean).join(" — ") || e.title;
}

/** Strip a comment's HTML to a plain-text excerpt for the notification email. */
function eirCommentExcerpt(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function applyFieldsLocally(
  e: Eir,
  fields: Record<string, unknown>,
): Eir {
  const next: Eir = { ...e, modifiedAt: new Date() };
  if ("Title" in fields) next.title = (fields.Title as string) ?? next.title;
  if ("Description" in fields) next.description = (fields.Description as string) ?? "";
  if ("Status" in fields) next.status = fields.Status as EirStatus;
  if ("Resolution" in fields) next.resolution = fields.Resolution as EirResolution;
  if ("RequestType" in fields) next.requestType = fields.RequestType as EirRequestType | null;
  if ("Priority" in fields) {
    const v = fields.Priority as string | null;
    next.requestedPriority = v as Eir["requestedPriority"];
  }
  if ("EngineeringResponse" in fields) next.engineeringResponse = (fields.EngineeringResponse as string) ?? "";
  if ("WhereUsed" in fields) next.whereUsed = (fields.WhereUsed as string) ?? "";
  if ("EAU" in fields) next.eau = (fields.EAU as string) ?? "";
  if ("CurrentStock" in fields) next.currentStock = (fields.CurrentStock as string) ?? "";
  if ("MFG" in fields) next.mfg = (fields.MFG as string) ?? "";
  if ("MFGP_x002f_N" in fields) next.mfgPartNumber = (fields.MFGP_x002f_N as string) ?? "";
  if ("Current_x0020_Price" in fields) next.currentPrice = (fields.Current_x0020_Price as string) ?? "";
  if ("Altronic_x0020_Part_x0020_Number" in fields)
    next.altronicPartNumber = (fields.Altronic_x0020_Part_x0020_Number as string) ?? "";
  if ("TaskReference" in fields) next.taskReference = (fields.TaskReference as string) ?? "";
  if ("TaskPromotedFlag" in fields) next.taskPromotedFlag = !!fields.TaskPromotedFlag;
  if ("BuyerCode" in fields) next.buyerCode = (fields.BuyerCode as string) ?? "";
  if ("RiskPart" in fields) next.riskPart = (fields.RiskPart as Eir["riskPart"]) ?? null;
  if ("RiskPartLevel" in fields)
    next.riskPartLevel = (fields.RiskPartLevel as Eir["riskPartLevel"]) ?? null;
  if ("TechnicalPriority" in fields)
    next.technicalPriority = (fields.TechnicalPriority as Eir["technicalPriority"]) ?? null;
  if ("Requested_x0020_Completion_x0020" in fields) {
    const v = fields.Requested_x0020_Completion_x0020;
    next.requestedCompletionDate = v ? new Date(v as string) : null;
  }
  if ("LTBDate" in fields) {
    const v = fields.LTBDate;
    next.ltbDate = v ? new Date(v as string) : null;
  }
  if (
    "ProjectReferenceLookupId" in fields ||
    "ProjectReference" in fields
  ) {
    // Multi-value Lookup column — the write is an array of project
    // lookupIds under `ProjectReferenceLookupId` (Graph requires the
    // suffix for lookup-id collections).
    const raw =
      (fields.ProjectReferenceLookupId as unknown) ??
      (fields.ProjectReference as unknown);
    const ids: number[] = [];
    if (Array.isArray(raw)) {
      for (const x of raw) {
        if (typeof x === "number" && x > 0) ids.push(x);
      }
    } else if (typeof raw === "number" && raw > 0) {
      ids.push(raw);
    }
    next.parentProjects = ids.map((id) => ({ lookupId: id, title: "" }));
  }
  return next;
}

function buildInverseFields(prev: Eir, fields: Record<string, unknown>): Record<string, unknown> {
  const inv: Record<string, unknown> = {};
  if ("Title" in fields) inv.Title = prev.title;
  if ("Description" in fields) inv.Description = prev.description;
  if ("Status" in fields) inv.Status = prev.status;
  if ("Resolution" in fields) inv.Resolution = prev.resolution;
  if ("RequestType" in fields) inv.RequestType = prev.requestType;
  if ("Priority" in fields) inv.Priority = prev.requestedPriority;
  if ("EngineeringResponse" in fields) inv.EngineeringResponse = prev.engineeringResponse;
  if ("WhereUsed" in fields) inv.WhereUsed = prev.whereUsed;
  if ("EAU" in fields) inv.EAU = prev.eau;
  if ("CurrentStock" in fields) inv.CurrentStock = prev.currentStock;
  if ("MFG" in fields) inv.MFG = prev.mfg;
  if ("MFGP_x002f_N" in fields) inv.MFGP_x002f_N = prev.mfgPartNumber;
  if ("Current_x0020_Price" in fields) inv.Current_x0020_Price = prev.currentPrice;
  if ("Altronic_x0020_Part_x0020_Number" in fields)
    inv.Altronic_x0020_Part_x0020_Number = prev.altronicPartNumber;
  if ("TaskReference" in fields) inv.TaskReference = prev.taskReference;
  if ("BuyerCode" in fields) inv.BuyerCode = prev.buyerCode;
  if ("Requested_x0020_Completion_x0020" in fields)
    inv.Requested_x0020_Completion_x0020 = prev.requestedCompletionDate
      ? prev.requestedCompletionDate.toISOString()
      : null;
  if ("LTBDate" in fields)
    inv.LTBDate = prev.ltbDate ? prev.ltbDate.toISOString() : null;
  if (
    "ProjectReferenceLookupId" in fields ||
    "ProjectReference" in fields
  ) {
    const ids = prev.parentProjects.map((p) => p.lookupId).filter((x) => x > 0);
    Object.assign(inv, multiLookupField("ProjectReference", ids));
  }
  return inv;
}

function messageForFieldsUpdate(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).filter((k) => !k.endsWith("@odata.type"));
  if (keys.length === 1) {
    switch (keys[0]) {
      case "Status":
        return `Status changed to "${fields.Status}".`;
      case "Resolution":
        return `Resolution changed to "${fields.Resolution}".`;
      case "RequestType":
        return `Request type changed to "${fields.RequestType}".`;
      case "Priority":
        return fields.Priority
          ? `Requested priority changed to "${fields.Priority}".`
          : "Requested priority cleared.";
      case "EngineeringResponse":
        return "Engineering response updated.";
      case "Title":
        return "Title updated.";
      case "Description":
        return "Description updated.";
      case "WhereUsed":
      case "EAU":
      case "CurrentStock":
      case "MFG":
      case "MFGP_x002f_N":
      case "Current_x0020_Price":
      case "Altronic_x0020_Part_x0020_Number":
        return "Part details updated.";
      case "Requested_x0020_Completion_x0020":
        return "Requested completion date updated.";
      case "LTBDate":
        return "LTB date updated.";
      case "ProjectReference":
      case "ProjectReferenceLookupId":
        return "Project updated.";
      case "TaskReference":
        return "Task reference updated.";
    }
  }
  return "EIR updated.";
}

