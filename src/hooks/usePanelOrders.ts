import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addPanelOrderComment,
  createPanelOrder,
  editPanelOrderComment,
  getPanelOrderChoices,
  listPanelOrders,
  listPanelSiteUsers,
  resolvePanelSiteUserLookupId,
  setPanelOrderEngineer,
  setPanelOrderProject,
  setPanelOrderWatchers,
  unwatchPanelOrder,
  updatePanelOrderFields,
  watchPanelOrder,
} from "@/api/panelOrders";
import { createPanelProject, listPanelProjects, updatePanelProject } from "@/api/panelProjects";
import type { PanelOrder, PanelProject, Person } from "@/types/task";
import { pushToast } from "@/components/Toast";
import {
  fireAssigneeChangeAlert,
  fireChecklistToggleAlert,
  fireFieldChangeAlert,
  notifyMentions,
} from "@/api/email";
import { diffChecklistToggles } from "@/lib/descriptionChecklist";
import {
  commentNotifyRecipients,
  commentRenotifyRecipients,
  extractMentionedRecipients,
  mockLookupIdForEmail,
} from "@/lib/mentions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { USE_MOCK } from "@/api/config";

// =============================================================================
// Panels department hooks — mirrors useOperationsTasks.ts's optimistic-update
// infra (snapshot/patch/rollback/undo), forked for PanelOrder's own query key
// (the infra closes over the entity type directly and isn't generic). See
// src/api/panelOrders.ts for the underlying API calls.
// =============================================================================

export const PANEL_ORDERS_KEY = ["panelOrders", "list"] as const;
export const PANEL_PROJECTS_KEY = ["panelProjects"] as const;
const PANEL_CHOICES_KEY = ["panelOrderChoices"] as const;

export function usePanelOrders() {
  return useQuery({
    queryKey: PANEL_ORDERS_KEY,
    queryFn: listPanelOrders,
    staleTime: 120_000,
  });
}

export function usePanelOrder(id: number | null) {
  const list = usePanelOrders();
  return {
    ...list,
    data: id !== null ? list.data?.find((o) => o.id === id) ?? null : null,
  };
}

export function usePanelProjects() {
  return useQuery({
    queryKey: PANEL_PROJECTS_KEY,
    queryFn: listPanelProjects,
    staleTime: 5 * 60_000,
  });
}

/** Live Status/Customer choice values for the header list (discovered at runtime). */
export function usePanelOrderChoices() {
  return useQuery({
    queryKey: PANEL_CHOICES_KEY,
    queryFn: getPanelOrderChoices,
    staleTime: 10 * 60_000,
  });
}

/**
 * The panel site's user directory as a sorted array — used by the Panel
 * User Roles admin page's person picker (writes need a real lookupId).
 */
export function usePanelSiteUsers() {
  return useQuery({
    queryKey: ["panelSiteUsers"],
    queryFn: async (): Promise<Person[]> => {
      const map = await listPanelSiteUsers();
      return [...map.values()]
        .filter((p) => p.displayName)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
    staleTime: 10 * 60_000,
  });
}

type PanelOrderCtx = { previous?: PanelOrder[]; prevOrder?: PanelOrder };

async function snapshotAndPatch(
  qc: QueryClient,
  prevOrderId: number | null,
  patch: (orders: PanelOrder[]) => PanelOrder[],
): Promise<PanelOrderCtx> {
  await qc.cancelQueries({ queryKey: PANEL_ORDERS_KEY });
  const previous = qc.getQueryData<PanelOrder[]>(PANEL_ORDERS_KEY);
  const prevOrder = prevOrderId != null ? previous?.find((o) => o.id === prevOrderId) : undefined;
  qc.setQueryData<PanelOrder[]>(PANEL_ORDERS_KEY, (old) => (old ? patch(old) : []));
  return { previous, prevOrder };
}

function rollback(qc: QueryClient, ctx: PanelOrderCtx | undefined) {
  if (ctx?.previous) qc.setQueryData(PANEL_ORDERS_KEY, ctx.previous);
}

function invalidatePanelOrders(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: PANEL_ORDERS_KEY });
}

function patchPanelOrder(id: number, transform: (o: PanelOrder) => PanelOrder) {
  return (orders: PanelOrder[]) => orders.map((o) => (o.id === id ? transform(o) : o));
}

