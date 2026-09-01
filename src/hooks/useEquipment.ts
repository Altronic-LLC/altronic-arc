import { useCallback } from "react";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listEquipment,
  setEquipmentAssetStatus,
  setEquipmentMachineHours,
  setEquipmentResponsibleTech,
  setEquipmentWarrantyExpiry,
  updateEquipmentFields,
} from "@/api/operationsEquipment";
import type { Equipment, Person } from "@/types/task";
import { manageAssetsGate } from "@/lib/maintenanceRoles";
import { useResolveMaintenanceAccess } from "./useMaintenanceRoles";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Equipment register hooks.
//
// **Every write here is gated by `manageAssetsGate`, asked INSIDE the
// `mutationFn`.** That gate has always been documented as covering "the asset
// register, departments and locations"; departments and locations asked it
// from the day the reference lists landed, and the asset register did not —
// Asset Status and Responsible Tech were editable from the asset detail page
// by anyone signed in, which is a hole rather than a policy. The rule is the
// one in lib/maintenanceRoles.ts, so a greyed control and the refusal behind
// it cannot disagree.
//
// The gate is asked in the `mutationFn` rather than only in the view for the
// same reason the reference lists do it: defence in depth, so a bulk action or
// a future screen can't write without the check. As ever, this is UI-level
// gating — SharePoint's own list permissions are the real boundary.
//
// **Lockout safety comes free.** With no Maintenance Roles list configured,
// `enforced` is false and every gate allows, so an unconfigured list means
// "everyone keeps what they can do today" and never "nobody can edit an
// asset". `useEquipment.guard.test.tsx` pins both halves.
//
// There is still no create and no delete (see api/operationsEquipment.ts).
//
// `useEquipment` is cached for five minutes rather than two: 378 rows that
// change a few times a month, read by every work-order screen for its asset
// names. **Reading is open to anyone signed in** — everybody has to see the
// asset on the work order in front of them.
// =============================================================================

const EQUIPMENT_KEY = ["equipment", "list"] as const;

export function useEquipment() {
  return useQuery({
    queryKey: EQUIPMENT_KEY,
    queryFn: listEquipment,
    staleTime: 5 * 60_000,
  });
}

/** One asset out of the loaded register. */
export function useEquipmentItem(lookupId: number | null) {
  const list = useEquipment();
  return {
    ...list,
    data: lookupId !== null ? list.data?.find((e) => e.lookupId === lookupId) ?? null : null,
  };
}

/**
 * Throws unless the signed-in user may manage the asset register.
 *
 * Deliberately a local copy of the same five lines in
 * useMaintenanceReferenceLists.ts rather than a shared hook: the RULE
 * (`manageAssetsGate`) is what must not be duplicated, and it isn't — but
 * resolving access through the module's own import is what lets each module's
 * guard tests mock the roles LIST and run the real gate, instead of mocking
 * away the thing under test.
 */
function useRequireAssetAdmin(): () => Promise<void> {
  const resolveAccess = useResolveMaintenanceAccess();
  return useCallback(async () => {
    const gate = manageAssetsGate(await resolveAccess());
    if (!gate.allowed) throw new Error(gate.hint);
  }, [resolveAccess]);
}

type Ctx = { previous?: Equipment[]; prev?: Equipment };

async function snapshotAndPatch(
  qc: QueryClient,
  lookupId: number,
  patch: (rows: Equipment[]) => Equipment[],
): Promise<Ctx> {
  await qc.cancelQueries({ queryKey: EQUIPMENT_KEY });
  const previous = qc.getQueryData<Equipment[]>(EQUIPMENT_KEY);
  const prev = previous?.find((e) => e.lookupId === lookupId);
  qc.setQueryData<Equipment[]>(EQUIPMENT_KEY, (old) => (old ? patch(old) : []));
  return { previous, prev };
}

function rollback(qc: QueryClient, ctx: Ctx | undefined) {
  if (ctx?.previous) qc.setQueryData(EQUIPMENT_KEY, ctx.previous);
}

function invalidate(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: EQUIPMENT_KEY });
}

function patchAsset(lookupId: number, transform: (e: Equipment) => Equipment) {
  return (rows: Equipment[]) => rows.map((e) => (e.lookupId === lookupId ? transform(e) : e));
}

function errorToast(message: string) {
  pushToast({ message, variant: "error" });
}

