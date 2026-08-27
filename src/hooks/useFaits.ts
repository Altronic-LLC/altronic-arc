import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addFaitComment,
  createFait,
  editFaitComment,
  FaitInitiatorNotSetError,
  FaitReadBackError,
  listFaits,
  setFaitWatchers,
  updateFaitAssignedEngineer,
  updateFaitFields,
  updateFaitKam,
} from "@/api/faits";
import type { Fait, FaitInput, Person } from "@/types/task";
import { collectFaitPeople, faitLabel } from "@/lib/faitMapper";
import { commentNotifyRecipients, extractMentionedRecipients } from "@/lib/mentions";
import { fireFaitClosedAlert, fireFieldChangeAlert, fireNewFaitAlert, notifyMentions } from "@/api/email";
import type { AlertDetail } from "@/lib/changeAlerts";
import { autoWatchFromMentions } from "@/api/autoWatch";
// The FAIT list is on the Engineering site, so cold-start mentions resolve there.
import { resolveCurrentUserLookupId } from "@/api/currentUser";
import { autoWatchers, mergePeople } from "@/lib/people";
import { htmlToPlainText } from "@/lib/htmlText";
import { useCurrentUser } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";

// =============================================================================
// FAIT hooks.
//
// The standard ARC comment thread: post → optimistic insert → email every
// watcher and @-mentioned person → add the mentioned as watchers. Field edits
// are optimistic and card-shaped, so a sign-off doesn't sit there for a
// round-trip.
//
// Unlike ECNs, this list HAS a Watchers column, so the normal watcher rules
// apply — whoever raises a FAIT watches it, and a mention subscribes.
// =============================================================================

export const FAITS_KEY = ["faits"] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useFaits() {
  return useQuery({ queryKey: FAITS_KEY, queryFn: listFaits, staleTime: 60_000 });
}

/** One FAIT out of the cached list. */
export function useFait(id: number | null) {
  const { data: faits = [], ...rest } = useFaits();
  return { ...rest, data: id === null ? undefined : faits.find((f) => f.id === id) };
}

export { collectFaitPeople };

function patchFait(qc: QueryClient, id: number, update: (f: Fait) => Fait) {
  qc.setQueryData<Fait[]>(FAITS_KEY, (old) => old?.map((f) => (f.id === id ? update(f) : f)));
}

/** The Part-section columns worth naming in the new-FAIT intake email. */
function newFaitDetails(fait: Fait): AlertDetail[] {
  return [
    { label: "SAP Part Number", value: fait.values.sapPartNumber ?? "" },
    { label: "Description", value: fait.values.description ?? "" },
    { label: "Supplier", value: fait.values.supplierName ?? "" },
    { label: "Drawing Number", value: fait.values.drawingNumber ?? "" },
  ];
}

export function useCreateFait() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    // Whoever raises it watches it — see autoWatchers in lib/people.ts.
    //
    // A FAIT whose Initiator column couldn't be written is still a real FAIT,
    // so the create COMPLETES and warns about the one thing that didn't land
    // rather than reporting a failure that didn't happen. Returning the FAIT
    // keeps this hook's contract a plain `Fait` for every caller.
    mutationFn: async (input: FaitInput) => {
      try {
        return await createFait(input, actor);
      } catch (err) {
        if (err instanceof FaitInitiatorNotSetError) {
          errorToast(err.message);
          return err.fait;
        }
        throw err;
      }
    },
    onSuccess: (created) => {
      qc.setQueryData<Fait[]>(FAITS_KEY, (old) => (old ? [created, ...old] : [created]));
      qc.invalidateQueries({ queryKey: FAITS_KEY });
      pushToast({ message: `Raised ${faitLabel(created)}.` });
      // Nothing watches the FAIT list itself, so the configured intake queue
      // (SQE/Engineering/Supply Chain) is told a new one needs picking up —
      // same gap Gray Market's intake alert closed (Ray, 2026-08-26).
      fireNewFaitAlert({
        target: { kind: "fait", id: created.id, title: faitLabel(created) },
        actor,
        details: newFaitDetails(created),
      });
    },
    onError: (err: Error) => errorToast(`Couldn't raise the FAIT: ${err.message}`),
  });
}

