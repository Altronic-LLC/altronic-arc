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
      const actor = actorRef.current;
      const { patch, snapshot } = worksheetSnapshot({
        rev,
        rows,
        pricing,
        note: note.trim() || worksheet.history.find((h) => h.rev === rev)?.note || "",
        savedBy: { displayName: actor.displayName, email: actor.email ?? "" },
        savedAt: new Date().toISOString(),
      });
      return saveNewProductWorksheet(worksheet.id, patch, snapshot);
    },
    onSuccess: (saved, vars) => {
      upsert(qc, saved);
      pushToast({
        message: vars.asNewRevision ? `Saved ${saved.worksheetNumber} R${saved.rev}.` : `Saved ${saved.worksheetNumber}.`,
      });
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
