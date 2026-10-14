import { useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createNewProductWorksheet,
  getNewProductWorksheet,
  listNewProductWorksheets,
  saveNewProductWorksheet,
  updateNewProductWorksheet,
  type NewProductCreateInput,
} from "@/api/newProductPricing";
import { listSubAssemblies, saveRevisionRows, type SubAssemblyDraft } from "@/api/newProductSubAssemblies";
import {
  addWorksheetComment,
  editWorksheetComment,
  setWorksheetWatchers,
  type WorksheetCommentInput,
} from "@/api/newProductPricing";
import { copyAttachments } from "@/api/attachments";
import { resolveSalesTeamSiteUserLookupId } from "@/api/pricingRequests";
import { notifyMentions } from "@/api/email";
import type { Person } from "@/types/task";
import { mergePeople } from "@/lib/people";
import { commentNotifyRecipients, newlyMentionedHtml } from "@/lib/mentions";
import { htmlToPlainText } from "@/lib/htmlText";
import { afterMentionAutoWatch, beginMentionAutoWatch, type MentionAutoWatch } from "./mentionAutoWatch";
import { newlyMentionedRecipients } from "./useQuotes";
import type { NewProductRevision, NewProductWorksheet, PriceInput, PriceBreakTier, SubAssembly } from "@/types/pricing";
import type { NewProductPatch } from "@/lib/pricingMapper";
import { priceGate } from "@/lib/pricingRoles";
import {
  priceBreaks,
  priceBreaksProblem,
  priceFromInput,
  subAssemblyTotals,
  worksheetCost,
} from "@/lib/pricingMath";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { useCurrentUser } from "./useCurrentUser";
import { requirePricingGate, useResolvePricingAccess } from "./usePricingRoles";
import { PRICING_SITE_LABEL } from "./usePricingRequests";

// =============================================================================
// New Product Pricing — worksheet hooks. Managers and admins only: every
// write asks `priceGate` inside its mutationFn.
//
// A save writes THREE things, in this order:
//   1. the revision's sub-assembly rows (api/newProductSubAssemblies.ts);
//   2. the worksheet's working columns and its revision snapshot, worked out
//      from the rows as SAVED — so the history can't disagree with the lines.
// "Save as new revision" writes step 1 for rev + 1 (fresh rows; the previous
// revision's rows are untouched) and needs a note saying what changed.
// =============================================================================

export const WORKSHEETS_KEY = ["np-worksheets", "list"] as const;
export const subAssembliesKey = (worksheetId: number) => ["np-subassemblies", worksheetId] as const;

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

export function useNewProductWorksheets(enabled = true) {
  return useQuery<NewProductWorksheet[]>({
    queryKey: WORKSHEETS_KEY,
    queryFn: listNewProductWorksheets,
    staleTime: 60_000,
    enabled,
  });
}

export function useNewProductWorksheet(id: number | null) {
  const { data: worksheets = [], ...rest } = useNewProductWorksheets();
  return { ...rest, data: id === null ? undefined : worksheets.find((w) => w.id === id) };
}

/** Every sub-assembly row of a worksheet, all revisions. */
export function useSubAssemblies(worksheetId: number | null) {
  return useQuery<SubAssembly[]>({
    queryKey: subAssembliesKey(worksheetId ?? 0),
    queryFn: () => listSubAssemblies(worksheetId!),
    enabled: worksheetId !== null,
    staleTime: 60_000,
  });
}

function upsert(qc: QueryClient, row: NewProductWorksheet) {
  qc.setQueryData<NewProductWorksheet[]>(WORKSHEETS_KEY, (old) => {
    if (!old) return [row];
    return old.some((w) => w.id === row.id) ? old.map((w) => (w.id === row.id ? row : w)) : [row, ...old];
  });
}

function useActorRef() {
  const actor = useCurrentUser();
  const ref = useRef(actor);
  ref.current = actor;
  return ref;
}

export type NewWorksheetInput = Omit<NewProductCreateInput, "createdBy">;

export function useCreateNewProductWorksheet() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  const actorRef = useActorRef();
  return useMutation({
    mutationFn: async (input: NewWorksheetInput) => {
      requirePricingGate(priceGate(await resolve()));
      return createNewProductWorksheet({ ...input, createdBy: actorRef.current });
    },
    onSuccess: (created) => {
      upsert(qc, created);
      void qc.invalidateQueries({ queryKey: WORKSHEETS_KEY });
      pushToast({ message: `Started ${created.worksheetNumber}.` });
    },
    onError: (err: unknown) =>
      errorToast(describeListWriteFailure(err, { action: "start the worksheet", site: PRICING_SITE_LABEL, permission: "creating items" })),
  });
}

