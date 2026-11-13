import { useEffect, useState } from "react";
import { keepPreviousData, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isPricingDataNotConnected,
  isRetryableSapCostFailure,
  listFamilyParts,
  lookupSapMaterialCosts,
  listMpgParts,
  lookupSapPart,
  sapCustomerGroupDiscounts,
  sapMpgDistributorDiscounts,
  searchSapCustomers,
  warmSapCostLookup,
} from "@/api/pricingLookup";
import { sapMaterialLookupKey } from "@/lib/sapMaterialCost";
import { lookupArgsFor } from "@/lib/sapPartFill";
import type { SapCustomer, SapMaterialCost, SapPart } from "@/types/pricing";
import {
  buildComparablesPanel,
  comparisonFigures,
  resolveCustomerDiscount,
  type ComparablesPanel,
  type ComparisonFigures,
} from "@/lib/pricingMath";

// =============================================================================
// Sales Pricing — the SAP facts, as queries. Every one of these can answer
// "not connected" (api/pricingLookup.ts) while the warehouse isn't wired;
// `notConnected` says so, and a screen falls back to manual entry instead of
// showing an error. Queries never retry a "not connected" — it won't change.
// =============================================================================

const STALE_MS = 5 * 60_000;

// Retry only a network blip or a server error, once. A refused token or query
// fails the same way every time, and retrying it twice is what made a failing
// lookup feel slow (Ray, 2026-10-17).
function retry(count: number, err: unknown) {
  return isRetryableSapCostFailure(err) && count < 1;
}

function connectionOf(q: { error: unknown }) {
  return { notConnected: isPricingDataNotConnected(q.error) };
}

/** The part as SAP has it, by SAP # or Altronic #. */
export function useSapPart(args: { altronicPartNumber: string; sapPartNumber: string }, enabled = true) {
  const key = [args.altronicPartNumber.trim().toLowerCase(), args.sapPartNumber.trim().toLowerCase()];
  const q = useQuery<SapPart | null>({
    queryKey: ["pricing-sap", "part", ...key],
    queryFn: () => lookupSapPart(args),
    enabled: enabled && (!!key[0] || !!key[1]),
    staleTime: STALE_MS,
    retry,
  });
  return { ...q, ...connectionOf(q) };
}

/**
 * A part looked up AS SOMEBODY TYPES (Ray, 2026-10-17; shared 2026-10-22) — an
 * SAP number the moment its 10th digit lands, anything else after a 400 ms
 * pause. Fabric is woken as the caller mounts, so the first lookup doesn't
 * also pay for the token and a cold endpoint. Used by the pricing request form
 * and by adding a component or a part to a worksheet.
 *
 * `enabled: false` asks nothing — a read-only row, or a saved part nobody has
 * retyped (looking that up on open would quietly re-cost a saved worksheet).
 * `asked` is the key the current answer belongs to.
 */
export function useSapPartAsYouType(altronicPartNumber: string, sapPartNumber: string, enabled = true) {
  const [asked, setAsked] = useState({ altronicPartNumber: "", sapPartNumber: "" });
  const found = useSapPart(asked, enabled);
  useEffect(() => {
    if (enabled) void warmSapCostLookup();
  }, [enabled]);
  const current = found.data;
  useEffect(() => {
    if (!enabled) return;
    // Filling in the numbers of the part just found isn't a new part: asking
    // again would blank the answer for a moment ("Looking it up…") for nothing.
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    if (current && same(altronicPartNumber, current.altronicPartNumber) && same(sapPartNumber, current.sapPartNumber)) return;
    const whole = sapMaterialLookupKey(sapPartNumber) !== null;
    const t = setTimeout(
      () => setAsked({ altronicPartNumber: altronicPartNumber.trim(), sapPartNumber: sapPartNumber.trim() }),
      whole ? 0 : 400,
    );
    return () => clearTimeout(t);
  }, [altronicPartNumber, sapPartNumber, enabled]);
  const askedAnything = !!(asked.altronicPartNumber || asked.sapPartNumber);
  return { ...found, asked, askedAnything };
}

