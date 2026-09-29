import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  approveAltronicPart,
  createAltronicPart,
  deleteAltronicPart,
  listAltronicParts,
  updateAltronicPart,
  type NewAltronicPart,
} from "@/api/altronicParts";
import {
  approveAltronicComponent,
  createAltronicComponent,
  deleteAltronicComponent,
  listAltronicComponents,
  updateAltronicComponent,
  type NewAltronicComponent,
} from "@/api/altronicComponents";
import { isDeletedPart } from "@/lib/partLifecycle";
import { notifyChangeEmails } from "@/api/email";
import type { AltronicComponent, AltronicPart, ItemAuthor, Person } from "@/types/task";
import type { ChangeEmail, ChangeTarget } from "@/lib/changeAlerts";
import { altronicPartLabel, isComponentPrefix, partPrefix } from "@/lib/altronicPartMapper";
import { COMPONENT_FIELDS, PART_FIELDS, describeChanges, opensNewList, type PartFieldSpec } from "@/lib/partFields";
import { appPageUrl } from "@/lib/appUrl";
import {
  addPartGate,
  approveGate,
  deletePartGate,
  editPartGate,
  sapResponseNeedsComment,
  type SapResponse,
} from "@/lib/partsRoles";
import {
  buildEngineeringApprovedEmails,
  buildNewComponentEmails,
  buildNewListRequestEmails,
  buildNewPartForSapEmails,
  buildPartEditedEmails,
  buildSapResponseEmails,
  formatCreatedAt,
} from "@/lib/partsAlerts";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { useCurrentUser } from "./useCurrentUser";
import { resolvePartsPeople, useResolvePartsAccess } from "./usePartsRoles";

// =============================================================================
// Altronic Parts List queries and writes.
//
// READS. The Part List is ~14,000 rows (about fifteen Graph pages), so it is
// held for a long time once fetched: parts change a few times a day, and
// paying for the whole list again every time somebody steps from the Parts
// Book into a list and back would make the screen feel broken. `gcTime` keeps
// it across that navigation; `staleTime` stops a refetch on every mount.
//
// WRITES (Tim, 2026-09-28). Three rules every one of them follows:
//  - The gate is asked INSIDE the mutationFn (lib/partsRoles.ts), awaiting the
//    roles list — the button being greyed out is not the enforcement.
//  - A write lands in the cache as the row SharePoint hands back, and the
//    list is NOT invalidated: invalidating would re-download 14,000 rows to
//    show one change.
//  - Email is best-effort, after the write: a failed send never makes a saved
//    part look unsaved. Recipients are read from the Parts Roles list at send
//    time, so a change on the admin screen reaches the very next email.
// =============================================================================

export const ALTRONIC_PARTS_KEY = ["altronicParts"] as const;
export const ALTRONIC_COMPONENTS_KEY = ["altronicComponents"] as const;

const STALE_MS = 10 * 60_000;
const GC_MS = 30 * 60_000;

const SITE = "Altronic_Engineering";

// DELETED part numbers (lib/partLifecycle.ts) stay in the lists as blanked
// rows so they can be reused. The ordinary hooks hand back LIVE parts only —
// one `select`, so every list, search, count and approval queue leaves them
// out without each screen remembering to. The detail page (a link to a
// deleted part must say so) and the New Part form (Next free reuses them)
// read everything, from the same cache.
const liveParts = (rows: AltronicPart[]) => rows.filter((p) => !isDeletedPart(p));
const liveComponents = (rows: AltronicComponent[]) => rows.filter((c) => !isDeletedPart(c));

export function useAltronicParts() {
  return useQuery({
    queryKey: ALTRONIC_PARTS_KEY,
    queryFn: listAltronicParts,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    select: liveParts,
  });
}

export function useAltronicComponents() {
  return useQuery({
    queryKey: ALTRONIC_COMPONENTS_KEY,
    queryFn: listAltronicComponents,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    select: liveComponents,
  });
}

/** Every Part List row, deleted numbers included. */
export function useAllAltronicParts() {
  return useQuery({ queryKey: ALTRONIC_PARTS_KEY, queryFn: listAltronicParts, staleTime: STALE_MS, gcTime: GC_MS });
}

/** Every Component List row, deleted numbers included. */
export function useAllAltronicComponents() {
  return useQuery({
    queryKey: ALTRONIC_COMPONENTS_KEY,
    queryFn: listAltronicComponents,
    staleTime: STALE_MS,
    gcTime: GC_MS,
  });
}