/** Patch one or more columns, optimistically. */
export function useUpdateFaitFields() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown>; patch: (f: Fait) => Fait }) =>
      updateFaitFields(id, fields),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: FAITS_KEY });
      const previous = qc.getQueryData<Fait[]>(FAITS_KEY);
      const prevFait = previous?.find((f) => f.id === id);
      patchFait(qc, id, patch);
      return { previous, prevFait };
    },
    onSuccess: (updated, { fields }, ctx) => {
      patchFait(qc, updated.id, () => updated);
      // The generic "status changed from X to Y" note, to watchers + the
      // people who own the FAIT (initiator, engineer, KAM) — the normal
      // status-change alert every other list with a Watchers column gets
      // (Ray, 2026-08-26), same shape as EIR's.
      if (ctx?.prevFait && "Status" in fields) {
        const from = ctx.prevFait.status;
        const to = String(fields.Status ?? "");
        fireFieldChangeAlert({
          target: { kind: "fait", id: updated.id, title: faitLabel(ctx.prevFait) },
          fieldLabel: "status",
          from,
          to,
          actor,
          watchers: ctx.prevFait.watchers,
          assignees: [ctx.prevFait.initiator, ctx.prevFait.assignedEngineer, ctx.prevFait.kam].filter(
            (p): p is Person => p !== null,
          ),
        });
        // The SAME intake list that was told when this FAIT was raised is
        // told it's closed, too (Ray, 2026-08-27) — being on that list
        // doesn't make someone a watcher, so the generic alert above never
        // reaches them. `to !== from` is OUR guard: re-saving an
        // already-Closed FAIT must not re-announce it as just closed.
        if (to.trim().toLowerCase() === "closed" && to !== from) {
          fireFaitClosedAlert({
            target: { kind: "fait", id: updated.id, title: faitLabel(ctx.prevFait) },
            actor,
          });
        }
      }
    },
    onError: (err: Error, _vars, ctx) => {
      // A read-back failure means the PATCH LANDED — rolling the change off
      // the screen would be a lie, and it's the lie that made several FAIT
      // columns look like they wouldn't save. Keep the optimistic value and
      // let onSettled's refetch reconcile it.
      if (err instanceof FaitReadBackError) {
        errorToast(err.message);
        return;
      }
      if (ctx?.previous) qc.setQueryData(FAITS_KEY, ctx.previous);
      errorToast(`Couldn't save that change — reverted. ${err.message}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: FAITS_KEY }),
  });
}

/**
 * Assign (or clear) the engineer. They also become a watcher — see
 * `updateFaitAssignedEngineer`.
 *
 * Optimistic, like every other write on this page. It wasn't, and that hid
 * the underlying bug: the picker's selection is derived from the FAIT, so
 * until the round trip landed it kept reading "Not set" — which looked
 * identical to a pick that hadn't registered at all.
 */
export function useUpdateFaitAssignedEngineer() {
  return usePersonAssignment(
    ({ id, person }) => updateFaitAssignedEngineer(id, person),
    (person) => (f) => ({ ...f, assignedEngineer: person, watchers: autoWatchers(f.watchers, person) }),
    "Assigned Engineer",
  );
}

/** Assign (or clear) the KAM. Clearing it is how a FAIT that doesn't need a KAM sign-off says so. */
export function useUpdateFaitKam() {
  return usePersonAssignment(
    ({ id, person }) => updateFaitKam(id, person),
    (person) => (f) => ({ ...f, kam: person, watchers: autoWatchers(f.watchers, person) }),
    "KAM",
  );
}

/**
 * The shared shape of the two single-person assignment writes: patch the
 * cache at once, land the server's row on success, put the old row back and
 * SAY WHY on failure.
 *
 * One helper rather than two near-identical hooks — the engineer's version
 * was the one that got the fix first last time, and the KAM's didn't.
 */
function usePersonAssignment(
  write: (vars: { id: number; person: Person | null }) => Promise<Fait>,
  patch: (person: Person | null) => (f: Fait) => Fait,
  label: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: write,
    onMutate: async ({ id, person }) => {
      await qc.cancelQueries({ queryKey: FAITS_KEY });
      const previous = qc.getQueryData<Fait[]>(FAITS_KEY);
      patchFait(qc, id, patch(person));
      return { previous };
    },
    onSuccess: (updated) => patchFait(qc, updated.id, () => updated),
    onError: (err: Error, _vars, ctx) => {
      if (err instanceof FaitReadBackError) {
        errorToast(err.message);
        return;
      }
      if (ctx?.previous) qc.setQueryData(FAITS_KEY, ctx.previous);
      errorToast(`Couldn't set the ${label} — reverted. ${err.message}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: FAITS_KEY }),
  });
}