function buildUndo(
  qc: QueryClient,
  snapshot: PanelOrder[] | undefined,
  serverRevert: () => Promise<unknown>,
): (() => void) | undefined {
  if (!snapshot) return undefined;
  return () => {
    qc.setQueryData<PanelOrder[]>(PANEL_ORDERS_KEY, snapshot);
    serverRevert().catch((err) => {
      console.error("Undo failed:", err);
      pushToast({
        message: "Couldn't undo on SharePoint. Refreshing the list.",
        variant: "error",
      });
      qc.invalidateQueries({ queryKey: PANEL_ORDERS_KEY });
    });
  };
}

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

function orderTitle(o: PanelOrder): string {
  return o.title;
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Update arbitrary fields. Used for every inline edit on the detail page —
 * when Status is among the changed fields it fires the watcher/engineer
 * alert; OrderNotes changes are diffed for checklist toggles.
 */
export function useUpdatePanelOrderFields() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      updatePanelOrderFields(id, fields),
    onMutate: ({ id, fields }) =>
      snapshotAndPatch(qc, id, patchPanelOrder(id, (o) => applyFieldsLocally(o, fields))),
    onSuccess: (_data, { id, fields }, ctx) => {
      pushToast({ message: messageForFieldsUpdate(fields) });
      if ("Status" in fields && ctx?.prevOrder) {
        fireFieldChangeAlert({
          target: { kind: "panelOrder", id, title: orderTitle(ctx.prevOrder) },
          fieldLabel: "status",
          from: ctx.prevOrder.status,
          to: String(fields.Status ?? ""),
          actor,
          watchers: ctx.prevOrder.watchers,
          assignees: ctx.prevOrder.engineerAssigned ? [ctx.prevOrder.engineerAssigned] : [],
        });
      }
      // Order Notes checklist toggles alert too (same audience as Status).
      if ("OrderNotes" in fields && ctx?.prevOrder) {
        fireChecklistToggleAlert({
          target: { kind: "panelOrder", id, title: orderTitle(ctx.prevOrder) },
          toggles: diffChecklistToggles(
            ctx.prevOrder.orderNotes ?? "",
            String(fields.OrderNotes ?? ""),
          ),
          actor,
          watchers: ctx.prevOrder.watchers,
          assignees: ctx.prevOrder.engineerAssigned ? [ctx.prevOrder.engineerAssigned] : [],
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't save changes — they have been reverted.");
    },
    onSettled: () => invalidatePanelOrders(qc),
  });
}

export function useSetPanelOrderProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectLookupId }: { id: number; projectLookupId: number | null }) =>
      setPanelOrderProject(id, projectLookupId),
    onMutate: ({ id, projectLookupId }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelOrder(id, (o) => ({
          ...o,
          projectRef:
            projectLookupId != null
              ? {
                  lookupId: projectLookupId,
                  title:
                    qc
                      .getQueryData<PanelProject[]>(PANEL_PROJECTS_KEY)
                      ?.find((p) => p.id === projectLookupId)?.title ?? "",
                }
              : null,
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevOrder?.projectRef?.lookupId ?? null;
      pushToast({
        message: "Project reference updated.",
        undo: buildUndo(qc, ctx?.previous, () => setPanelOrderProject(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update the project reference — reverted.");
    },
    onSettled: () => invalidatePanelOrders(qc),
  });
}

export function useSetPanelOrderEngineer() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person | null }) =>
      setPanelOrderEngineer(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelOrder(id, (o) => ({ ...o, engineerAssigned: person, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      const prev = ctx?.prevOrder?.engineerAssigned ?? null;
      pushToast({
        message: "Engineer updated.",
        undo: buildUndo(qc, ctx?.previous, () => setPanelOrderEngineer(id, prev)),
      });
      if (ctx?.prevOrder) {
        // fireAssigneeChangeAlert expects arrays (built for Engineering's
        // multi-person Assigned) — wrap the single value in a 0-or-1 array.
        fireAssigneeChangeAlert({
          target: { kind: "panelOrder", id, title: orderTitle(ctx.prevOrder) },
          prev: prev ? [prev] : [],
          next: person ? [person] : [],
          actor,
          watchers: ctx.prevOrder.watchers,
        });
      }
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update the engineer — reverted.");
    },
    onSettled: () => invalidatePanelOrders(qc),
  });
}

export function useSetPanelOrderWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) =>
      setPanelOrderWatchers(id, people),
    onMutate: ({ id, people }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelOrder(id, (o) => ({ ...o, watchers: people, modifiedAt: new Date() })),
      ),
    onSuccess: (_data, { id }, ctx) => {
      const prev = ctx?.prevOrder?.watchers ?? [];
      pushToast({
        message: "Watchers updated.",
        undo: buildUndo(qc, ctx?.previous, () => setPanelOrderWatchers(id, prev)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update watchers — reverted.");
    },
    onSettled: () => invalidatePanelOrders(qc),
  });
}

export function useWatchPanelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) => watchPanelOrder(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelOrder(id, (o) => {
          const key = (person.email ?? person.displayName).toLowerCase();
          const has = o.watchers.some((p) => (p.email ?? p.displayName).toLowerCase() === key);
          return has ? o : { ...o, watchers: [...o.watchers, person], modifiedAt: new Date() };
        }),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      pushToast({
        message: "You're now watching this panel order.",
        undo: buildUndo(qc, ctx?.previous, () => unwatchPanelOrder(id, person)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't start watching — reverted.");
    },
    onSettled: () => invalidatePanelOrders(qc),
  });
}