/** One part, from the cached list — deleted ones too. `undefined` while loading, `null` if absent. */
export function useAltronicPart(id: number) {
  const query = useAllAltronicParts();
  const part = useMemo<AltronicPart | null | undefined>(
    () => (query.data ? (query.data.find((p) => p.id === id) ?? null) : undefined),
    [query.data, id],
  );
  return { ...query, part };
}

/** One component, from the cached list — deleted ones too. `undefined` while loading, `null` if absent. */
export function useAltronicComponent(id: number) {
  const query = useAllAltronicComponents();
  const component = useMemo<AltronicComponent | null | undefined>(
    () => (query.data ? (query.data.find((c) => c.id === id) ?? null) : undefined),
    [query.data, id],
  );
  return { ...query, component };
}

// -----------------------------------------------------------------------------
// Cache helpers
// -----------------------------------------------------------------------------

type Row = { id: number };

function upsert<T extends Row>(qc: QueryClient, key: readonly unknown[], row: T) {
  qc.setQueryData<T[]>(key, (old) => {
    if (!old) return old;
    return old.some((r) => r.id === row.id) ? old.map((r) => (r.id === row.id ? row : r)) : [...old, row];
  });
}

function sendInBackground(target: ChangeTarget, build: () => Promise<ChangeEmail[]>) {
  void (async () => {
    try {
      const emails = await build();
      if (emails.length > 0) await notifyChangeEmails({ target, emails });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[parts] couldn't send the notification:", err);
    }
  })();
}

function partTarget(part: AltronicPart): ChangeTarget {
  return { kind: "altronicPart", id: part.id, title: altronicPartLabel(part) };
}
function componentTarget(c: AltronicComponent): ChangeTarget {
  return { kind: "altronicComponent", id: c.id, title: altronicPartLabel(c) };
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

export function useCreateAltronicPart() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  const resolveAccess = useResolvePartsAccess();
  return useMutation({
    mutationFn: async (input: NewAltronicPart) => {
      const prefix = partPrefix(input.partNumber) ?? "";
      if (isComponentPrefix(prefix)) {
        throw new Error(`${prefix} is an HCO component list — add it as a component.`);
      }
      // Starting a list is the SAP admin's (Tim, 2026-09-29). Asked against
      // the whole Part List, deleted numbers included — normally already
      // cached, since the form reads the same query.
      const rows = await qc.ensureQueryData({ queryKey: ALTRONIC_PARTS_KEY, queryFn: listAltronicParts, staleTime: STALE_MS });
      const newList = opensNewList(prefix, rows.map((r) => r.partNumber));
      const gate = addPartGate(await resolveAccess(), prefix, false, newList);
      if (!gate.allowed) throw new Error(gate.hint);
      return createAltronicPart(input, actor);
    },
    onSuccess: (created) => {
      upsert(qc, ALTRONIC_PARTS_KEY, created);
      sendInBackground(partTarget(created), async () =>
        buildNewPartForSapEmails({
          target: partTarget(created),
          partNumber: created.partNumber,
          description: created.description,
          recipients: await resolvePartsPeople(qc, "approveSap"),
          actor,
          // The old Power Automate email's lines, in its order (Tim, 2026-09-29).
          details: [
            { label: "Altronic Part Number", value: created.partNumber },
            { label: "Description", value: created.description },
            { label: "MFG Part Number", value: created.mfgPartNumber },
            { label: "Manufacturer", value: created.manufacturer },
            { label: "Drawing Size", value: created.drawingSize },
            { label: "Purchased", value: created.purchased ?? "" },
            { label: "Prototype or Production", value: created.prototypeOrProduction ?? "" },
            { label: "Note", value: created.notes },
            { label: "Assigned By", value: created.assignedBy },
            // Date-only columns are held at midday UTC, so the UTC date IS the day.
            { label: "Date Assigned", value: created.dateAssigned ? created.dateAssigned.toISOString().slice(0, 10) : "" },
            { label: "Date Created", value: formatCreatedAt(created.createdAt) },
          ],
        }),
      );
    },
  });
}

