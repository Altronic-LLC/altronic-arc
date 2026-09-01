import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMaintenanceReferenceValue,
  listMaintenanceReferenceValues,
  setMaintenanceReferenceValueActive,
  updateMaintenanceReferenceValue,
} from "@/api/maintenanceReferenceLists";
import type {
  MaintenanceReferenceInput,
  MaintenanceReferenceKind,
  MaintenanceReferenceValue,
} from "@/types/task";
import { manageAssetsGate } from "@/lib/maintenanceRoles";
import { useResolveMaintenanceAccess } from "./useMaintenanceRoles";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Maintenance Departments / Maintenance Locations — the two admin-managed
// reference lists behind every Department and Location field in the CMMS.
//
// **This is `manageAssetsGate`'s first caller.** The gate has existed (and been
// tested) since the CMMS roles landed, waiting for the screen that manages the
// asset register, departments and locations; adding a fourth rule here rather
// than asking it would have been how the gates start disagreeing with each
// other. Every mutation asks it INSIDE its `mutationFn` — defence in depth
// beside the admin screen's own gating, so a future bulk action can't write
// without the check. As always, SharePoint's own list permissions are the real
// boundary.
//
// Cached for five minutes, like the equipment register: nine departments and
// sixty-odd locations that change a few times a year, read by every work-order
// screen, every schedule screen and the asset register to resolve their
// lookups.
//
// **Reading is open to anyone signed in**, and deliberately so — everybody sees
// the value on the record in front of them, and hiding the list would only make
// the pickers empty.
// =============================================================================

export const MAINTENANCE_REFERENCE_KEY = ["maintenanceReferences"] as const;

function referenceKeyFor(kind: MaintenanceReferenceKind) {
  return [...MAINTENANCE_REFERENCE_KEY, kind] as const;
}

/** Every value on one reference list, retired ones included. */
export function useMaintenanceReferenceValues(kind: MaintenanceReferenceKind) {
  return useQuery({
    queryKey: referenceKeyFor(kind),
    queryFn: () => listMaintenanceReferenceValues(kind),
    staleTime: 5 * 60_000,
  });
}

/** The nine shop-floor departments. */
export function useMaintenanceDepartments() {
  return useMaintenanceReferenceValues("departments");
}

/** The sixty-odd physical locations. */
export function useMaintenanceLocations() {
  return useMaintenanceReferenceValues("locations");
}

/** Throws unless the user may manage the asset register, departments and locations. */
function useRequireAssetAdmin(): () => Promise<void> {
  const resolveAccess = useResolveMaintenanceAccess();
  return useCallback(async () => {
    const gate = manageAssetsGate(await resolveAccess());
    if (!gate.allowed) throw new Error(gate.hint);
  }, [resolveAccess]);
}

function errorToast(err: unknown, fallback: string) {
  pushToast({ message: err instanceof Error ? err.message : fallback, variant: "error" });
}

/**
 * Add a value.
 *
 * The whole reason these are lookup lists rather than choice columns: this is
 * a list-item POST, which ARC's `Sites.Selected` grant already allows, where
 * adding a choice would have needed site-manage rights nobody in the shop has.
 */
export function useCreateMaintenanceReferenceValue() {
  const qc = useQueryClient();
  const requireAdmin = useRequireAssetAdmin();
  return useMutation({
    mutationFn: async ({
      kind,
      input,
    }: {
      kind: MaintenanceReferenceKind;
      input: MaintenanceReferenceInput;
    }) => {
      await requireAdmin();
      return createMaintenanceReferenceValue(kind, input);
    },
    onSuccess: (value) => pushToast({ message: `Added "${value.title}".` }),
    onError: (err) => errorToast(err, "Couldn't add that value."),
    // Invalidates the PREFIX, so the equipment / work-order / schedule reads
    // that resolve against these lists refetch too — a department added here
    // has to appear in the pickers without a reload.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: MAINTENANCE_REFERENCE_KEY });
      invalidateDependents(qc);
    },
  });
}

/**
 * Rename a value (and/or edit its note).
 *
 * Every record pointing at it follows automatically — that is the advantage a
 * lookup has over a choice column, where fixing a typo meant editing the column
 * definition AND every row that held the old spelling.
 */
export function useUpdateMaintenanceReferenceValue() {
  const qc = useQueryClient();
  const requireAdmin = useRequireAssetAdmin();
  return useMutation({
    mutationFn: async ({
      kind,
      lookupId,
      input,
    }: {
      kind: MaintenanceReferenceKind;
      lookupId: number;
      input: MaintenanceReferenceInput;
    }) => {
      await requireAdmin();
      return updateMaintenanceReferenceValue(kind, lookupId, input);
    },
    onMutate: async ({ kind, lookupId, input }) => {
      const key = referenceKeyFor(kind);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<MaintenanceReferenceValue[]>(key);
      qc.setQueryData<MaintenanceReferenceValue[]>(key, (old) =>
        old?.map((v) => (v.lookupId === lookupId ? { ...v, title: input.title.trim() } : v)),
      );
      return { previous, key };
    },
    onSuccess: () => pushToast({ message: "Saved." }),
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
      errorToast(err, "Couldn't save that change — reverted.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: MAINTENANCE_REFERENCE_KEY });
      invalidateDependents(qc);
    },
  });
}

/**
 * Retire a value, or bring it back. **There is no delete** — see the note at
 * the top of api/maintenanceReferenceLists.ts.
 */
export function useSetMaintenanceReferenceValueActive() {
  const qc = useQueryClient();
  const requireAdmin = useRequireAssetAdmin();
  return useMutation({
    mutationFn: async ({
      kind,
      lookupId,
      active,
    }: {
      kind: MaintenanceReferenceKind;
      lookupId: number;
      active: boolean;
    }) => {
      await requireAdmin();
      return setMaintenanceReferenceValueActive(kind, lookupId, active);
    },
    onMutate: async ({ kind, lookupId, active }) => {
      const key = referenceKeyFor(kind);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<MaintenanceReferenceValue[]>(key);
      qc.setQueryData<MaintenanceReferenceValue[]>(key, (old) =>
        old?.map((v) => (v.lookupId === lookupId ? { ...v, active } : v)),
      );
      return { previous, key };
    },
    onSuccess: (value) =>
      pushToast({
        message: value.active
          ? `"${value.title}" is available again.`
          : `"${value.title}" retired — records already using it still show it.`,
      }),
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
      errorToast(err, "Couldn't change that value — reverted.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MAINTENANCE_REFERENCE_KEY }),
  });
}

/**
 * Refetch everything that JOINS against these lists.
 *
 * The equipment register, the work orders and the PM schedules all resolve
 * their `DepartmentRef` / `LocationRef` titles at read time, so a rename here
 * leaves every one of them showing the old text until something refetches. Not
 * done for a retire: that changes what the pickers OFFER, never what a loaded
 * record displays.
 */
function invalidateDependents(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["equipment"] });
  qc.invalidateQueries({ queryKey: ["maintenanceTasks"] });
  qc.invalidateQueries({ queryKey: ["scheduledMaintenance"] });
}