export function useUnwatchPanelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) => unwatchPanelOrder(id, person),
    onMutate: ({ id, person }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelOrder(id, (o) => {
          const key = (person.email ?? person.displayName).toLowerCase();
          return {
            ...o,
            watchers: o.watchers.filter((p) => (p.email ?? p.displayName).toLowerCase() !== key),
            modifiedAt: new Date(),
          };
        }),
      ),
    onSuccess: (_data, { id, person }, ctx) => {
      pushToast({
        message: "Stopped watching.",
        undo: buildUndo(qc, ctx?.previous, () => watchPanelOrder(id, person)),
      });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't stop watching — reverted.");
    },
    onSettled: () => invalidatePanelOrders(qc),
  });
}

export function useAddPanelOrderComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addPanelOrderComment(id, comment),
    onMutate: ({ id, comment }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelOrder(id, (o) => ({
          ...o,
          comments: [
            {
              timestamp: new Date(),
              authorName: comment.authorName,
              authorEmail: comment.authorEmail,
              bodyHtml: comment.bodyHtml,
              attachments: [],
            },
            ...o.comments,
          ],
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id, comment }) => {
      pushToast({ message: "Comment posted." });

      const orders = qc.getQueryData<PanelOrder[]>(PANEL_ORDERS_KEY);
      const order = orders?.find((o) => o.id === id);
      if (!order) return;

      const sender: Person = { displayName: comment.authorName, email: comment.authorEmail };
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: order.watchers,
        authorEmail: comment.authorEmail,
      });
      if (recipients.length > 0) {
        void notifyMentions({
          recipients,
          sender,
          target: { kind: "panelOrder", id: order.id, title: orderTitle(order) },
          commentExcerpt: htmlToPlainText(comment.bodyHtml),
          attachments: [],
        });
      }

      const mentioned = extractMentionedRecipients(comment.bodyHtml);
      if (mentioned.length === 0) return;
      void autoWatchFromMentions({
        recipients: mentioned,
        currentWatchers: order.watchers,
        directory: orders ? collectPeopleFromPanelOrders(orders) : [],
      })
        .then((additions) => applyPanelWatcherAdditions(qc, id, order.watchers, additions))
        .catch((err) => {
          console.error("Auto-watch failed for panel order comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't post comment — please retry.");
    },
    onSettled: () => invalidatePanelOrders(qc),
  });
}

/**
 * Apply auto-watch additions optimistically — watcher chips + toast show
 * immediately, the SharePoint write happens in the background (re-patching
 * the cache after it lands in case a refetch overwrote the optimistic
 * version). On failure: error toast + refetch so the UI doesn't lie.
 */
async function applyPanelWatcherAdditions(
  qc: QueryClient,
  id: number,
  currentWatchers: Person[],
  additions: Person[],
): Promise<void> {
  if (additions.length === 0) return;
  const next = [...currentWatchers, ...additions];
  const patch = () =>
    qc.setQueryData<PanelOrder[]>(PANEL_ORDERS_KEY, (old) =>
      old?.map((o) => (o.id === id ? { ...o, watchers: next } : o)),
    );
  patch();
  pushToast({
    message:
      additions.length === 1
        ? `${additions[0].displayName} is now watching this panel order.`
        : `${additions.length} people are now watching this panel order.`,
  });
  try {
    await setPanelOrderWatchers(id, next);
    patch();
  } catch (err) {
    console.error("Couldn't save auto-watch additions:", err);
    errorToast("Couldn't add the mentioned person as a watcher — refreshing.");
    invalidatePanelOrders(qc);
  }
}