export function useCreateAltronicComponent() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  const resolveAccess = useResolvePartsAccess();
  return useMutation({
    mutationFn: async (input: NewAltronicComponent) => {
      const prefix = partPrefix(input.partNumber) ?? "";
      const gate = addPartGate(await resolveAccess(), prefix, true);
      if (!gate.allowed) throw new Error(gate.hint);
      return createAltronicComponent(input, actor);
    },
    onSuccess: (created) => {
      upsert(qc, ALTRONIC_COMPONENTS_KEY, created);
      sendInBackground(componentTarget(created), async () =>
        buildNewComponentEmails({
          target: componentTarget(created),
          recipients: await resolvePartsPeople(qc, "approveEngineering"),
          actor,
          details: [
            { label: "Description", value: created.description },
            { label: "Mfg Name", value: created.mfgName },
            { label: "Mfg Number", value: created.mfgNumber },
            { label: "Ratings", value: [created.ratingA, created.ratingB, created.ratingC].filter(Boolean).join(" / ") },
          ],
        }),
      );
    },
  });
}

// -----------------------------------------------------------------------------
// Asking for a new list — only the SAP admin opens one
// -----------------------------------------------------------------------------

export interface NewListRequest {
  prefix: string;
  partNumber: string;
  description: string;
}

/**
 * Email the SAP admins that somebody needs a parts list that doesn't exist
 * yet. Unlike the other part emails this one is AWAITED and throws when it
 * reaches nobody — the button's whole job is the send, so "sent" must mean
 * sent.
 */
export function useRequestNewPartsList() {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  return useMutation({
    mutationFn: async ({ prefix, partNumber, description }: NewListRequest) => {
      const emails = buildNewListRequestEmails({
        prefix,
        partNumber: partNumber.trim(),
        description: description.trim(),
        recipients: await resolvePartsPeople(qc, "approveSap"),
        actor,
      });
      if (emails.length === 0) {
        throw new Error("Nobody holds the SAP admin role on Parts Roles, so there's nobody to ask. Tell an ARC admin.");
      }
      const result = await notifyChangeEmails({
        target: { kind: "altronicPart", id: 0, title: `New list ${prefix} — ${prefix.charAt(0)}00 Parts Book` },
        emails,
        link: { url: appPageUrl(`/engineering/parts?book=${prefix.charAt(0)}`), buttonText: "Open the Parts Book" },
      });
      if (result.sent.length === 0) throw new Error("The email didn't send — try again, or ask the SAP admin directly.");
      return emails.map((e) => e.displayName);
    },
  });
}

// -----------------------------------------------------------------------------
// Edit — no re-approval, but the SAP admins hear what changed
// -----------------------------------------------------------------------------

interface EditVars<T> {
  id: number;
  patch: Partial<T>;
}

function useEdit<T extends Row>(opts: {
  key: readonly unknown[];
  component: boolean;
  specs: PartFieldSpec<T>[];
  update: (id: number, patch: Partial<T>) => Promise<T>;
  target: (row: T) => ChangeTarget;
}) {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  const resolveAccess = useResolvePartsAccess();
  return useMutation({
    mutationFn: async ({ id, patch }: EditVars<T>) => {
      const gate = editPartGate(await resolveAccess(), opts.component);
      if (!gate.allowed) throw new Error(gate.hint);
      return opts.update(id, patch);
    },
    // Optimistic: the card shows the new values at once; restored on error.
    onMutate: async ({ id, patch }) => {
      const previous = qc.getQueryData<T[]>(opts.key)?.find((r) => r.id === id);
      if (previous) upsert(qc, opts.key, { ...previous, ...patch });
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) upsert(qc, opts.key, ctx.previous);
      pushToast({
        message: describeListWriteFailure(err, { action: "save that change", site: SITE, permission: "editing" }),
        variant: "error",
      });
    },
    onSuccess: (updated, { patch }, ctx) => {
      upsert(qc, opts.key, updated);
      const before = ctx?.previous;
      if (!before) return;
      const changes = describeChanges(opts.specs, before, patch);
      if (changes.length === 0) return;
      sendInBackground(opts.target(updated), async () =>
        buildPartEditedEmails({
          target: opts.target(updated),
          recipients: await resolvePartsPeople(qc, "approveSap"),
          actor,
          changes,
        }),
      );
    },
  });
}

export function useUpdateAltronicPart() {
  return useEdit<AltronicPart>({
    key: ALTRONIC_PARTS_KEY,
    component: false,
    specs: PART_FIELDS,
    update: updateAltronicPart,
    target: partTarget,
  });
}

export function useUpdateAltronicComponent() {
  return useEdit<AltronicComponent>({
    key: ALTRONIC_COMPONENTS_KEY,
    component: true,
    specs: COMPONENT_FIELDS,
    update: updateAltronicComponent,
    target: componentTarget,
  });
}

// -----------------------------------------------------------------------------
// Approve
// -----------------------------------------------------------------------------

