import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createQuoteAssembly,
  deleteQuoteAssembly,
  listQuoteAssemblies,
  updateQuoteAssemblyFields,
} from "@/api/quoteAssemblies";
import type { QuoteAssembly } from "@/types/quote";
import {
  applyQuoteAssemblyPatch,
  type QuoteAssemblyInput,
  type QuoteAssemblyPatch,
} from "@/lib/quoteMapper";
import { priceQuoteAssembly } from "@/lib/quotePricing";
import { editQuoteGate } from "@/lib/quoteRoles";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { QUOTE_ASSEMBLIES_KEY, QUOTE_SITE_LABEL } from "./useQuotes";
import { requireQuoteGate, useResolveQuoteAccess } from "./useQuoteRoles";

export { QUOTE_ASSEMBLIES_KEY };

// =============================================================================
// Quote Assemblies — the LINES on a quote. Each carries its final material,
// labor and overhead (percent of material) and ONE target GM; the price comes
// from lib/quotePricing.ts.
//
// One cached query holds EVERY line; `useQuoteAssemblies(quoteId)` scopes it
// with a `select`, so switching between quotes costs no request.
//
// Every write asks `editQuoteGate` INSIDE its mutationFn. Edits are DIFFED
// against the cached row.
//
// PRICE SYNC. `CustomerPrice` is a STORED copy of what lib/quotePricing.ts
// computes, so SharePoint's own views and exports can show it. After any line
// write lands, `syncAssemblyCustomerPrice` recomputes the price and PATCHes
// the column only when it differs. A failed sync never makes the user's own
// write look failed — it toasts a warning.
// =============================================================================

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

/** Every assembly on one quote, in line order. */
export function useQuoteAssemblies(quoteId: number | null) {
  const select = useCallback(
    (rows: QuoteAssembly[]) => (quoteId === null ? [] : rows.filter((a) => a.quoteId === quoteId)),
    [quoteId],
  );
  return useQuery({
    queryKey: QUOTE_ASSEMBLIES_KEY,
    queryFn: listQuoteAssemblies,
    staleTime: 60_000,
    select,
  });
}

export function upsertAssembly(qc: QueryClient, row: QuoteAssembly) {
  qc.setQueryData<QuoteAssembly[]>(QUOTE_ASSEMBLIES_KEY, (old) => {
    if (!old) return [row];
    return old.some((a) => a.id === row.id) ? old.map((a) => (a.id === row.id ? row : a)) : [...old, row];
  });
}

/**
 * Recompute one line's price from the cached lines, and write `CustomerPrice`
 * when the stored value differs. Never throws: a
 * failure toasts a warning and resolves `false`. Resolves `true` when a
 * PATCH was made.
 */
export async function syncAssemblyCustomerPrice(qc: QueryClient, assemblyId: number): Promise<boolean> {
  try {
    const assemblies = await qc.ensureQueryData({ queryKey: QUOTE_ASSEMBLIES_KEY, queryFn: listQuoteAssemblies });
    const assembly = assemblies.find((a) => a.id === assemblyId);
    if (!assembly) return false; // deleted, or not ours to price
    const price = priceQuoteAssembly(assembly).price;
    if (price === assembly.customerPrice) return false;
    const updated = await updateQuoteAssemblyFields(assemblyId, { customerPrice: price }, assembly);
    upsertAssembly(qc, updated);
    return true;
  } catch (err) {
    console.error(`Couldn't update the stored price of quote assembly ${assemblyId}:`, err);
    pushToast({
      message:
        "Your change was saved, but the line's stored customer price couldn't be updated — " +
        "it will be corrected on the next save.",
      variant: "error",
    });
    return false;
  }
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

export function useCreateQuoteAssembly() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async (input: QuoteAssemblyInput) => {
      requireQuoteGate(editQuoteGate(await resolve()));
      return createQuoteAssembly(input);
    },
    onSuccess: async (created) => {
      upsertAssembly(qc, created);
      await syncAssemblyCustomerPrice(qc, created.id);
    },
    onError: (err: unknown) =>
      errorToast(
        describeListWriteFailure(err, {
          action: "add the line",
          site: QUOTE_SITE_LABEL,
          permission: "creating items",
        }),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: QUOTE_ASSEMBLIES_KEY }),
  });
}

const pendingBefore = new WeakMap<object, QuoteAssembly>();

/** Edit a line, optimistically, DIFFED against the row the edit started from. */
export function useUpdateQuoteAssembly() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async (vars: { id: number; patch: QuoteAssemblyPatch }) => {
      requireQuoteGate(editQuoteGate(await resolve()));
      let before = pendingBefore.get(vars);
      if (!before) {
        const rows = await listQuoteAssemblies();
        before = rows.find((a) => a.id === vars.id);
      }
      if (!before) throw new Error(`Quote line ${vars.id} not found`);
      return updateQuoteAssemblyFields(vars.id, vars.patch, before);
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: QUOTE_ASSEMBLIES_KEY });
      const previous = qc.getQueryData<QuoteAssembly[]>(QUOTE_ASSEMBLIES_KEY);
      const before = previous?.find((a) => a.id === vars.id);
      if (before) pendingBefore.set(vars, before);
      qc.setQueryData<QuoteAssembly[]>(QUOTE_ASSEMBLIES_KEY, (old) =>
        old?.map((a) => (a.id === vars.id ? applyQuoteAssemblyPatch(a, vars.patch) : a)),
      );
      return { previous };
    },
    onSuccess: async (updated) => {
      upsertAssembly(qc, updated);
      await syncAssemblyCustomerPrice(qc, updated.id);
    },
    onError: (err: unknown, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUOTE_ASSEMBLIES_KEY, ctx.previous);
      errorToast(
        describeListWriteFailure(err, {
          action: "save the line",
          site: QUOTE_SITE_LABEL,
          permission: "editing",
        }),
      );
    },
    onSettled: (_d, _e, vars) => {
      pendingBefore.delete(vars);
      void qc.invalidateQueries({ queryKey: QUOTE_ASSEMBLIES_KEY });
    },
  });
}

/** Delete a line. */
export function useDeleteQuoteAssembly() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requireQuoteGate(editQuoteGate(await resolve()));
      await deleteQuoteAssembly(id);
      return id;
    },
    onSuccess: (id) => {
      qc.setQueryData<QuoteAssembly[]>(QUOTE_ASSEMBLIES_KEY, (old) => old?.filter((a) => a.id !== id));
    },
    onError: (err: unknown) =>
      errorToast(
        describeListWriteFailure(err, {
          action: "delete the line",
          site: QUOTE_SITE_LABEL,
          permission: "deleting",
        }),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: QUOTE_ASSEMBLIES_KEY }),
  });
}