export function useSetFaitWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) => setFaitWatchers(id, people),
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: FAITS_KEY });
      const previous = qc.getQueryData<Fait[]>(FAITS_KEY);
      patchFait(qc, id, (f) => ({ ...f, watchers: people }));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(FAITS_KEY, ctx.previous);
      errorToast("Couldn't update the watchers — reverted.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: FAITS_KEY }),
  });
}

export function useAddFaitComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addFaitComment(id, comment),
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: FAITS_KEY });
      const previous = qc.getQueryData<Fait[]>(FAITS_KEY);
      patchFait(qc, id, (f) => ({
        ...f,
        comments: [
          {
            timestamp: new Date(),
            authorName: comment.authorName,
            authorEmail: comment.authorEmail,
            bodyHtml: comment.bodyHtml,
            attachments: [],
          },
          ...f.comments,
        ],
        modifiedAt: new Date(),
      }));
      return { previous };
    },
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const faits = qc.getQueryData<Fait[]>(FAITS_KEY);
      const fait = faits?.find((f) => f.id === id);
      if (!fait) return;

      // Watchers + the people who own the FAIT, minus the author. The
      // initiator, engineer and KAM all play the "assignee" part here —
      // they're the ones waiting on it.
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: fait.watchers,
        assignees: [fait.initiator, fait.assignedEngineer, fait.kam],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender: { displayName: comment.authorName, email: comment.authorEmail },
          target: { kind: "fait", id: fait.id, title: faitLabel(fait) },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }

      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchFromMentions({
        resolveLookupId: resolveCurrentUserLookupId,
        recipients: mentioned,
        currentWatchers: fait.watchers,
        directory: faits ? collectFaitPeople(faits) : [],
      })
        .then((additions: Person[]) => applyWatcherAdditions(qc, id, fait.watchers, additions))
        .catch((err: unknown) => console.error("Auto-watch failed for a FAIT comment:", err));
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(FAITS_KEY, ctx.previous);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: FAITS_KEY }),
  });
}

export function useEditFaitComment() {
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
    }) => editFaitComment(id, target, bodyHtml),
    onSuccess: (_data, { id, target, bodyHtml, previousBodyHtml }) => {
      pushToast({ message: "Comment updated." });
      const fait = qc.getQueryData<Fait[]>(FAITS_KEY)?.find((f) => f.id === id);
      if (!fait) return;

      // Only the NEWLY mentioned are emailed — editing shouldn't re-ping
      // everyone who was already in the comment.
      const before = new Set(
        extractMentionedRecipients(previousBodyHtml).map((r) => r.email.toLowerCase()),
      );
      const added = extractMentionedRecipients(bodyHtml).filter(
        (r) => !before.has(r.email.toLowerCase()),
      );
      if (added.length === 0) return;

      void notifyMentions({
        recipients: added.map((r) => ({
          displayName: r.displayName,
          email: r.email,
          reason: "mentioned" as const,
        })),
        sender: { displayName: "", email: target.authorEmail },
        target: { kind: "fait", id: fait.id, title: faitLabel(fait) },
        commentExcerpt: htmlToPlainText(bodyHtml),
        attachments: [],
      });
    },
    onError: () => errorToast("Couldn't update the comment — please retry."),
    onSettled: () => qc.invalidateQueries({ queryKey: FAITS_KEY }),
  });
}

/** Apply auto-watch additions optimistically, then save them. */
async function applyWatcherAdditions(
  qc: QueryClient,
  id: number,
  currentWatchers: Person[],
  additions: Person[],
): Promise<void> {
  if (additions.length === 0) return;
  const next = autoWatchers(currentWatchers, additions);
  const patch = () => patchFait(qc, id, (f) => ({ ...f, watchers: next }));
  patch();
  pushToast({
    message:
      additions.length === 1
        ? `${additions[0].displayName} is now watching this FAIT.`
        : `${additions.length} people are now watching this FAIT.`,
  });
  try {
    await setFaitWatchers(id, next);
    patch();
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    errorToast("Couldn't add the mentioned person as a watcher — refreshing.");
    qc.invalidateQueries({ queryKey: FAITS_KEY });
  }
}

export { mergePeople };
