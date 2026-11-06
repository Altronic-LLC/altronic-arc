import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createPlantMapRoleEntry,
  deletePlantMapRoleEntry,
  listPlantMapRoleEntries,
  updatePlantMapRoleEntry,
} from "@/api/plantMapRoles";
import { listAdmins } from "@/api/admins";
import type { AdminEntry } from "@/types/task";
import type { PlantMapRole, PlantMapRoleEntry, PlantMapRoleInput } from "@/types/plant";
import { BOOTSTRAP_ADMINS } from "@/lib/adminAccess";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import {
  NO_PLANT_MAP_RIGHTS,
  managePlantMapRolesGate,
  plantMapRightsFrom,
  type PlantMapAccess,
  type PlantMapGate,
} from "@/lib/plantMapRoles";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { ADMINS_KEY, useAdmins } from "./useAdmins";
import { useCurrentUserEmails } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Plant Map Roles — and what the signed-in user may do.
//
// `useMyPlantMapAccess` is for rendering; `useResolvePlantMapAccess` is for a
// mutationFn and AWAITS the roles and Admins lists rather than trusting a
// render-time flag (the MCN / CMMS lesson).
// =============================================================================

export const PLANT_MAP_ROLES_KEY = ["plant-map-roles", "list"] as const;

const STALE_MS = 60_000;
const SITE_LABEL = "Altronic_PMO";

export function requirePlantMapGate(gate: PlantMapGate): void {
  if (!gate.allowed) throw new Error(gate.hint);
}

function rolesFor(entries: PlantMapRoleEntry[], emails: string[]): PlantMapRole[] {
  // On ADDRESS, against every address the account carries (lib/emailIdentity.ts).
  return entries.find((e) => matchesAnyEmail(emails, e.email))?.roles ?? [];
}

function isArcAdminFor(admins: AdminEntry[], emails: string[]): boolean {
  if (emails.some((e) => BOOTSTRAP_ADMINS.has(e.toLowerCase()))) return true;
  return admins.some((a) => matchesAnyEmail(emails, a.email));
}

export function usePlantMapRoleEntries() {
  return useQuery<PlantMapRoleEntry[]>({
    queryKey: PLANT_MAP_ROLES_KEY,
    queryFn: listPlantMapRoleEntries,
    staleTime: STALE_MS,
  });
}

/** For rendering — feed it to the gates in lib/plantMapRoles.ts. */
export function useMyPlantMapAccess(): PlantMapAccess {
  const emails = useCurrentUserEmails();
  const roles = usePlantMapRoleEntries();
  const admins = useAdmins();
  if (emails.length === 0) return { rights: NO_PLANT_MAP_RIGHTS, resolving: true, failed: false };
  const bootstrap = emails.some((e) => BOOTSTRAP_ADMINS.has(e.toLowerCase()));
  if (roles.isLoading || (!bootstrap && admins.isLoading)) {
    return { rights: NO_PLANT_MAP_RIGHTS, resolving: true, failed: false };
  }
  const isArcAdmin = isArcAdminFor(admins.data ?? [], emails);
  if (roles.isError) {
    // Couldn't read the list: no access, and the screen says it couldn't check.
    return { rights: plantMapRightsFrom([], { isArcAdmin }), resolving: false, failed: true };
  }
  return {
    rights: plantMapRightsFrom(rolesFor(roles.data ?? [], emails), { isArcAdmin }),
    resolving: false,
    failed: false,
  };
}

/** The same answer inside a mutationFn, AWAITING the lists. Never `resolving`. */
export function useResolvePlantMapAccess(): () => Promise<PlantMapAccess> {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  const emailsRef = useRef(emails);
  emailsRef.current = emails;
  return useCallback(() => resolvePlantMapAccess(qc, emailsRef.current), [qc]);
}