export interface PastedPartResult {
  number: string;
  part: SapPart | null;
  /** SAP couldn't be asked about this one (not connected, refused, unreachable) — NOT the same as "not in SAP". */
  failed: boolean;
  /** Why, when `failed`. */
  error?: unknown;
}

/**
 * Look up several pasted numbers at once (Ray, 2026-10-22), in parallel, each
 * through the SAME cache entry `useSapPart` uses — a number already looked up
 * answers at once. One failure never stops the rest, and a failed number is
 * asked ONCE more after the batch (a cold endpoint or a blip under a burst of
 * lookups), so "couldn't check" means it really couldn't.
 */
export function useLookUpSapParts() {
  const qc = useQueryClient();
  const one = async (number: string): Promise<PastedPartResult> => {
    const args = lookupArgsFor(number);
    try {
      const part = await qc.fetchQuery<SapPart | null>({
        queryKey: ["pricing-sap", "part", args.altronicPartNumber.toLowerCase(), args.sapPartNumber.toLowerCase()],
        queryFn: () => lookupSapPart(args),
        staleTime: STALE_MS,
        retry,
      });
      return { number, part, failed: false };
    } catch (error) {
      return { number, part: null, failed: true, error };
    }
  };
  return async (numbers: string[]): Promise<PastedPartResult[]> => {
    const first = await Promise.all(numbers.map(one));
    const out: PastedPartResult[] = [];
    for (const r of first) {
      // A "not connected" answer won't change on a second ask.
      out.push(r.failed && !isPricingDataNotConnected(r.error) ? await one(r.number) : r);
    }
    return out;
  };
}

/**
 * A material's cost at each plant, by SAP number, from the Fabric cost view —
 * the Calculator's lookup. Retries only a network blip or a server error: a
 * refused token or query fails the same way every time.
 */
export function useSapMaterialCosts(partNumber: string, enabled = true) {
  const pn = partNumber.trim();
  const q = useQuery<SapMaterialCost[]>({
    queryKey: ["pricing-sap", "material-cost", pn.toUpperCase()],
    queryFn: () => lookupSapMaterialCosts(pn),
    enabled: enabled && pn !== "",
    staleTime: STALE_MS,
    retry: (count, err) => isRetryableSapCostFailure(err) && count < 1,
  });
  return { ...q, ...connectionOf(q) };
}

/** SAP customers as they type — by sold-to number or by name. */
export function useSapCustomerSearch(query: string, by: "number" | "name" = "name") {
  const trimmed = query.trim();
  const q = useQuery<SapCustomer[]>({
    queryKey: ["pricing-sap", "customers", by, trimmed.toLowerCase()],
    queryFn: () => searchSapCustomers(trimmed, by),
    enabled: trimmed.length >= 2,
    staleTime: STALE_MS,
    // The last matches stay up while the next search runs.
    placeholderData: keepPreviousData,
    retry,
  });
  return { ...q, ...connectionOf(q) };
}

/** SAP's standard distributor discount for one MPG — null when SAP has none. */
export function useMpgDistributorDiscount(mpg: string) {
  const q = useQuery<number | null>({
    queryKey: ["pricing-sap", "mpg-discount", mpg],
    queryFn: async () => (await sapMpgDistributorDiscounts([mpg]))[mpg] ?? null,
    enabled: !!mpg,
    staleTime: STALE_MS,
    retry,
  });
  return { ...q, ...connectionOf(q) };
}

/**
 * A customer's discount for one part, RESOLVED (Ray, 2026-10-15): their group's
 * discount on the material, else on its MPG, else the standard 34% — and 34%
 * with no customer. `discount` is null only while SAP is being asked, so a
 * field isn't seeded with 34% a moment before the group's real discount lands.
 * SAP not connected resolves to the default too, and `notConnected` says so.
 */