async function autoWatchFromMentions({
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
      // Cold start: mentioned someone who's never been an engineer/watcher
      // on any panel order — resolve their panel site lookupId on demand.
      const lookupId = USE_MOCK
        ? mockLookupIdForEmail(r.email)
        : await resolvePanelSiteUserLookupId(r.email);
      if (!lookupId) continue;
      resolved = { displayName: r.displayName, email: r.email, lookupId };
    }
    additions.push(resolved);
    alreadyWatching.add(key);
  }
  return additions;
}

/** Flatten every Person across the panel order list, deduped by email/displayName. */
function collectPeopleFromPanelOrders(orders: PanelOrder[]): Person[] {
  const map = new Map<string, Person>();
  for (const o of orders) {
    const people = o.engineerAssigned ? [o.engineerAssigned, ...o.watchers] : o.watchers;
    for (const p of people) {
      const key = (p.email ?? p.displayName).toLowerCase();
      if (!map.has(key) && p.lookupId) map.set(key, p);
    }
  }
  return [...map.values()];
}

export function useEditPanelOrderComment() {
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
    }) => editPanelOrderComment(id, target, newBodyHtml),
    onMutate: ({ id, target, newBodyHtml }) =>
      snapshotAndPatch(
        qc,
        id,
        patchPanelOrder(id, (o) => ({
          ...o,
          comments: o.comments.map((c) =>
            c.timestamp.getTime() === target.timestamp.getTime() &&
            (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase()
              ? { ...c, bodyHtml: newBodyHtml }
              : c,
          ),
          modifiedAt: new Date(),
        })),
      ),
    onSuccess: (_data, { id, target, newBodyHtml, renotify }, ctx) => {
      const prevComment = ctx?.prevOrder?.comments.find(
        (c) =>
          c.timestamp.getTime() === target.timestamp.getTime() &&
          (c.authorEmail ?? "").toLowerCase() === target.authorEmail.toLowerCase(),
      );
      const prevBody = prevComment?.bodyHtml;
      pushToast({
        message: "Comment updated.",
        undo:
          prevBody !== undefined
            ? buildUndo(qc, ctx?.previous, () => editPanelOrderComment(id, target, prevBody))
            : undefined,
      });
      if (!prevComment) return;
      const order = qc.getQueryData<PanelOrder[]>(PANEL_ORDERS_KEY)?.find((o) => o.id === id);
      if (!order) return;
      const sender: Person = {
        displayName: prevComment.authorName,
        email: prevComment.authorEmail,
      };

      if (renotify) {
        const recipients = commentRenotifyRecipients({
          bodyHtml: newBodyHtml,
          previousBodyHtml: prevBody,
          watchers: order.watchers,
          authorEmail: prevComment.authorEmail,
        });
        if (recipients.length > 0) {
          void notifyMentions({
            recipients,
            sender,
            target: { kind: "panelOrder", id: order.id, title: orderTitle(order) },
            commentExcerpt: htmlToPlainText(newBodyHtml),
            attachments: [],
          });
        }
      } else {
        const prevMentions = new Set(
          prevBody ? extractMentionedRecipients(prevBody).map((r) => r.email.toLowerCase()) : [],
        );
        const newMentions = extractMentionedRecipients(newBodyHtml).filter(
          (r) => !prevMentions.has(r.email.toLowerCase()),
        );
        if (newMentions.length > 0) {
          void notifyMentions({
            recipients: newMentions.map((m) => ({ ...m, reason: "mentioned" as const })),
            sender,
            target: { kind: "panelOrder", id: order.id, title: orderTitle(order) },
            commentExcerpt: htmlToPlainText(newBodyHtml),
            attachments: [],
          });
        }
      }

      // Auto-watch: anyone @-mentioned in the edited body becomes a watcher
      // (unless already watching) — same rule as posting a new comment.
      const mentioned = extractMentionedRecipients(newBodyHtml);
      if (mentioned.length === 0) return;
      const allOrders = qc.getQueryData<PanelOrder[]>(PANEL_ORDERS_KEY);
      void autoWatchFromMentions({
        recipients: mentioned,
        currentWatchers: order.watchers,
        directory: allOrders ? collectPeopleFromPanelOrders(allOrders) : [],
      })
        .then((additions) => applyPanelWatcherAdditions(qc, id, order.watchers, additions))
        .catch((err) => {
          console.error("Auto-watch failed for edited panel order comment:", err);
        });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't save comment — reverted.");
    },
    onSettled: () => invalidatePanelOrders(qc),
  });
}