/**
 * A refused write keeps the gate's own wording.
 *
 * `manageAssetsGate`'s refusal names the role to ask for and where to ask; a
 * generic "couldn't save" would throw that away, which is the whole point of
 * the hint existing (CLAUDE.md, "A SharePoint write that is refused says what
 * to ask for"). Anything else falls back to the caller's message.
 */
function writeFailureMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function useUpdateEquipmentFields() {
  const qc = useQueryClient();
  const requireAdmin = useRequireAssetAdmin();
  return useMutation({
    mutationFn: async ({
      lookupId,
      fields,
    }: {
      lookupId: number;
      fields: Record<string, unknown>;
    }) => {
      await requireAdmin();
      return updateEquipmentFields(lookupId, fields);
    },
    onSuccess: () => pushToast({ message: "Equipment updated." }),
    onError: (err) => {
      errorToast(writeFailureMessage(err, "Couldn't update the asset."));
    },
    onSettled: () => invalidate(qc),
  });
}

/** Mark an asset down / back in service — the edit made from a work order. */
export function useSetEquipmentAssetStatus() {
  const qc = useQueryClient();
  const requireAdmin = useRequireAssetAdmin();
  return useMutation({
    mutationFn: async ({
      lookupId,
      assetStatus,
    }: {
      lookupId: number;
      assetStatus: string | null;
    }) => {
      await requireAdmin();
      return setEquipmentAssetStatus(lookupId, assetStatus);
    },
    onMutate: ({ lookupId, assetStatus }) =>
      snapshotAndPatch(qc, lookupId, patchAsset(lookupId, (e) => ({ ...e, assetStatus }))),
    onSuccess: (_data, { assetStatus }) => {
      pushToast({ message: assetStatus ? `Asset marked ${assetStatus}.` : "Asset status cleared." });
    },
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast(writeFailureMessage(err, "Couldn't change the asset status — reverted."));
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetEquipmentResponsibleTech() {
  const qc = useQueryClient();
  const requireAdmin = useRequireAssetAdmin();
  return useMutation({
    mutationFn: async ({ lookupId, person }: { lookupId: number; person: Person | null }) => {
      await requireAdmin();
      return setEquipmentResponsibleTech(lookupId, person);
    },
    onMutate: ({ lookupId, person }) =>
      snapshotAndPatch(
        qc,
        lookupId,
        patchAsset(lookupId, (e) => ({ ...e, responsibleTech: person })),
      ),
    onSuccess: () => pushToast({ message: "Responsible tech updated." }),
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast(
        writeFailureMessage(err, "Couldn't update the responsible tech — reverted."),
      );
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetEquipmentWarrantyExpiry() {
  const qc = useQueryClient();
  const requireAdmin = useRequireAssetAdmin();
  return useMutation({
    mutationFn: async ({ lookupId, date }: { lookupId: number; date: Date | null }) => {
      await requireAdmin();
      return setEquipmentWarrantyExpiry(lookupId, date);
    },
    onMutate: ({ lookupId, date }) =>
      snapshotAndPatch(
        qc,
        lookupId,
        patchAsset(lookupId, (e) => ({ ...e, warrantyExpiry: date })),
      ),
    onSuccess: () => pushToast({ message: "Warranty expiry updated." }),
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast(writeFailureMessage(err, "Couldn't update the warranty expiry — reverted."));
    },
    onSettled: () => invalidate(qc),
  });
}

/**
 * Record the hourmeter reading.
 *
 * Its own mutation, and its own one-field control on the register, because a
 * reading nobody updates is a meter-based PM that never comes due — and
 * nothing else on any screen would say so. Making somebody open a full edit
 * form to type one number is exactly how a meter goes stale.
 */
export function useSetEquipmentMachineHours() {
  const qc = useQueryClient();
  const requireAdmin = useRequireAssetAdmin();
  return useMutation({
    mutationFn: async ({ lookupId, hours }: { lookupId: number; hours: number | null }) => {
      await requireAdmin();
      return setEquipmentMachineHours(lookupId, hours);
    },
    onMutate: ({ lookupId, hours }) =>
      snapshotAndPatch(
        qc,
        lookupId,
        patchAsset(lookupId, (e) => ({ ...e, currentMachineHours: hours })),
      ),
    onSuccess: (_data, { hours }) =>
      pushToast({
        message: hours === null ? "Machine hours cleared." : `Machine hours set to ${hours}.`,
      }),
    onError: (err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast(writeFailureMessage(err, "Couldn't record the machine hours — reverted."));
    },
    onSettled: () => invalidate(qc),
  });
}