export async function resolvePlantMapAccess(qc: QueryClient, emails: string[]): Promise<PlantMapAccess> {
  if (emails.length === 0) return { rights: NO_PLANT_MAP_RIGHTS, resolving: false, failed: false };
  let admins: AdminEntry[] = [];
  try {
    admins = await qc.ensureQueryData({ queryKey: ADMINS_KEY, queryFn: listAdmins, staleTime: STALE_MS });
  } catch {
    // Only the roles-list right depends on this; bootstrap admins still count.
  }
  const isArcAdmin = isArcAdminFor(admins, emails);
  let entries: PlantMapRoleEntry[];
  try {
    entries = await qc.ensureQueryData({
      queryKey: PLANT_MAP_ROLES_KEY,
      queryFn: listPlantMapRoleEntries,
      staleTime: STALE_MS,
    });
  } catch {
    // A failed read REFUSES — granting on error would make every gate advisory.
    return { rights: plantMapRightsFrom([], { isArcAdmin }), resolving: false, failed: true };
  }
  return {
    rights: plantMapRightsFrom(rolesFor(entries, emails), { isArcAdmin }),
    resolving: false,
    failed: false,
  };
}

// -----------------------------------------------------------------------------
// Roles list writes — a Plant Map admin or an ARC admin, asked inside every write.
// -----------------------------------------------------------------------------

function rolesError(action: string) {
  return (err: unknown) =>
    pushToast({
      message: describeListWriteFailure(err, { action, site: SITE_LABEL, permission: "editing" }),
      variant: "error",
    });
}

export function useCreatePlantMapRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolvePlantMapAccess();
  return useMutation({
    mutationFn: async (input: PlantMapRoleInput) => {
      requirePlantMapGate(managePlantMapRolesGate(await resolve()));
      const email = input.email.trim().toLowerCase();
      const current = qc.getQueryData<PlantMapRoleEntry[]>(PLANT_MAP_ROLES_KEY) ?? [];
      if (current.some((e) => e.email === email)) throw new Error(`${email} is already on the Plant Map Roles list.`);
      return createPlantMapRoleEntry(input);
    },
    onSuccess: (created) =>
      qc.setQueryData<PlantMapRoleEntry[]>(PLANT_MAP_ROLES_KEY, (old) => (old ? [...old, created] : [created])),
    onError: rolesError("add that person"),
    onSettled: () => qc.invalidateQueries({ queryKey: PLANT_MAP_ROLES_KEY }),
  });
}

export function useUpdatePlantMapRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolvePlantMapAccess();
  return useMutation({
    mutationFn: async (input: { id: number; roles?: PlantMapRole[]; note?: string }) => {
      requirePlantMapGate(managePlantMapRolesGate(await resolve()));
      return updatePlantMapRoleEntry(input);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: PLANT_MAP_ROLES_KEY });
      const previous = qc.getQueryData<PlantMapRoleEntry[]>(PLANT_MAP_ROLES_KEY);
      qc.setQueryData<PlantMapRoleEntry[]>(PLANT_MAP_ROLES_KEY, (old) =>
        old?.map((e) =>
          e.id === input.id
            ? { ...e, ...(input.roles && { roles: input.roles }), ...(input.note !== undefined && { note: input.note }) }
            : e,
        ),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PLANT_MAP_ROLES_KEY, ctx.previous);
      rolesError("update that person's roles")(err);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PLANT_MAP_ROLES_KEY }),
  });
}

export function useDeletePlantMapRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolvePlantMapAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requirePlantMapGate(managePlantMapRolesGate(await resolve()));
      return deletePlantMapRoleEntry(id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: PLANT_MAP_ROLES_KEY });
      const previous = qc.getQueryData<PlantMapRoleEntry[]>(PLANT_MAP_ROLES_KEY);
      qc.setQueryData<PlantMapRoleEntry[]>(PLANT_MAP_ROLES_KEY, (old) => old?.filter((e) => e.id !== id));
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PLANT_MAP_ROLES_KEY, ctx.previous);
      pushToast({
        message: describeListWriteFailure(err, { action: "remove that person", site: SITE_LABEL }),
        variant: "error",
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PLANT_MAP_ROLES_KEY }),
  });
}
