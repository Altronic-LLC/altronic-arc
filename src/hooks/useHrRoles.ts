import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createHrRoleEntry, deleteHrRoleEntry, listHrRoleEntries, updateHrRoleEntry } from "@/api/hrRoles";
import { listAdmins } from "@/api/admins";
import { HR_CONFIGURED } from "@/api/config";
import type { AdminEntry, Person } from "@/types/task";
import type { HrRole, HrRoleEntry, HrRoleInput } from "@/types/hr";
import { BOOTSTRAP_ADMINS } from "@/lib/adminAccess";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import { NO_HR_RIGHTS, hrRightsFrom, manageHrRolesGate, type HrAccess, type HrGate } from "@/lib/hrRoles";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { ADMINS_KEY, useAdmins } from "./useAdmins";
import { useCurrentUserEmails } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";

// =============================================================================
// HR Roles — and what the signed-in user may see in Human Resources.
//
// `useMyHrAccess` is for rendering (menu, Dashboard, screens);
// `useResolveHrAccess` is for a mutationFn and AWAITS the roles and Admins
// lists rather than trusting a render-time flag (the MCN / Pricing lesson).
// With HR not set up, nobody has any HR right — the department is hidden.
// =============================================================================

export const HR_ROLES_KEY = ["hr-roles", "list"] as const;

const STALE_MS = 60_000;
const SITE_LABEL = "the HR site";

export function requireHrGate(gate: HrGate): void {
  if (!gate.allowed) throw new Error(gate.hint);
}

function rolesFor(entries: HrRoleEntry[], emails: string[]): HrRole[] {
  // On ADDRESS, against every address the account carries (lib/emailIdentity.ts).
  return entries.find((e) => matchesAnyEmail(emails, e.email))?.roles ?? [];
}

function isArcAdminFor(admins: AdminEntry[], emails: string[]): boolean {
  if (emails.some((e) => BOOTSTRAP_ADMINS.has(e.toLowerCase()))) return true;
  return admins.some((a) => matchesAnyEmail(emails, a.email));
}

export function useHrRoleEntries() {
  return useQuery<HrRoleEntry[]>({
    queryKey: HR_ROLES_KEY,
    queryFn: listHrRoleEntries,
    staleTime: STALE_MS,
    enabled: HR_CONFIGURED,
  });
}

/** For rendering — feed it to the gates in lib/hrRoles.ts. */
export function useMyHrAccess(): HrAccess {
  const emails = useCurrentUserEmails();
  const roles = useHrRoleEntries();
  const admins = useAdmins();
  if (!HR_CONFIGURED) return { rights: NO_HR_RIGHTS, resolving: false, failed: false };
  if (emails.length === 0) return { rights: NO_HR_RIGHTS, resolving: true, failed: false };
  const bootstrap = emails.some((e) => BOOTSTRAP_ADMINS.has(e.toLowerCase()));
  if (roles.isLoading || (!bootstrap && admins.isLoading)) {
    return { rights: NO_HR_RIGHTS, resolving: true, failed: false };
  }
  const isArcAdmin = isArcAdminFor(admins.data ?? [], emails);
  if (roles.isError) {
    // An unreadable roles list grants nothing but the ARC admin's manage right.
    return { rights: hrRightsFrom([], { isArcAdmin }), resolving: false, failed: true };
  }
  return { rights: hrRightsFrom(rolesFor(roles.data ?? [], emails), { isArcAdmin }), resolving: false, failed: false };
}

/**
 * May this person see the HR department at all — its menu group and its
 * Dashboard section? Not while the roles list is still answering, so HR never
 * flashes up for somebody it then disappears from. Navigation only.
 */
export function canSeeHr(access: HrAccess): boolean {
  return HR_CONFIGURED && !access.resolving && access.rights.canOpen;
}

/** The same answer inside a mutationFn, AWAITING the lists. Never `resolving`. */
export function useResolveHrAccess(): () => Promise<HrAccess> {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  const emailsRef = useRef(emails);
  emailsRef.current = emails;
  return useCallback(() => resolveHrAccess(qc, emailsRef.current), [qc]);
}

