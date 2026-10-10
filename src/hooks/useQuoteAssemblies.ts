import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createQuoteAssembly,
  deleteQuoteAssembly,
  listQuoteAssemblies,
  updateQuoteAssemblyFields,
} from "@/api/quoteAssemblies";
import { deleteQuoteItem, listQuoteItems } from "@/api/quoteItems";
import type { QuoteAssembly, QuoteItem } from "@/types/quote";
import {
  applyQuoteAssemblyPatch,
  type QuoteAssemblyInput,
  type QuoteAssemblyPatch,
} from "@/lib/quoteMapper";
import { priceQuoteAssembly } from "@/lib/quotePricing";
import { editQuoteGate } from "@/lib/quoteRoles";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { QUOTE_ASSEMBLIES_KEY, QUOTE_ITEMS_KEY, QUOTE_SITE_LABEL } from "./useQuotes";
import { requireQuoteGate, useResolveQuoteAccess } from "./useQuoteRoles";

export { QUOTE_ASSEMBLIES_KEY };

// =============================================================================
// Quote Assemblies — the LINES on a quote: final assemblies, and standalone
// Parts (`lineType`). A Part carries its own cost + overhead and has no
// components; an assembly is costed from its components. Either way the ONE
// target GM lives on the line.
//
// LINE TYPE CHANGES. Assembly → Part is REFUSED while the line still has
// components (they would silently stop counting). Part → Assembly is allowed,
// and clears the line's own Cost / MaterialOverheadPct in the SAME write — an
// assembly ignores them, and a stale cost left behind would come back if the
// line were ever switched to a Part again.
//
// One cached query holds EVERY assembly; `useQuoteAssemblies(quoteId)` scopes
// it with a `select`, so switching between quotes costs no request.
//
// Every write asks `editQuoteGate` INSIDE its mutationFn. Edits are DIFFED
// against the cached row. Deleting an assembly deletes its components FIRST —
// SharePoint has no cascade, and components left pointing at a deleted
// assembly are on no screen and counted in nothing.
//
// PRICE SYNC. `CustomerPrice` is a STORED copy of what lib/quotePricing.ts
// computes, so SharePoint's own views and exports can show it. After any
// line or component write lands — a target GM, a manual price, a Part's cost
// or overhead included — `syncAssemblyCustomerPrice` recomputes
// the assembly's price and PATCHes the column only when it differs. A failed
// sync never makes the user's own write look failed — it toasts a warning.
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
 * Recompute one assembly's price from the cached assemblies and components,
 * and write `CustomerPrice` when the stored value differs. Never throws: a
 * failure toasts a warning and resolves `false`. Resolves `true` when a
 * PATCH was made.
 */
export async function syncAssemblyCustomerPrice(qc: QueryClient, assemblyId: number): Promise<boolean> {
  try {
    const assemblies = await qc.ensureQueryData({ queryKey: QUOTE_ASSEMBLIES_KEY, queryFn: listQuoteAssemblies });
    const items = await qc.ensureQueryData({ queryKey: QUOTE_ITEMS_KEY, queryFn: listQuoteItems });
    const assembly = assemblies.find((a) => a.id === assemblyId);
    if (!assembly) return false; // deleted, or not ours to price
    const price = priceQuoteAssembly(assembly, items).price;
    if (price === assembly.customerPrice) return false;
    const updated = await updateQuoteAssemblyFields(assemblyId, { customerPrice: price }, assembly);
    upsertAssembly(qc, updated);
    return true;
  } catch (err) {
    console.error(`Couldn't update the stored price of quote assembly ${assemblyId}:`, err);
    pushToast({
      message:
        "Your change was saved, but the assembly's stored customer price couldn't be updated — " +
        "it will be corrected on the next save.",
      variant: "error",
    });
    return false;
  }
}

// -----------------------------------------------------------------------------
// Line type rules
// -----------------------------------------------------------------------------

/** Thrown when an assembly with components is switched to a Part. */
export class QuoteLineTypeChangeError extends Error {
  constructor(public componentCount: number) {
    super(
      `This line has ${componentCount} ${componentCount === 1 ? "component" : "components"}. ` +
        "Delete them before changing it to a Part — a Part is costed on the line, not from components.",
    );
    this.name = "QuoteLineTypeChangeError";
  }
}

/**
 * The patch as it will actually be written: a Part → Assembly switch also
 * clears the line's own cost and overhead.
 */
