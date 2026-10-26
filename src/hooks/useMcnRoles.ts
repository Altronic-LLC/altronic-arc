import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createMcnRoleEntry,
  deleteMcnRoleEntry,
  listMcnDistributionGroups,
  listMcnRoleEntries,
  setMcnDistributionGroupMembers,
  updateMcnRoleEntry,
} from "@/api/mcnRoles";
import { listAdmins } from "@/api/admins";
import { MCN_LIVE } from "@/api/config";
import type { AdminEntry, Person } from "@/types/task";
import type { McnDistributionGroup, McnRole, McnRoleEntry, McnRoleInput } from "@/types/mcn";
import { BOOTSTRAP_ADMINS } from "@/lib/adminAccess";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import { NO_MCN_RIGHTS, manageMcnGate, mcnRightsFrom, type McnAccess, type McnGate } from "@/lib/mcnRoles";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { ADMINS_KEY, useAdmins } from "./useAdmins";
import { useCurrentUserEmails } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";

// =============================================================================
// MCN Roles + Distribution Groups — and what the signed-in user may do.
//
// `useMyMcnAccess` is for rendering; `useResolveMcnAccess` is for a
// mutationFn and AWAITS the roles and Admins lists rather than trusting a
// render-time flag (a write fired on first paint must not refuse somebody who
// does hold the role — the CMMS / Pricing lesson).
// =============================================================================

export const MCN_ROLES_KEY = ["mcn-roles", "list"] as const;
export const MCN_GROUPS_KEY = ["mcn-distribution-groups", "list"] as const;

const STALE_MS = 60_000;
const SITE_LABEL = "Altronic_PMO";

export function requireMcnGate(gate: McnGate): void {
  if (!gate.allowed) throw new Error(gate.hint);
}

function rolesFor(entries: McnRoleEntry[], emails: string[]): McnRole[] {
  // On ADDRESS, against every address the account carries — a sign-in name is
  // not a mailbox in this tenant (lib/emailIdentity.ts).
  return entries.find((e) => matchesAnyEmail(emails, e.email))?.roles ?? [];
}

function isArcAdminFor(admins: AdminEntry[], emails: string[]): boolean {
  if (emails.some((e) => BOOTSTRAP_ADMINS.has(e.toLowerCase()))) return true;
  return admins.some((a) => matchesAnyEmail(emails, a.email));
}

export function useMcnRoleEntries() {
  return useQuery<McnRoleEntry[]>({ queryKey: MCN_ROLES_KEY, queryFn: listMcnRoleEntries, staleTime: STALE_MS });
}

export function useMcnDistributionGroups() {
  return useQuery<McnDistributionGroup[]>({
    queryKey: MCN_GROUPS_KEY,
    queryFn: listMcnDistributionGroups,
    staleTime: STALE_MS,
  });
}

/** For rendering — feed it to the gates in lib/mcnRoles.ts and lib/mcnWorkflow.ts. */
export function useMyMcnAccess(): McnAccess {
  const emails = useCurrentUserEmails();
  const roles = useMcnRoleEntries();
  const admins = useAdmins();
  if (emails.length === 0) return { rights: NO_MCN_RIGHTS, resolving: true, failed: false };
  const bootstrap = emails.some((e) => BOOTSTRAP_ADMINS.has(e.toLowerCase()));
  if (roles.isLoading || (!bootstrap && admins.isLoading)) {
    return { rights: NO_MCN_RIGHTS, resolving: true, failed: false };
  }
  const isArcAdmin = isArcAdminFor(admins.data ?? [], emails);
  if (roles.isError) {
    // Reading MCNs is open to everyone once live; only the tagged rights fail.
    return { rights: mcnRightsFrom([], { isArcAdmin, live: MCN_LIVE }), resolving: false, failed: true };
  }
  return {
    rights: mcnRightsFrom(rolesFor(roles.data ?? [], emails), { isArcAdmin, live: MCN_LIVE }),
    resolving: false,
    failed: false,
  };
}

/** The same answer inside a mutationFn, AWAITING the lists. Never `resolving`. */
export function useResolveMcnAccess(): () => Promise<McnAccess> {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  const emailsRef = useRef(emails);
  emailsRef.current = emails;
  return useCallback(() => resolveMcnAccess(qc, emailsRef.current), [qc]);
}