export async function resolveHrAccess(qc: QueryClient, emails: string[]): Promise<HrAccess> {
  if (!HR_CONFIGURED || emails.length === 0) return { rights: NO_HR_RIGHTS, resolving: false, failed: false };
  let admins: AdminEntry[] = [];
  try {
    admins = await qc.ensureQueryData({ queryKey: ADMINS_KEY, queryFn: listAdmins, staleTime: STALE_MS });
  } catch {
    // Only the manage right depends on this; bootstrap admins still count.
  }
  const isArcAdmin = isArcAdminFor(admins, emails);
  let entries: HrRoleEntry[];
  try {
    entries = await qc.ensureQueryData({ queryKey: HR_ROLES_KEY, queryFn: listHrRoleEntries, staleTime: STALE_MS });
  } catch {
    // A failed read REFUSES — granting on error would make every gate advisory.
    return { rights: hrRightsFrom([], { isArcAdmin }), resolving: false, failed: true };
  }
  return { rights: hrRightsFrom(rolesFor(entries, emails), { isArcAdmin }), resolving: false, failed: false };
}

/** People holding a tag — read FRESH at send time, so a change reaches the next email. */
export async function readHrPeopleWithRole(qc: QueryClient, role: HrRole): Promise<Person[]> {
  const entries = await qc.fetchQuery({ queryKey: HR_ROLES_KEY, queryFn: listHrRoleEntries, staleTime: 0 });
  return entries
    .filter((e) => e.roles.includes(role))
    .map((e) => ({ displayName: e.displayName || e.email, email: e.email }));
}

// -----------------------------------------------------------------------------
// Managing the list — an HR admin or an ARC admin, asked inside every write.
// -----------------------------------------------------------------------------

function settingsError(action: string, permission: "editing" | "deleting" = "editing") {
  return (err: unknown) =>
    pushToast({
      message:
        err instanceof Error && /^(Only an HR admin|Couldn't check|.* is already on)/.test(err.message)
          ? err.message
          : describeListWriteFailure(err, { action, site: SITE_LABEL, permission }),
      variant: "error",
    });
}

export function useCreateHrRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolveHrAccess();
  return useMutation({
    mutationFn: async (input: HrRoleInput) => {
      requireHrGate(manageHrRolesGate(await resolve()));
      const email = input.email.trim().toLowerCase();
      const current = qc.getQueryData<HrRoleEntry[]>(HR_ROLES_KEY) ?? [];
      if (current.some((e) => e.email === email)) throw new Error(`${email} is already on the HR access list.`);
      return createHrRoleEntry(input);
    },
    onSuccess: (created) =>
      qc.setQueryData<HrRoleEntry[]>(HR_ROLES_KEY, (old) => (old ? [...old, created] : [created])),
    onError: settingsError("add that person"),
    onSettled: () => qc.invalidateQueries({ queryKey: HR_ROLES_KEY }),
  });
}

export function useUpdateHrRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolveHrAccess();
  return useMutation({
    mutationFn: async (input: { id: number; roles?: HrRole[]; note?: string }) => {
      requireHrGate(manageHrRolesGate(await resolve()));
      return updateHrRoleEntry(input);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: HR_ROLES_KEY });
      const previous = qc.getQueryData<HrRoleEntry[]>(HR_ROLES_KEY);
      qc.setQueryData<HrRoleEntry[]>(HR_ROLES_KEY, (old) =>
        old?.map((e) =>
          e.id === input.id
            ? { ...e, ...(input.roles && { roles: input.roles }), ...(input.note !== undefined && { note: input.note }) }
            : e,
        ),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(HR_ROLES_KEY, ctx.previous);
      settingsError("update that person's access")(err);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: HR_ROLES_KEY }),
  });
}

export function useDeleteHrRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolveHrAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requireHrGate(manageHrRolesGate(await resolve()));
      return deleteHrRoleEntry(id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: HR_ROLES_KEY });
      const previous = qc.getQueryData<HrRoleEntry[]>(HR_ROLES_KEY);
      qc.setQueryData<HrRoleEntry[]>(HR_ROLES_KEY, (old) => old?.filter((e) => e.id !== id));
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(HR_ROLES_KEY, ctx.previous);
      settingsError("remove that person", "deleting")(err);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: HR_ROLES_KEY }),
  });
}
