import { useQueries, useQuery } from "@tanstack/react-query";
import {
  isPricingDataNotConnected,
  listFamilyParts,
  listMpgParts,
  lookupSapPart,
  sapCustomerGroupDiscount,
  sapMpgDistributorDiscounts,
  searchSapCustomers,
} from "@/api/pricingLookup";
import type { SapCustomer, SapPart } from "@/types/pricing";
import { buildComparablesPanel, comparisonFigures, type ComparablesPanel, type ComparisonFigures } from "@/lib/pricingMath";

// =============================================================================
// Sales Pricing — the SAP facts, as queries. Every one of these can answer
// "not connected" (api/pricingLookup.ts) while the warehouse isn't wired;
// `notConnected` says so, and a screen falls back to manual entry instead of
// showing an error. Queries never retry a "not connected" — it won't change.
// =============================================================================

const STALE_MS = 5 * 60_000;

function retry(count: number, err: unknown) {
  return !isPricingDataNotConnected(err) && count < 2;
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

export function useSapCustomerSearch(query: string) {
  const trimmed = query.trim();
  const q = useQuery<SapCustomer[]>({
    queryKey: ["pricing-sap", "customers", trimmed.toLowerCase()],
    queryFn: () => searchSapCustomers(trimmed),
    enabled: trimmed.length >= 2,
    staleTime: STALE_MS,
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

/** A customer group's discount for an MPG — null when SAP has none. */
export function useCustomerGroupDiscount(customerGroup: string, mpg: string) {
  const q = useQuery<number | null>({
    queryKey: ["pricing-sap", "group-discount", customerGroup, mpg],
    queryFn: () => sapCustomerGroupDiscount(customerGroup, mpg),
    enabled: !!customerGroup && !!mpg,
    staleTime: STALE_MS,
    retry,
  });
  return { ...q, ...connectionOf(q) };
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
  const notConnected = parts.some((q) => isPricingDataNotConnected(q.error)) || isPricingDataNotConnected(discounts.error);
  const failed = !notConnected && (parts.some((q) => q.isError) || discounts.isError);
  return { rows, notConnected, failed };
}