export function useCustomerDiscount(args: { customerGroup: string; sapPartNumber: string; mpg: string }) {
  const group = args.customerGroup.trim();
  const sap = args.sapPartNumber.trim();
  const mpg = args.mpg.trim();
  const asks = !!group && (!!sap || !!mpg);
  const q = useQuery<{ materialPct: number | null; mpgPct: number | null }>({
    queryKey: ["pricing-sap", "group-discounts", group, sap, mpg],
    queryFn: () => sapCustomerGroupDiscounts({ customerGroup: group, sapPartNumber: sap, mpg }),
    enabled: asks,
    staleTime: STALE_MS,
    retry,
  });
  const settled = !asks || q.isSuccess || q.isError;
  const discount = settled
    ? resolveCustomerDiscount({
        customerGroup: group,
        materialDiscountPct: q.data?.materialPct ?? null,
        mpgDiscountPct: q.data?.mpgPct ?? null,
      })
    : null;
  return { discount, isLoading: asks && q.isLoading, ...connectionOf(q) };
}

/**
 * One comparison panel — every part in the MPG, or in the six-digit family —
 * each measured at its own MPG's distributor discount.
 */
export function useComparables(
  kind: "mpg" | "family",
  key: string | null,
  subject: { altronicPartNumber: string; sapPartNumber: string },
  enabled = true,
) {
  const q = useQuery<ComparablesPanel>({
    queryKey: ["pricing-sap", "comparables", kind, key, subject.altronicPartNumber, subject.sapPartNumber],
    queryFn: async () => {
      const parts = kind === "mpg" ? await listMpgParts(key!) : await listFamilyParts(key!);
      const discounts = await sapMpgDistributorDiscounts([...new Set(parts.map((p) => p.mpg))]);
      return buildComparablesPanel(parts, discounts, subject);
    },
    enabled: enabled && !!key,
    staleTime: STALE_MS,
    retry,
  });
  return { ...q, ...connectionOf(q) };
}

export interface SapComparisonRow {
  /** What was asked for. */
  sapPartNumber: string;
  loading: boolean;
  /** null = SAP doesn't hold that number. */
  part: SapPart | null;
  figures: ComparisonFigures | null;
}

/**
 * A worksheet's reference parts as SAP has them now (Ray, 2026-10-14) — one
 * lookup per SAP number (the same cache entries `useSapPart` uses), then each
 * part's MPG discount in one read. Re-read every time: the worksheet keeps the
 * NUMBERS, never the figures, so the reference can't go stale.
 */
export function useSapComparison(sapPartNumbers: string[]) {
  const parts = useQueries({
    queries: sapPartNumbers.map((pn) => ({
      queryKey: ["pricing-sap", "part", "", pn.trim().toLowerCase()],
      queryFn: () => lookupSapPart({ altronicPartNumber: "", sapPartNumber: pn }),
      staleTime: STALE_MS,
      retry,
    })),
  });
  const mpgs = [...new Set(parts.map((q) => q.data?.mpg).filter((m): m is string => !!m))].sort();
  const discounts = useQuery<Record<string, number | null>>({
    queryKey: ["pricing-sap", "mpg-discounts", ...mpgs],
    queryFn: () => sapMpgDistributorDiscounts(mpgs),
    enabled: mpgs.length > 0,
    staleTime: STALE_MS,
    retry,
  });
  const rows: SapComparisonRow[] = sapPartNumbers.map((pn, i) => {
    const part = parts[i]?.data ?? null;
    const discountKnown = !part || !part.mpg || discounts.data !== undefined || discounts.isError;
    return {
      sapPartNumber: pn,
      loading: !!parts[i]?.isLoading || (!!part?.mpg && discounts.isLoading),
      part,
      figures: part && discountKnown ? comparisonFigures(part, part.mpg ? discounts.data?.[part.mpg] ?? null : null) : null,
    };
  });
  // The per-MPG discount table isn't in the warehouse yet, while the part, its
  // cost and its list price are (2026-10-22). A discount that isn't connected
  // is the standard 34% — the card footnotes it — not a reason to say SAP is.
  const notConnected = parts.some((q) => isPricingDataNotConnected(q.error));
  const failed =
    !notConnected && (parts.some((q) => q.isError) || (discounts.isError && !isPricingDataNotConnected(discounts.error)));
  return { rows, notConnected, failed };
}
