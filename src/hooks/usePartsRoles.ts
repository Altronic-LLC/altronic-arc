import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { addPartsRole, listPartsRoles, removePartsRole, updatePartsRole } from "@/api/partsRoles";
import { PARTS_ROLES_CONFIGURED } from "@/api/config";
import type { PartsRoleEntry, Person } from "@/types/task";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import { partsRightsFor, type PartsAccess, type PartsRights } from "@/lib/partsRoles";
import { useCurrentUserEmails } from "./useCurrentUser";
import { useIsAdmin } from "./useIsAdmin";

// =============================================================================
// Parts Roles — the admin-managed list of who may add, edit and approve parts.
//
// Two jobs: (1) the admin screen's CRUD, guarded to ARC admins inside every
// mutationFn as well as in the view; (2) answering "what can the signed-in
// user do" — `useMyPartsAccess` for rendering and `useResolvePartsAccess` for
// a mutationFn, which must not trust render-time flags (the list loads
// asynchronously; see useResolveMaintenanceAccess for the same reasoning).
//
// It also answers "who do we email" — the reviewing engineers and SAP admins
// are whoever holds those tags TODAY, which is the point of keeping them on a
// list rather than in config (Tim, 2026-09-28).
// =============================================================================

export const PARTS_ROLES_KEY = ["parts-roles", "list"] as const;

const NOT_ADMIN = "Only ARC admins can change the Parts Roles list.";

export function usePartsRoles() {
  return useQuery<PartsRoleEntry[]>({
    queryKey: PARTS_ROLES_KEY,
    queryFn: listPartsRoles,
    staleTime: 60_000,
  });
}

export function useAddPartsRole() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (input: Parameters<typeof addPartsRole>[0]) => {
      if (!isAdmin) throw new Error(NOT_ADMIN);
      return addPartsRole(input);
    },
    onSuccess: (created) =>
      qc.setQueryData<PartsRoleEntry[]>(PARTS_ROLES_KEY, (old) => (old ? [...old, created] : [created])),
    onSettled: () => qc.invalidateQueries({ queryKey: PARTS_ROLES_KEY }),
  });
}

export function useUpdatePartsRole() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (input: Parameters<typeof updatePartsRole>[0]) => {
      if (!isAdmin) throw new Error(NOT_ADMIN);
      return updatePartsRole(input);
    },
    // Optimistic: a tick lands at once; restored on error.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: PARTS_ROLES_KEY });
      const previous = qc.getQueryData<PartsRoleEntry[]>(PARTS_ROLES_KEY);
      qc.setQueryData<PartsRoleEntry[]>(PARTS_ROLES_KEY, (old) =>
        old?.map((e) =>
          e.id === input.id
            ? {
                ...e,
                ...(input.displayName !== undefined && { displayName: input.displayName }),
                ...(input.roles !== undefined && { roles: input.roles }),
                ...(input.note !== undefined && { note: input.note }),
              }
            : e,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PARTS_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PARTS_ROLES_KEY }),
  });
}

export function useRemovePartsRole() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (id: number) => {
      if (!isAdmin) throw new Error(NOT_ADMIN);
      return removePartsRole(id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: PARTS_ROLES_KEY });
      const previous = qc.getQueryData<PartsRoleEntry[]>(PARTS_ROLES_KEY);
      qc.setQueryData<PartsRoleEntry[]>(PARTS_ROLES_KEY, (old) => old?.filter((e) => e.id !== id));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PARTS_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PARTS_ROLES_KEY }),
  });
}

// -----------------------------------------------------------------------------
// The signed-in user's access
// -----------------------------------------------------------------------------

/**
 * Matched on ADDRESS, against every address the account carries — a sign-in
 * name is not a mailbox in this tenant, which is what cost Steven Pirko his
 * EIR role tags (see lib/emailIdentity.ts).
 */
function accessFrom(entries: PartsRoleEntry[], emails: string[]): PartsAccess {
  const mine = entries.find((e) => matchesAnyEmail(emails, e.email));
  return { roles: mine?.roles ?? [], configured: true, resolving: false, failed: false };
}

const UNCONFIGURED: PartsAccess = { roles: [], configured: false, resolving: false, failed: false };

/** For rendering — feed it to the gates in lib/partsRoles.ts. */
export function useMyPartsAccess(): PartsAccess {
  const emails = useCurrentUserEmails();
  const { data, isLoading, isError } = usePartsRoles();
  if (!PARTS_ROLES_CONFIGURED) return UNCONFIGURED;
  if (isLoading) return { roles: [], configured: true, resolving: true, failed: false };
  if (isError) return { roles: [], configured: true, resolving: false, failed: true };
  return accessFrom(data ?? [], emails);
}

/** The same answer inside a mutationFn, awaiting the list rather than trusting a render. */
export function useResolvePartsAccess(): () => Promise<PartsAccess> {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  return useCallback(() => resolvePartsAccess(qc, emails), [qc, emails]);
}

/** The plumbing behind `useResolvePartsAccess` — exported for tests. */
export async function resolvePartsAccess(qc: QueryClient, emails: string[]): Promise<PartsAccess> {
  if (!PARTS_ROLES_CONFIGURED) return UNCONFIGURED;
  return accessFrom(await loadRoles(qc), emails);
}

async function loadRoles(qc: QueryClient): Promise<PartsRoleEntry[]> {
  try {
    return await qc.ensureQueryData({ queryKey: PARTS_ROLES_KEY, queryFn: listPartsRoles, staleTime: 60_000 });
  } catch (err) {
    // A failed read REFUSES the write: an unconfigured list is handled above,
    // so this is a genuine fault, and granting on error would make the gate
    // advisory.
    throw new Error(
      "Couldn't check your Parts List roles just now " +
        `(${err instanceof Error ? err.message : "unknown error"}). Please try again.`,
    );
  }
}

/**
 * Everybody holding a right — the reviewing engineers, or the SAP admins —
 * as mailable people. Read at SEND time, so a change on the admin screen
 * reaches the next email with no deploy.
 */
export async function resolvePartsPeople(
  qc: QueryClient,
  right: keyof Pick<PartsRights, "approveEngineering" | "approveSap">,
): Promise<Person[]> {
  if (!PARTS_ROLES_CONFIGURED) return [];
  const entries = await loadRoles(qc);
  return entries
    .filter((e) => e.email && partsRightsFor(e.roles)[right])
    .map((e) => ({ displayName: e.displayName || e.email, email: e.email }));
}
