import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listEquipment,
  setEquipmentAssetStatus,
  setEquipmentResponsibleTech,
  setEquipmentWarrantyExpiry,
  updateEquipmentFields,
} from "@/api/operationsEquipment";
import type { Equipment, Person } from "@/types/task";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Equipment register hooks.
//
// The register itself is maintained in SharePoint — there is no create and no
// delete here, deliberately (see api/operationsEquipment.ts). What ARC offers
// is the handful of edits a technician makes with a work order open in front
// of them: marking a machine down or back in service, moving the responsible
// tech, correcting a warranty date.
//
// `useEquipment` is cached for five minutes rather than two: 378 rows that
// change a few times a month, read by every work-order screen for its asset
// names.
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

export function useUpdateEquipmentFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lookupId, fields }: { lookupId: number; fields: Record<string, unknown> }) =>
      updateEquipmentFields(lookupId, fields),
    onSuccess: () => pushToast({ message: "Equipment updated." }),
    onError: (err) => {
      errorToast(err instanceof Error ? err.message : "Couldn't update the asset.");
    },
    onSettled: () => invalidate(qc),
  });
}

/** Mark an asset down / back in service — the edit made from a work order. */
export function useSetEquipmentAssetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lookupId, assetStatus }: { lookupId: number; assetStatus: string | null }) =>
      setEquipmentAssetStatus(lookupId, assetStatus),
    onMutate: ({ lookupId, assetStatus }) =>
      snapshotAndPatch(qc, lookupId, patchAsset(lookupId, (e) => ({ ...e, assetStatus }))),
    onSuccess: (_data, { assetStatus }) => {
      pushToast({ message: assetStatus ? `Asset marked ${assetStatus}.` : "Asset status cleared." });
    },
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't change the asset status — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetEquipmentResponsibleTech() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lookupId, person }: { lookupId: number; person: Person | null }) =>
      setEquipmentResponsibleTech(lookupId, person),
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
        err instanceof Error ? err.message : "Couldn't update the responsible tech — reverted.",
      );
    },
    onSettled: () => invalidate(qc),
  });
}

export function useSetEquipmentWarrantyExpiry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lookupId, date }: { lookupId: number; date: Date | null }) =>
      setEquipmentWarrantyExpiry(lookupId, date),
    onMutate: ({ lookupId, date }) =>
      snapshotAndPatch(
        qc,
        lookupId,
        patchAsset(lookupId, (e) => ({ ...e, warrantyExpiry: date })),
      ),
    onSuccess: () => pushToast({ message: "Warranty expiry updated." }),
    onError: (_err, _vars, ctx) => {
      rollback(qc, ctx);
      errorToast("Couldn't update the warranty expiry — reverted.");
    },
    onSettled: () => invalidate(qc),
  });
}
