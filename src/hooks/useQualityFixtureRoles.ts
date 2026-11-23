import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createQualityFixtureRoleEntry,
  deleteQualityFixtureRoleEntry,
  listQualityFixtureRoleEntries,
  updateQualityFixtureRoleEntry,
} from "@/api/qualityFixtureRoles";
import { listAdmins } from "@/api/admins";
import type { AdminEntry } from "@/types/task";
import type {
  QualityFixtureRole,
  QualityFixtureRoleEntry,
  QualityFixtureRoleInput,
} from "@/types/qualityFixture";
import { BOOTSTRAP_ADMINS } from "@/lib/adminAccess";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import {
  NO_QUALITY_FIXTURE_RIGHTS,
  manageFixtureRolesGate,
  qualityFixtureRightsFrom,
  type QualityFixtureAccess,
  type QualityFixtureGate,
} from "@/lib/qualityFixtureRoles";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { ADMINS_KEY, useAdmins } from "./useAdmins";
import { useCurrentUserEmails } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Quality Fixture Roles — and what the signed-in user may do with the log.
//
// `useMyQualityFixtureAccess` is for rendering; `useResolveQualityFixtureAccess`
// is for a mutationFn and AWAITS the roles and Admins lists rather than
// trusting a render-time flag (the Plant Map / CMMS lesson).
// =============================================================================

export const QUALITY_FIXTURE_ROLES_KEY = ["quality-fixture-roles", "list"] as const;

const STALE_MS = 60_000;
const SITE_LABEL = "Altronic_PMO";

export function requireQualityFixtureGate(gate: QualityFixtureGate): void {
  if (!gate.allowed) throw new Error(gate.hint);
}

function rolesFor(entries: QualityFixtureRoleEntry[], emails: string[]): QualityFixtureRole[] {
  // On ADDRESS, against every address the account carries (lib/emailIdentity.ts).
  return entries.find((e) => matchesAnyEmail(emails, e.email))?.roles ?? [];
}

function isArcAdminFor(admins: AdminEntry[], emails: string[]): boolean {
  if (emails.some((e) => BOOTSTRAP_ADMINS.has(e.toLowerCase()))) return true;
  return admins.some((a) => matchesAnyEmail(emails, a.email));
}

export function useQualityFixtureRoleEntries() {
  return useQuery<QualityFixtureRoleEntry[]>({
    queryKey: QUALITY_FIXTURE_ROLES_KEY,
    queryFn: listQualityFixtureRoleEntries,
    staleTime: STALE_MS,
  });
}

/** For rendering — feed it to the gates in lib/qualityFixtureRoles.ts. */
export function useMyQualityFixtureAccess(): QualityFixtureAccess {
  const emails = useCurrentUserEmails();
  const roles = useQualityFixtureRoleEntries();
  const admins = useAdmins();
  if (emails.length === 0) return { rights: NO_QUALITY_FIXTURE_RIGHTS, resolving: true, failed: false };
  const bootstrap = emails.some((e) => BOOTSTRAP_ADMINS.has(e.toLowerCase()));
  if (roles.isLoading || (!bootstrap && admins.isLoading)) {
    return { rights: NO_QUALITY_FIXTURE_RIGHTS, resolving: true, failed: false };
  }
  const isArcAdmin = isArcAdminFor(admins.data ?? [], emails);
  if (roles.isError) {
    return { rights: qualityFixtureRightsFrom([], { isArcAdmin }), resolving: false, failed: true };
  }
  return {
    rights: qualityFixtureRightsFrom(rolesFor(roles.data ?? [], emails), { isArcAdmin }),
    resolving: false,
    failed: false,
  };
}

/** The same answer inside a mutationFn, AWAITING the lists. Never `resolving`. */
export function useResolveQualityFixtureAccess(): () => Promise<QualityFixtureAccess> {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  const emailsRef = useRef(emails);
  emailsRef.current = emails;
  return useCallback(() => resolveQualityFixtureAccess(qc, emailsRef.current), [qc]);
}