export async function resolveMcnAccess(qc: QueryClient, emails: string[]): Promise<McnAccess> {
  if (emails.length === 0) return { rights: NO_MCN_RIGHTS, resolving: false, failed: false };
  let admins: AdminEntry[] = [];
  try {
    admins = await qc.ensureQueryData({ queryKey: ADMINS_KEY, queryFn: listAdmins, staleTime: STALE_MS });
  } catch {
    // Only the manage right depends on this; bootstrap admins still count.
  }
  const isArcAdmin = isArcAdminFor(admins, emails);
  let entries: McnRoleEntry[];
  try {
    entries = await qc.ensureQueryData({ queryKey: MCN_ROLES_KEY, queryFn: listMcnRoleEntries, staleTime: STALE_MS });
  } catch {
    // A failed read REFUSES — granting on error would make every gate advisory.
    return { rights: mcnRightsFrom([], { isArcAdmin, live: MCN_LIVE }), resolving: false, failed: true };
  }
  return { rights: mcnRightsFrom(rolesFor(entries, emails), { isArcAdmin, live: MCN_LIVE }), resolving: false, failed: false };
}

/** The approvers as people — read from the roles list at SEND time, so a change reaches the next email. */
export async function readMcnApprovers(qc: QueryClient): Promise<Person[]> {
  const entries = await qc.ensureQueryData({ queryKey: MCN_ROLES_KEY, queryFn: listMcnRoleEntries, staleTime: STALE_MS });
  return entries
    .filter((e) => e.roles.includes("approver"))
    .map((e) => ({ displayName: e.displayName || e.email, email: e.email }));
}

// -----------------------------------------------------------------------------
// Settings writes — an MCN admin or an ARC admin, asked inside every write.
// -----------------------------------------------------------------------------

function settingsError(action: string) {
  return (err: unknown) =>
    pushToast({
      message: describeListWriteFailure(err, { action, site: SITE_LABEL, permission: "editing" }),
      variant: "error",
    });
}

export function useCreateMcnRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolveMcnAccess();
  return useMutation({
    mutationFn: async (input: McnRoleInput) => {
      requireMcnGate(manageMcnGate(await resolve()));
      const email = input.email.trim().toLowerCase();
      const current = qc.getQueryData<McnRoleEntry[]>(MCN_ROLES_KEY) ?? [];
      if (current.some((e) => e.email === email)) throw new Error(`${email} is already on the MCN team list.`);
      return createMcnRoleEntry(input);
    },
    onSuccess: (created) =>
      qc.setQueryData<McnRoleEntry[]>(MCN_ROLES_KEY, (old) => (old ? [...old, created] : [created])),
    onError: settingsError("add that person"),
    onSettled: () => qc.invalidateQueries({ queryKey: MCN_ROLES_KEY }),
  });
}

export function useUpdateMcnRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolveMcnAccess();
  return useMutation({
    mutationFn: async (input: { id: number; roles?: McnRole[]; note?: string }) => {
      requireMcnGate(manageMcnGate(await resolve()));
      return updateMcnRoleEntry(input);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: MCN_ROLES_KEY });
      const previous = qc.getQueryData<McnRoleEntry[]>(MCN_ROLES_KEY);
      qc.setQueryData<McnRoleEntry[]>(MCN_ROLES_KEY, (old) =>
        old?.map((e) =>
          e.id === input.id
            ? { ...e, ...(input.roles && { roles: input.roles }), ...(input.note !== undefined && { note: input.note }) }
            : e,
        ),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(MCN_ROLES_KEY, ctx.previous);
      settingsError("update that person's roles")(err);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MCN_ROLES_KEY }),
  });
}

export function useDeleteMcnRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolveMcnAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requireMcnGate(manageMcnGate(await resolve()));
      return deleteMcnRoleEntry(id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: MCN_ROLES_KEY });
      const previous = qc.getQueryData<McnRoleEntry[]>(MCN_ROLES_KEY);
      qc.setQueryData<McnRoleEntry[]>(MCN_ROLES_KEY, (old) => old?.filter((e) => e.id !== id));
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(MCN_ROLES_KEY, ctx.previous);
      pushToast({
        message: describeListWriteFailure(err, { action: "remove that person", site: SITE_LABEL }),
        variant: "error",
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MCN_ROLES_KEY }),
  });
}

export function useSetMcnGroupMembers() {
  const qc = useQueryClient();
  const resolve = useResolveMcnAccess();
  return useMutation({
    mutationFn: async ({ id, members }: { id: number; members: Person[] }) => {
      requireMcnGate(manageMcnGate(await resolve()));
      return setMcnDistributionGroupMembers(id, members);
    },
    onMutate: async ({ id, members }) => {
      await qc.cancelQueries({ queryKey: MCN_GROUPS_KEY });
      const previous = qc.getQueryData<McnDistributionGroup[]>(MCN_GROUPS_KEY);
      qc.setQueryData<McnDistributionGroup[]>(MCN_GROUPS_KEY, (old) =>
        old?.map((g) => (g.id === id ? { ...g, members } : g)),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(MCN_GROUPS_KEY, ctx.previous);
      settingsError("update that distribution group")(err);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MCN_GROUPS_KEY }),
  });
}
