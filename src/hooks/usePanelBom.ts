import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPanelBomKit,
  createPanelBomPart,
  listPanelBomKits,
  listPanelBomParts,
  updatePanelBomKit,
  updatePanelBomPart,
} from "@/api/panelBomParts";
import {
  createPanelBom,
  deletePanelBom,
  getPanelBom,
  listPanelBoms,
  setPanelBomOrder,
  updatePanelBom,
  type PanelBomInput,
} from "@/api/panelBoms";
import { describePanelBomCostFailure, listPanelBomCosts } from "@/api/panelBomCosts";
import { isRetryableFabricFailure } from "@/api/fabric";
import { useRequirePanelBomBuild, useRequirePanelBomManager } from "./usePanelRoles";
import { pushToast } from "@/components/Toast";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import {
  panelBomKitProblem,
  panelBomPartProblem,
  type PanelBomKitInput,
  type PanelBomPartInput,
} from "@/lib/panelBom";
import type { PanelBom, PanelBomKit, PanelBomPart } from "@/types/panelBom";

// =============================================================================
// Panel SAP BOM Builder (BusinessIT#59) — queries and writes.
//
// Who may do what (Tim, 2026-11-05), asked INSIDE every mutationFn against
// freshly awaited Panel User Roles and Admins lists, never a render flag:
//   - build and save a BOM: anyone on Panel User Roles but a Viewer, or an
//     ARC admin (`useRequirePanelBomBuild`) — only a Super User while the
//     limited demo runs (PANEL_BOM_LIVE off);
//   - change the parts and kits: a panel Super User or an ARC admin
//     (`useRequirePanelBomManager`).
// Navigation, not security: the lists' SharePoint permissions are the
// boundary, and Fabric decides who sees cost.
// =============================================================================

export const PANEL_BOM_PARTS_KEY = ["panelBomParts"] as const;
export const PANEL_BOM_KITS_KEY = ["panelBomKits"] as const;
export const PANEL_BOMS_KEY = ["panelBoms"] as const;
export const PANEL_BOM_COSTS_KEY = ["panelBomCosts"] as const;

const SITE = "ALTRONICPANELTEAM";

export function usePanelBomParts() {
  return useQuery({ queryKey: PANEL_BOM_PARTS_KEY, queryFn: listPanelBomParts, staleTime: 5 * 60_000 });
}

export function usePanelBomKits() {
  return useQuery({ queryKey: PANEL_BOM_KITS_KEY, queryFn: listPanelBomKits, staleTime: 5 * 60_000 });
}

export function usePanelBoms() {
  return useQuery({ queryKey: PANEL_BOMS_KEY, queryFn: listPanelBoms, staleTime: 60_000 });
}

/** SAP changes cost far less often than anyone opens the builder. */
const COST_STALE_MS = 30 * 60_000;

/**
 * SAP's unit cost for every part on the list and every kit component — one
 * batched read, cached. `costs` is null until SAP has answered and stays null
 * if it couldn't; `failure` then says why, and `failure.hidden` means "you
 * don't have access" (no retry offered).
 */
export function usePanelBomCosts(parts: readonly PanelBomPart[], kits: readonly PanelBomKit[]) {
  const saps = useMemo(() => {
    const set = new Set<string>();
    for (const p of parts) if (p.sapPartNumber) set.add(p.sapPartNumber.trim());
    for (const k of kits) for (const c of k.components) if (c.sapPartNumber) set.add(c.sapPartNumber.trim());
    return [...set].sort();
  }, [parts, kits]);
  const q = useQuery({
    queryKey: [...PANEL_BOM_COSTS_KEY, saps.join(",")],
    queryFn: () => listPanelBomCosts(saps),
    enabled: saps.length > 0,
    staleTime: COST_STALE_MS,
    gcTime: 2 * COST_STALE_MS,
    retry: (count, err) => isRetryableFabricFailure(err) && count < 1,
  });
  return {
    costs: q.data ?? null,
    loading: saps.length > 0 && q.isPending,
    failure: q.isError ? describePanelBomCostFailure(q.error) : null,
    retry: () => void q.refetch(),
  };
}

function toastError(message: string) {
  pushToast({ message, variant: "error" });
}

// -----------------------------------------------------------------------------
// Parts and kits — a panel Super User or an ARC admin.
// -----------------------------------------------------------------------------

export function useSavePanelBomPart() {
  const qc = useQueryClient();
  const requireManager = useRequirePanelBomManager();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number | null; input: PanelBomPartInput }) => {
      await requireManager();
      const problem = panelBomPartProblem(input);
      if (problem) throw new Error(problem);
      return id === null ? createPanelBomPart(input) : updatePanelBomPart(id, input);
    },
    onSuccess: (p, { id }) => pushToast({ message: `${id === null ? "Added" : "Saved"} ${p.sapPartNumber}.` }),
    onError: (err) =>
      toastError(describeListWriteFailure(err, { action: "save the part", site: SITE, permission: "editing" })),
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_BOM_PARTS_KEY }),
  });
}