/** The pricing half of a save — what the manager typed. */
export interface WorksheetPricingInput {
  overheadPct: number;
  mpg: string;
  distributorDiscountPct: number;
  discountSource: NewProductRevision["discountSource"];
  input: PriceInput | null;
  priceBreaks: PriceBreakTier[];
  productName?: string;
  description?: string;
  customerSoldTo?: string;
  customerName?: string;
  expectedAnnualVolume?: number | null;
}

export interface SaveWorksheetVars {
  worksheet: NewProductWorksheet;
  drafts: SubAssemblyDraft[];
  pricing: WorksheetPricingInput;
  asNewRevision: boolean;
  /** What changed — REQUIRED for a new revision. */
  note: string;
}

/**
 * The worksheet's columns and its revision snapshot, from the sub-assemblies
 * AS SAVED. Pure, so the save and its test agree on every figure.
 */
export function worksheetSnapshot(args: {
  rev: number;
  rows: SubAssembly[];
  pricing: WorksheetPricingInput;
  note: string;
  savedBy: { displayName: string; email: string };
  savedAt: string;
}): { patch: NewProductPatch; snapshot: NewProductRevision } {
  const cost = worksheetCost(args.rows, args.pricing.overheadPct);
  const result = priceFromInput({
    cost: cost.unit.used,
    distributorDiscountPct: args.pricing.distributorDiscountPct,
    input: args.pricing.input,
    customerDiscountPct: null,
  });
  const breaks = priceBreaks(result.listPrice, cost.unit.used, args.pricing.distributorDiscountPct, args.pricing.priceBreaks);
  const patch: NewProductPatch = {
    overheadPct: args.pricing.overheadPct,
    mpg: args.pricing.mpg,
    distributorDiscountPct: args.pricing.distributorDiscountPct,
    discountSource: args.pricing.discountSource,
    targetGM: args.pricing.input?.kind === "gm" ? args.pricing.input.value : null,
    unitCost: cost.unit.used,
    listPrice: result.listPrice,
    baseGM: result.baseGM,
    priceBreaks: args.pricing.priceBreaks,
    ...(args.pricing.productName !== undefined && { productName: args.pricing.productName }),
    ...(args.pricing.description !== undefined && { description: args.pricing.description }),
    ...(args.pricing.customerSoldTo !== undefined && { customerSoldTo: args.pricing.customerSoldTo }),
    ...(args.pricing.customerName !== undefined && { customerName: args.pricing.customerName }),
    ...(args.pricing.expectedAnnualVolume !== undefined && { expectedAnnualVolume: args.pricing.expectedAnnualVolume }),
  };
  const snapshot: NewProductRevision = {
    rev: args.rev,
    savedAt: args.savedAt,
    savedBy: args.savedBy,
    note: args.note,
    subAssemblies: subAssemblyTotals(args.rows),
    overheadPct: args.pricing.overheadPct,
    uploadedUnitCost: cost.unit.uploaded,
    unitCost: cost.unit.used,
    mpg: args.pricing.mpg,
    distributorDiscountPct: args.pricing.distributorDiscountPct,
    discountSource: args.pricing.discountSource,
    input: args.pricing.input,
    listPrice: result.listPrice,
    baseGM: result.baseGM,
    priceBreaks: breaks,
  };
  return { patch, snapshot };
}