export async function resolveQualityFixtureAccess(
  qc: QueryClient,
  emails: string[],
): Promise<QualityFixtureAccess> {
  if (emails.length === 0) return { rights: NO_QUALITY_FIXTURE_RIGHTS, resolving: false, failed: false };
  let admins: AdminEntry[] = [];
  try {
    admins = await qc.ensureQueryData({ queryKey: ADMINS_KEY, queryFn: listAdmins, staleTime: STALE_MS });
  } catch {
    // Only the roles-list right depends on this; bootstrap admins still count.
  }
  const isArcAdmin = isArcAdminFor(admins, emails);
  let entries: QualityFixtureRoleEntry[];
  try {
    entries = await qc.ensureQueryData({
      queryKey: QUALITY_FIXTURE_ROLES_KEY,
      queryFn: listQualityFixtureRoleEntries,
      staleTime: STALE_MS,
    });
  } catch {
    // A failed read REFUSES — granting on error would make every gate advisory.
    return { rights: qualityFixtureRightsFrom([], { isArcAdmin }), resolving: false, failed: true };
  }
  return {
    rights: qualityFixtureRightsFrom(rolesFor(entries, emails), { isArcAdmin }),
    resolving: false,
    failed: false,
  };
}

// -----------------------------------------------------------------------------
// Roles list writes — a Fixture Log admin or an ARC admin, asked inside every write.
// -----------------------------------------------------------------------------

function rolesError(action: string) {
  return (err: unknown) =>
    pushToast({
      message: describeListWriteFailure(err, { action, site: SITE_LABEL, permission: "editing" }),
      variant: "error",
    });
}

export function useCreateQualityFixtureRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolveQualityFixtureAccess();
  return useMutation({
    mutationFn: async (input: QualityFixtureRoleInput) => {
      requireQualityFixtureGate(manageFixtureRolesGate(await resolve()));
      const email = input.email.trim().toLowerCase();
      const current = qc.getQueryData<QualityFixtureRoleEntry[]>(QUALITY_FIXTURE_ROLES_KEY) ?? [];
      if (current.some((e) => e.email === email)) {
        throw new Error(`${email} is already on the Quality Fixture Roles list.`);
      }
      return createQualityFixtureRoleEntry(input);
    },
    onSuccess: (created) =>
      qc.setQueryData<QualityFixtureRoleEntry[]>(QUALITY_FIXTURE_ROLES_KEY, (old) =>
        old ? [...old, created] : [created],
      ),
    onError: rolesError("add that person"),
    onSettled: () => qc.invalidateQueries({ queryKey: QUALITY_FIXTURE_ROLES_KEY }),
  });
}

export function useUpdateQualityFixtureRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolveQualityFixtureAccess();
  return useMutation({
    mutationFn: async (input: { id: number; roles?: QualityFixtureRole[]; note?: string }) => {
      requireQualityFixtureGate(manageFixtureRolesGate(await resolve()));
      return updateQualityFixtureRoleEntry(input);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: QUALITY_FIXTURE_ROLES_KEY });
      const previous = qc.getQueryData<QualityFixtureRoleEntry[]>(QUALITY_FIXTURE_ROLES_KEY);
      qc.setQueryData<QualityFixtureRoleEntry[]>(QUALITY_FIXTURE_ROLES_KEY, (old) =>
        old?.map((e) =>
          e.id === input.id
            ? { ...e, ...(input.roles && { roles: input.roles }), ...(input.note !== undefined && { note: input.note }) }
            : e,
        ),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUALITY_FIXTURE_ROLES_KEY, ctx.previous);
      rolesError("update that person's roles")(err);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUALITY_FIXTURE_ROLES_KEY }),
  });
}

export function useDeleteQualityFixtureRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolveQualityFixtureAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requireQualityFixtureGate(manageFixtureRolesGate(await resolve()));
      return deleteQualityFixtureRoleEntry(id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: QUALITY_FIXTURE_ROLES_KEY });
      const previous = qc.getQueryData<QualityFixtureRoleEntry[]>(QUALITY_FIXTURE_ROLES_KEY);
      qc.setQueryData<QualityFixtureRoleEntry[]>(QUALITY_FIXTURE_ROLES_KEY, (old) =>
        old?.filter((e) => e.id !== id),
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUALITY_FIXTURE_ROLES_KEY, ctx.previous);
      pushToast({
        message: describeListWriteFailure(err, { action: "remove that person", site: SITE_LABEL }),
        variant: "error",
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUALITY_FIXTURE_ROLES_KEY }),
  });
}