export function useSavePanelBomKit() {
  const qc = useQueryClient();
  const requireManager = useRequirePanelBomManager();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number | null; input: PanelBomKitInput }) => {
      await requireManager();
      // Name clashes are checked against a FRESH list: the cache can be five
      // minutes old, and two kits with one name make picks ambiguous.
      const kits = await qc.fetchQuery({ queryKey: PANEL_BOM_KITS_KEY, queryFn: listPanelBomKits, staleTime: 0 });
      const others = kits.filter((k) => k.id !== id).map((k) => k.name);
      const problem = panelBomKitProblem(input, others);
      if (problem) throw new Error(problem);
      if (id === null) return createPanelBomKit(input);
      const previous = kits.find((k) => k.id === id);
      if (!previous) throw new Error("That kit isn't on the list any more.");
      return updatePanelBomKit(id, input, previous);
    },
    onSuccess: (k, { id }) => pushToast({ message: `${id === null ? "Added" : "Saved"} ${k.name}.` }),
    onError: (err) =>
      toastError(describeListWriteFailure(err, { action: "save the kit", site: SITE, permission: "editing" })),
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_BOM_KITS_KEY }),
  });
}

// -----------------------------------------------------------------------------
// Saved BOMs — anyone on the panel team but a Viewer.
// -----------------------------------------------------------------------------

/** Why a BOM can't be saved, or null. */
export function panelBomSaveProblem(input: PanelBomInput): string | null {
  if (!input.panelSystemNumber.trim()) return "Enter the Panel System # before saving.";
  if (input.result.lines.length === 0 && input.result.manual.length === 0) return "Pick at least one part or kit before saving.";
  return null;
}

export function useSavePanelBom() {
  const qc = useQueryClient();
  const requireEdit = useRequirePanelBomBuild();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number | null; input: PanelBomInput }): Promise<PanelBom> => {
      await requireEdit();
      const problem = panelBomSaveProblem(input);
      if (problem) throw new Error(problem);
      if (id === null) return createPanelBom(input);
      // Read it fresh: the refusal to write over unreadable picks must look
      // at what SharePoint holds now, not what the screen loaded.
      const previous = await getPanelBom(id);
      if (!previous) throw new Error("That BOM isn't on the list any more — save it as a new one.");
      return updatePanelBom(id, input, previous);
    },
    onSuccess: (bom) => {
      qc.setQueryData<PanelBom[]>(PANEL_BOMS_KEY, (old) =>
        old ? [...old.filter((b) => b.id !== bom.id), bom] : old,
      );
      pushToast({ message: `Saved ${bom.panelSystemNumber}.` });
    },
    onError: (err) =>
      toastError(describeListWriteFailure(err, { action: "save the BOM", site: SITE, permission: "editing" })),
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_BOMS_KEY }),
  });
}

export function useSetPanelBomOrder() {
  const qc = useQueryClient();
  const requireEdit = useRequirePanelBomBuild();
  return useMutation({
    mutationFn: async ({ id, panelOrderId }: { id: number; panelOrderId: number | null }) => {
      await requireEdit();
      return setPanelBomOrder(id, panelOrderId);
    },
    onSuccess: (bom) => {
      qc.setQueryData<PanelBom[]>(PANEL_BOMS_KEY, (old) => old?.map((b) => (b.id === bom.id ? bom : b)));
      pushToast({ message: bom.panelOrder ? `Linked ${bom.panelSystemNumber} to the order.` : `Unlinked ${bom.panelSystemNumber}.` });
    },
    onError: (err) =>
      toastError(describeListWriteFailure(err, { action: "link the BOM", site: SITE, permission: "editing" })),
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_BOMS_KEY }),
  });
}

export function useDeletePanelBom() {
  const qc = useQueryClient();
  const requireEdit = useRequirePanelBomBuild();
  return useMutation({
    mutationFn: async (id: number) => {
      await requireEdit();
      await deletePanelBom(id);
      return id;
    },
    onSuccess: (id) => {
      qc.setQueryData<PanelBom[]>(PANEL_BOMS_KEY, (old) => old?.filter((b) => b.id !== id));
      pushToast({ message: "BOM deleted." });
    },
    onError: (err) => toastError(describeListWriteFailure(err, { action: "delete the BOM", site: SITE })),
    onSettled: () => qc.invalidateQueries({ queryKey: PANEL_BOMS_KEY }),
  });
}