export function useSaveNewProductWorksheet() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  const actorRef = useActorRef();
  return useMutation({
    mutationFn: async ({ worksheet, drafts, pricing, asNewRevision, note }: SaveWorksheetVars) => {
      requirePricingGate(priceGate(await resolve()));
      if (worksheet.status === "Cancelled") throw new Error(`${worksheet.worksheetNumber} is cancelled.`);
      if (asNewRevision && !note.trim()) throw new Error("Say what changed in this revision.");
      const breakProblem = priceBreaksProblem(pricing.priceBreaks);
      if (breakProblem) throw new Error(breakProblem);
      // Make sure the worksheet hasn't moved on since this screen loaded it.
      const fresh = await getNewProductWorksheet(worksheet.id);
      if (!fresh) throw new Error(`${worksheet.worksheetNumber} no longer exists.`);
      if (fresh.rev !== worksheet.rev) {
        throw new Error(`Someone saved R${fresh.rev} of ${worksheet.worksheetNumber} since you opened it — reload before saving.`);
      }
      const rev = asNewRevision ? worksheet.rev + 1 : worksheet.rev;
      // A new revision gets FRESH rows — never reuse the previous revision's.
      const rows = await saveRevisionRows(
        worksheet.id,
        rev,
        asNewRevision ? drafts.map((d) => ({ ...d, id: null })) : drafts,
      );
      // Each sub-assembly's files go with it onto its fresh row. Best-effort,
      // per file: the revision is saved by now, so a failed copy is a WARNING
      // naming what to re-attach, never a failed save.
      const warnings: string[] = [];
      if (asNewRevision) {
        const fresh = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
        for (const [i, d] of drafts.entries()) {
          if (d.id === null || !fresh[i]) continue;
          try {
            const { failed } = await copyAttachments("npSubAssembly", d.id, "npSubAssembly", fresh[i].id);
            if (failed.length) warnings.push(`${d.name || "A sub-assembly"}: ${failed.join(", ")}`);
          } catch {
            warnings.push(`${d.name || "A sub-assembly"}: its files`);
          }
        }
      }
      const actor = actorRef.current;
      const { patch, snapshot } = worksheetSnapshot({
        rev,
        rows,
        pricing,
        note: note.trim() || worksheet.history.find((h) => h.rev === rev)?.note || "",
        savedBy: { displayName: actor.displayName, email: actor.email ?? "" },
        savedAt: new Date().toISOString(),
      });
      const saved = await saveNewProductWorksheet(worksheet.id, patch, snapshot);
      return { saved, warnings };
    },
    onSuccess: ({ saved, warnings }, vars) => {
      upsert(qc, saved);
      pushToast({
        message: vars.asNewRevision ? `Saved ${saved.worksheetNumber} R${saved.rev}.` : `Saved ${saved.worksheetNumber}.`,
      });
      if (warnings.length) {
        errorToast(`R${saved.rev} is saved, but these files didn't copy across — attach them again: ${warnings.join("; ")}.`);
      }
    },
    onError: (err: unknown) =>
      errorToast(describeListWriteFailure(err, { action: "save the worksheet", site: PRICING_SITE_LABEL, permission: "editing" })),
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: WORKSHEETS_KEY });
      void qc.invalidateQueries({ queryKey: subAssembliesKey(vars.worksheet.id) });
    },
  });
}

/** A write that records no revision — Cancel, or the remembered Compare to SAP part numbers. */
export function useUpdateNewProductWorksheet() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: NewProductPatch }) => {
      requirePricingGate(priceGate(await resolve()));
      return updateNewProductWorksheet(id, patch);
    },
    onSuccess: (saved) => upsert(qc, saved),
    onError: (err: unknown) =>
      errorToast(describeListWriteFailure(err, { action: "save that change", site: PRICING_SITE_LABEL, permission: "editing" })),
    onSettled: () => qc.invalidateQueries({ queryKey: WORKSHEETS_KEY }),
  });
}

// -----------------------------------------------------------------------------
// The worksheet's watchers and discussion (Ray, 2026-10-13) — managers and
// admins only, like everything on a worksheet. Watchers + @-mentions are
// emailed; a mention becomes a watcher when Post is pressed (Sales site).
// -----------------------------------------------------------------------------

function patchWorksheet(qc: QueryClient, id: number, update: (w: NewProductWorksheet) => NewProductWorksheet) {
  qc.setQueryData<NewProductWorksheet[]>(WORKSHEETS_KEY, (old) => old?.map((w) => (w.id === id ? update(w) : w)));
}

export function collectWorksheetPeople(worksheets: NewProductWorksheet[]): Person[] {
  return mergePeople(...worksheets.map((w) => [...w.watchers, ...(w.createdBy ? [w.createdBy] : [])]));
}

export function useSetWorksheetWatchers() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async ({ id, people }: { id: number; people: Person[] }) => {
      requirePricingGate(priceGate(await resolve()));
      return setWorksheetWatchers(id, people);
    },
    onMutate: async ({ id, people }) => {
      await qc.cancelQueries({ queryKey: WORKSHEETS_KEY });
      const previous = qc.getQueryData<NewProductWorksheet[]>(WORKSHEETS_KEY);
      patchWorksheet(qc, id, (w) => ({ ...w, watchers: people }));
      return { previous };
    },
    onSuccess: (saved) => upsert(qc, saved),
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(WORKSHEETS_KEY, ctx.previous);
      errorToast(describeListWriteFailure(err, { action: "update the watchers", site: PRICING_SITE_LABEL, permission: "editing" }));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: WORKSHEETS_KEY }),
  });
}

