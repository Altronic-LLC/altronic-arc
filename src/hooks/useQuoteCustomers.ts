import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createQuoteCustomer, listQuoteCustomers, updateQuoteCustomer } from "@/api/quoteCustomers";
import type { QuoteCustomer } from "@/types/quote";
import type { QuoteCustomerInput, QuoteCustomerPatch } from "@/lib/quoteMapper";
import { manageCustomersGate } from "@/lib/quoteRoles";
import { requireQuoteGate, useResolveQuoteAccess } from "./useQuoteRoles";

// =============================================================================
// Quote Customers — read by everyone with quote access, written by a quote
// MANAGER only (`manageCustomersGate`, asked inside every mutationFn).
//
// No delete: a customer that has stopped buying is retired (`active: false`).
// `QuoteCustomerCodeTakenError` from the API is surfaced UNCHANGED, so the
// form can catch it by type and re-propose a code.
// =============================================================================

export const QUOTE_CUSTOMERS_KEY = ["quote-customers", "list"] as const;

/** Every customer, retired ones included, by name. */
export function useQuoteCustomers() {
  return useQuery<QuoteCustomer[]>({
    queryKey: QUOTE_CUSTOMERS_KEY,
    queryFn: listQuoteCustomers,
    staleTime: 60_000,
  });
}

function upsert(old: QuoteCustomer[] | undefined, row: QuoteCustomer): QuoteCustomer[] {
  if (!old) return [row];
  return old.some((c) => c.id === row.id) ? old.map((c) => (c.id === row.id ? row : c)) : [...old, row];
}

export function useCreateQuoteCustomer() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async (input: QuoteCustomerInput) => {
      requireQuoteGate(manageCustomersGate(await resolve()));
      return createQuoteCustomer(input);
    },
    onSuccess: (created) => {
      qc.setQueryData<QuoteCustomer[]>(QUOTE_CUSTOMERS_KEY, (old) => upsert(old, created));
      void qc.invalidateQueries({ queryKey: QUOTE_CUSTOMERS_KEY });
    },
  });
}

/** Edit a customer, DIFFED against the cached row. The code is never editable. */
export function useUpdateQuoteCustomer() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: QuoteCustomerPatch }) => {
      requireQuoteGate(manageCustomersGate(await resolve()));
      const rows = await qc.ensureQueryData({ queryKey: QUOTE_CUSTOMERS_KEY, queryFn: listQuoteCustomers });
      const previous = rows.find((c) => c.id === id);
      if (!previous) throw new Error(`Quote customer ${id} not found`);
      return updateQuoteCustomer(id, patch, previous);
    },
    onSuccess: (updated) => {
      qc.setQueryData<QuoteCustomer[]>(QUOTE_CUSTOMERS_KEY, (old) => upsert(old, updated));
      void qc.invalidateQueries({ queryKey: QUOTE_CUSTOMERS_KEY });
    },
  });
}