export function normalizeLineTypePatch(before: QuoteAssembly, patch: QuoteAssemblyPatch): QuoteAssemblyPatch {
  if (patch.lineType === "Assembly" && before.lineType === "Part") {
    return { ...patch, cost: null, materialOverheadPct: null };
  }
  return patch;
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
          action: "add the assembly",
          site: QUOTE_SITE_LABEL,
          permission: "creating items",
        }),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: QUOTE_ASSEMBLIES_KEY }),
  });
}

const pendingBefore = new WeakMap<object, QuoteAssembly>();

/** Edit an assembly, optimistically, DIFFED against the row the edit started from. */
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
      if (!before) throw new Error(`Quote assembly ${vars.id} not found`);
      if (vars.patch.lineType === "Part" && before.lineType !== "Part") {
        const items = await qc.ensureQueryData({ queryKey: QUOTE_ITEMS_KEY, queryFn: listQuoteItems });
        const count = items.filter((i) => i.assemblyId === vars.id).length;
        if (count > 0) throw new QuoteLineTypeChangeError(count);
      }
      return updateQuoteAssemblyFields(vars.id, normalizeLineTypePatch(before, vars.patch), before);
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: QUOTE_ASSEMBLIES_KEY });
      const previous = qc.getQueryData<QuoteAssembly[]>(QUOTE_ASSEMBLIES_KEY);
      const before = previous?.find((a) => a.id === vars.id);
      if (before) pendingBefore.set(vars, before);
      qc.setQueryData<QuoteAssembly[]>(QUOTE_ASSEMBLIES_KEY, (old) =>
        old?.map((a) => (a.id === vars.id ? applyQuoteAssemblyPatch(a, normalizeLineTypePatch(a, vars.patch)) : a)),
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
        err instanceof QuoteLineTypeChangeError
          ? err.message
          : describeListWriteFailure(err, {
          action: "save the assembly",
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

/** Thrown when some of an assembly's components couldn't be deleted — the assembly is kept. */
export class QuoteAssemblyDeleteError extends Error {
  constructor(
    public failedItems: QuoteItem[],
    public deletedItemIds: number[],
  ) {
    const names = failedItems.map((i) => i.altronicPartNumber || `line ${i.lineNo}`).join(", ");
    super(
      `Couldn't delete ${failedItems.length === 1 ? "component" : "components"} ${names}, ` +
        "so the assembly was kept. Try deleting it again.",
    );
    this.name = "QuoteAssemblyDeleteError";
  }
}

/**
 * Delete an assembly: its components FIRST (best-effort, each on its own),
 * then the assembly — and only if every component went. A component that
 * couldn't be deleted is named, and the assembly stays.
 */
export function useDeleteQuoteAssembly() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requireQuoteGate(editQuoteGate(await resolve()));
      const items = (await qc.ensureQueryData({ queryKey: QUOTE_ITEMS_KEY, queryFn: listQuoteItems })).filter(
        (i) => i.assemblyId === id,
      );
      const results = await Promise.allSettled(items.map((i) => deleteQuoteItem(i.id)));
      const deleted = items.filter((_, n) => results[n].status === "fulfilled").map((i) => i.id);
      const failed = items.filter((_, n) => results[n].status === "rejected");
      if (deleted.length > 0) {
        const gone = new Set(deleted);
        qc.setQueryData<QuoteItem[]>(QUOTE_ITEMS_KEY, (old) => old?.filter((i) => !gone.has(i.id)));
      }
      if (failed.length > 0) throw new QuoteAssemblyDeleteError(failed, deleted);
      await deleteQuoteAssembly(id);
      return id;
    },
    onSuccess: async (id, _vars) => {
      qc.setQueryData<QuoteAssembly[]>(QUOTE_ASSEMBLIES_KEY, (old) => old?.filter((a) => a.id !== id));
    },
    onError: async (err: unknown, id) => {
      errorToast(
        err instanceof QuoteAssemblyDeleteError
          ? err.message
          : describeListWriteFailure(err, {
              action: "delete the assembly",
              site: QUOTE_SITE_LABEL,
              permission: "deleting",
            }),
      );
      // Some components may have gone — the assembly's stored price is stale.
      if (err instanceof QuoteAssemblyDeleteError && err.deletedItemIds.length > 0) {
        await syncAssemblyCustomerPrice(qc, id);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QUOTE_ASSEMBLIES_KEY });
      void qc.invalidateQueries({ queryKey: QUOTE_ITEMS_KEY });
    },
  });
}