function beginWorksheetMentionAutoWatch(qc: QueryClient, id: number, bodyHtml: string): MentionAutoWatch | null {
  const ws = qc.getQueryData<NewProductWorksheet[]>(WORKSHEETS_KEY)?.find((w) => w.id === id);
  if (!ws || !bodyHtml) return null;
  return beginMentionAutoWatch({
    bodyHtml,
    currentWatchers: ws.watchers,
    directory: () => collectWorksheetPeople(qc.getQueryData<NewProductWorksheet[]>(WORKSHEETS_KEY) ?? []),
    resolveLookupId: resolveSalesTeamSiteUserLookupId,
    patch: (watchers) => patchWorksheet(qc, id, (w) => ({ ...w, watchers })),
    write: (watchers) => setWorksheetWatchers(id, watchers),
    onWriteFailed: () => void qc.invalidateQueries({ queryKey: WORKSHEETS_KEY }),
    noun: "worksheet",
  });
}

/** Call `mutateAsync` and RETURN its promise from the composer, so a failed comment is restored. */
export function useAddWorksheetComment() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async ({ id, comment }: { id: number; comment: WorksheetCommentInput }) => {
      requirePricingGate(priceGate(await resolve()));
      return addWorksheetComment(id, comment);
    },
    onMutate: async ({ id, comment }) => {
      await qc.cancelQueries({ queryKey: WORKSHEETS_KEY });
      const previous = qc.getQueryData<NewProductWorksheet[]>(WORKSHEETS_KEY);
      patchWorksheet(qc, id, (w) => ({ ...w, comments: [{ ...comment, timestamp: new Date(), attachments: [] }, ...w.comments] }));
      return { previous, autoWatch: beginWorksheetMentionAutoWatch(qc, id, comment.bodyHtml) };
    },
    onSuccess: (_d, { id, comment }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment posted." });
      const ws = qc.getQueryData<NewProductWorksheet[]>(WORKSHEETS_KEY)?.find((w) => w.id === id);
      if (!ws) return;
      const recipients = commentNotifyRecipients({
        bodyHtml: comment.bodyHtml,
        watchers: ws.watchers,
        assignees: [],
        authorEmail: comment.authorEmail,
      });
      if (recipients.length === 0) return;
      void notifyMentions({
        recipients,
        sender: { displayName: comment.authorName, email: comment.authorEmail },
        target: { kind: "newProductPricing", id: ws.id, title: `${ws.worksheetNumber} — ${ws.productName}` },
        commentExcerpt: htmlToPlainText(comment.bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      if (ctx?.previous) qc.setQueryData(WORKSHEETS_KEY, ctx.previous);
      errorToast("Couldn't post comment — it's back in the comment box to send again.");
    },
    onSettled: (_d, _e, _v, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => {
        void qc.invalidateQueries({ queryKey: WORKSHEETS_KEY });
      }),
  });
}

export function useEditWorksheetComment() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async (vars: { id: number; target: { timestamp: Date; authorEmail: string }; bodyHtml: string; previousBodyHtml: string }) => {
      requirePricingGate(priceGate(await resolve()));
      return editWorksheetComment(vars.id, vars.target, vars.bodyHtml);
    },
    onMutate: async ({ id, bodyHtml, previousBodyHtml }) => {
      const newMentions = newlyMentionedHtml(previousBodyHtml, bodyHtml);
      if (newMentions) await qc.cancelQueries({ queryKey: WORKSHEETS_KEY });
      return { autoWatch: beginWorksheetMentionAutoWatch(qc, id, newMentions) };
    },
    onSuccess: (saved, { target, bodyHtml, previousBodyHtml }, ctx) => {
      ctx?.autoWatch?.commit();
      pushToast({ message: "Comment updated." });
      const added = newlyMentionedRecipients(previousBodyHtml, bodyHtml);
      if (added.length === 0) return;
      void notifyMentions({
        recipients: added,
        sender: { displayName: "", email: target.authorEmail },
        target: { kind: "newProductPricing", id: saved.id, title: `${saved.worksheetNumber} — ${saved.productName}` },
        commentExcerpt: htmlToPlainText(bodyHtml),
        attachments: [],
      });
    },
    onError: (_err, _vars, ctx) => {
      ctx?.autoWatch?.cancel();
      errorToast("Couldn't update the comment — please retry.");
    },
    onSettled: (_d, _e, _v, ctx) =>
      afterMentionAutoWatch(ctx?.autoWatch, () => {
        void qc.invalidateQueries({ queryKey: WORKSHEETS_KEY });
      }),
  });
}