export function useCreatePanelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPanelOrder,
    onSuccess: (order) => {
      pushToast({ message: `Created panel order "${order.title}".` });
      // Seed the cache immediately — navigating straight to the new order's
      // detail page otherwise briefly shows "not found" against a stale list
      // (same fix as useCreateTask / useCreateOperationsTask).
      qc.setQueryData<PanelOrder[]>(PANEL_ORDERS_KEY, (old) =>
        old ? [order, ...old] : [order],
      );
      invalidatePanelOrders(qc);
    },
    onError: () => errorToast("Couldn't create panel order — please retry."),
  });
}

// =============================================================================
// Panel Projects (admin CRUD)
// =============================================================================

export function useCreatePanelProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPanelProject,
    // Optimistic: show the new row immediately under a temporary negative id;
    // the settled refetch swaps in the server-assigned id.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: PANEL_PROJECTS_KEY });
      const previous = qc.getQueryData<PanelProject[]>(PANEL_PROJECTS_KEY);
      const temp: PanelProject = { ...input, id: -Date.now() };
      qc.setQueryData<PanelProject[]>(PANEL_PROJECTS_KEY, (old) =>
        old ? [...old, temp] : [temp],
      );
      return { previous };
    },
    onSuccess: (project) => {
      pushToast({ message: `Created panel project "${project.title}".` });
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PANEL_PROJECTS_KEY, ctx.previous);
      errorToast("Couldn't create the project — please retry.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_PROJECTS_KEY }),
  });
}

export function useUpdatePanelProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: Omit<PanelProject, "id"> }) =>
      updatePanelProject(id, input),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: PANEL_PROJECTS_KEY });
      const previous = qc.getQueryData<PanelProject[]>(PANEL_PROJECTS_KEY);
      qc.setQueryData<PanelProject[]>(PANEL_PROJECTS_KEY, (old) =>
        old?.map((p) => (p.id === id ? { ...input, id } : p)),
      );
      return { previous };
    },
    onSuccess: (project) => {
      pushToast({ message: `Updated panel project "${project.title}".` });
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PANEL_PROJECTS_KEY, ctx.previous);
      errorToast("Couldn't update the project — reverted.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_PROJECTS_KEY }),
  });
}

// =============================================================================
// Local helpers
// =============================================================================

function applyFieldsLocally(o: PanelOrder, fields: Record<string, unknown>): PanelOrder {
  const next = { ...o };
  if ("Title" in fields) next.title = fields.Title as string;
  if ("Status" in fields) next.status = fields.Status as PanelOrder["status"];
  if ("SalesOrder" in fields) next.salesOrder = (fields.SalesOrder as string) ?? "";
  if ("PurchaseOrder" in fields) next.purchaseOrder = (fields.PurchaseOrder as string) ?? "";
  if ("CustomerReference" in fields)
    next.customerReference = (fields.CustomerReference as string) ?? "";
  if ("Customer" in fields) next.customer = (fields.Customer as string) ?? "";
  if ("CustomerContactEmail" in fields)
    next.customerContactEmail = (fields.CustomerContactEmail as string) ?? "";
  if ("OrderNotes" in fields) next.orderNotes = (fields.OrderNotes as string) ?? "";
  next.modifiedAt = new Date();
  return next;
}

function messageForFieldsUpdate(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).filter((k) => !k.endsWith("@odata.type"));
  if (keys.length === 1) {
    switch (keys[0]) {
      case "Title":
        return "Title updated.";
      case "Status":
        return "Status updated.";
      case "SalesOrder":
        return "Sales order updated.";
      case "PurchaseOrder":
        return "Purchase order updated.";
      case "CustomerReference":
        return "Customer reference updated.";
      case "Customer":
        return "Customer updated.";
      case "CustomerContactEmail":
        return "Customer contact updated.";
      case "OrderNotes":
        return "Order notes updated.";
      default:
        return "Panel order updated.";
    }
  }
  return "Panel order updated.";
}

/**
 * Strip HTML to plain text for the email-notification body. Each department
 * keeps its own copy rather than a shared abstraction (existing convention —
 * see the identical helper in useTasks.ts / useOperationsTasks.ts).
 */
function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