export interface ApproveVars {
  id: number;
  /** The status the approver SAW — refused if the row has moved since. */
  expected: string;
  comment: string;
  /** The SAP step's answer (lib/partsRoles.ts SAP_RESPONSES). Ignored at any other step. */
  response?: SapResponse | null;
}

function useApprove<T extends Row & { signOffStatus: string | null; createdBy: ItemAuthor | null }>(opts: {
  key: readonly unknown[];
  approve: (id: number, expected: string, comment: string, actor: Person, response: SapResponse | null) => Promise<T>;
  target: (row: T) => ChangeTarget;
}) {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  const resolveAccess = useResolvePartsAccess();
  return useMutation({
    mutationFn: async ({ id, expected, comment, response }: ApproveVars) => {
      const gate = approveGate(await resolveAccess(), expected);
      if (!gate.allowed) throw new Error(gate.hint || "This part isn't waiting on an approval.");
      const answer = expected === "Pending SAP" ? (response ?? null) : null;
      if (sapResponseNeedsComment(answer) && !comment.trim()) {
        throw new Error("Say what information is needed, so whoever added the part can supply it.");
      }
      return opts.approve(id, expected, comment, actor, answer);
    },
    onError: (err) => {
      pushToast({
        message: describeListWriteFailure(err, { action: "approve that part", site: SITE, permission: "editing" }),
        variant: "error",
      });
      // The row may have moved on under us — show where it actually is.
      void qc.invalidateQueries({ queryKey: opts.key });
    },
    onSuccess: (updated, { expected, comment, response }) => {
      upsert(qc, opts.key, updated);
      // The SAP admin answered — the person who added the part hears which.
      if (expected === "Pending SAP" && response) {
        sendInBackground(opts.target(updated), async () =>
          buildSapResponseEmails({ target: opts.target(updated), response, submitter: updated.createdBy, actor, comment }),
        );
      }
      // Engineering done → the SAP admins are next. Final approval tells
      // nobody new: the SAP admin IS the last step.
      if (updated.signOffStatus === "Pending SAP") {
        sendInBackground(opts.target(updated), async () =>
          buildEngineeringApprovedEmails({
            target: opts.target(updated),
            recipients: await resolvePartsPeople(qc, "approveSap"),
            actor,
            comment,
          }),
        );
      }
    },
  });
}

// -----------------------------------------------------------------------------
// Delete — the SAP admin's, and the number is reused (lib/partLifecycle.ts)
// -----------------------------------------------------------------------------

export interface DeleteVars {
  id: number;
  /** The number the SAP admin confirmed — refused if the row has changed. */
  partNumber: string;
  reason: string;
}

function useDelete<T extends Row>(opts: {
  key: readonly unknown[];
  remove: (id: number, partNumber: string, reason: string, actor: Person) => Promise<T>;
}) {
  const qc = useQueryClient();
  const actor = useCurrentUser();
  const resolveAccess = useResolvePartsAccess();
  return useMutation({
    mutationFn: async ({ id, partNumber, reason }: DeleteVars) => {
      const gate = deletePartGate(await resolveAccess());
      if (!gate.allowed) throw new Error(gate.hint);
      return opts.remove(id, partNumber, reason, actor);
    },
    onSuccess: (deleted, { partNumber }) => {
      // The blanked row goes back in the cache: the live hooks filter it out,
      // and Next free finds it.
      upsert(qc, opts.key, deleted);
      // Its datasheet was moved out of the folder.
      void qc.invalidateQueries({ queryKey: ["datasheet", partNumber.trim().toLowerCase()] });
    },
    onError: (err) => {
      pushToast({
        message: describeListWriteFailure(err, { action: "delete that part number", site: SITE, permission: "editing" }),
        variant: "error",
      });
      void qc.invalidateQueries({ queryKey: opts.key });
    },
  });
}

export function useDeleteAltronicPart() {
  return useDelete<AltronicPart>({ key: ALTRONIC_PARTS_KEY, remove: deleteAltronicPart });
}

export function useDeleteAltronicComponent() {
  return useDelete<AltronicComponent>({ key: ALTRONIC_COMPONENTS_KEY, remove: deleteAltronicComponent });
}

export function useApproveAltronicPart() {
  return useApprove<AltronicPart>({ key: ALTRONIC_PARTS_KEY, approve: approveAltronicPart, target: partTarget });
}

export function useApproveAltronicComponent() {
  return useApprove<AltronicComponent>({
    key: ALTRONIC_COMPONENTS_KEY,
    approve: approveAltronicComponent,
    target: componentTarget,
  });
}
