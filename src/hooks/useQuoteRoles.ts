import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createQuoteRoleEntry,
  deleteQuoteRoleEntry,
  listQuoteRoleEntries,
  updateQuoteRoleEntry,
} from "@/api/quoteRoles";
import { listAdmins } from "@/api/admins";
import { SP_QUOTE_ROLES_LIST_ID, USE_MOCK } from "@/api/config";
import type { AdminEntry } from "@/types/task";
import type { QuoteRole, QuoteRoleEntry } from "@/types/quote";
import type { QuoteRoleInput } from "@/lib/quoteMapper";
import { BOOTSTRAP_ADMINS } from "@/lib/adminAccess";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import {
  manageRolesGate,
  quoteRightsFrom,
  type QuoteAccess,
  type QuoteGate,
} from "@/lib/quoteRoles";
import { ADMINS_KEY, useAdmins } from "./useAdmins";
import { useCurrentUserEmails } from "./useCurrentUser";

// =============================================================================
// Quote Roles — who may see and work Insourcing Quotes, and what the signed-in
// user may do.
//
// Two jobs, the Parts Roles arrangement:
//   1. The roles admin screen's CRUD, every write gated by `manageRolesGate`
//      INSIDE its mutationFn (a quote manager, or an ARC admin).
//   2. "What can I do" — `useMyQuoteAccess` for rendering, and
//      `useResolveQuoteAccess` for a mutationFn, which AWAITS the roles and
//      Admins lists rather than trusting a render-time flag (a real manager
//      reads as "nobody" for a beat while the list loads).
//
// UNSET MEANS NO ACCESS: with no Quote Roles list configured in real mode,
// nobody holds a role. Nobody could quote in ARC before this existed, so
// falling closed takes nothing away. An ARC admin is granted ONLY the right to
// manage the roles list (see lib/quoteRoles.ts).
// =============================================================================

export const QUOTE_ROLES_KEY = ["quote-roles", "list"] as const;

const STALE_MS = 60_000;

/** Is a Quote Roles list there to read? Mock mode always counts as configured. */
export function quoteRolesConfigured(): boolean {
  return USE_MOCK || !!SP_QUOTE_ROLES_LIST_ID;
}

const NO_RIGHTS = quoteRightsFrom([], { isArcAdmin: false });

/** The signed-in user's access, plus whether a roles list exists at all. */
export type MyQuoteAccess = QuoteAccess & { configured: boolean };

const UNCONFIGURED: MyQuoteAccess = {
  rights: NO_RIGHTS,
  resolving: false,
  failed: false,
  configured: false,
};

/** Throw the gate's own words when it refuses — the one shape every mutationFn uses. */
export function requireQuoteGate(gate: QuoteGate): void {
  if (!gate.allowed) throw new Error(gate.hint);
}

function rolesFor(entries: QuoteRoleEntry[], emails: string[]): QuoteRole[] {
  // Matched on ADDRESS against every address the account carries — a sign-in
  // name is not a mailbox in this tenant (lib/emailIdentity.ts).
  return entries.find((e) => matchesAnyEmail(emails, e.email))?.roles ?? [];
}

function isArcAdminFor(admins: AdminEntry[], emails: string[]): boolean {
  if (emails.some((e) => BOOTSTRAP_ADMINS.has(e.toLowerCase()))) return true;
  return admins.some((a) => matchesAnyEmail(emails, a.email));
}

// -----------------------------------------------------------------------------
// The list
// -----------------------------------------------------------------------------

export function useQuoteRoleEntries() {
  return useQuery<QuoteRoleEntry[]>({
    queryKey: QUOTE_ROLES_KEY,
    queryFn: listQuoteRoleEntries,
    staleTime: STALE_MS,
  });
}

// -----------------------------------------------------------------------------
// The signed-in user's access
// -----------------------------------------------------------------------------

/** For rendering — feed it to the gates in lib/quoteRoles.ts. */
export function useMyQuoteAccess(): MyQuoteAccess {
  const emails = useCurrentUserEmails();
  const roles = useQuoteRoleEntries();
  const admins = useAdmins();
  if (!quoteRolesConfigured()) return UNCONFIGURED;

  const bootstrap = emails.some((e) => BOOTSTRAP_ADMINS.has(e.toLowerCase()));
  // No address yet means we don't know who this is — not that they're nobody.
  const resolving = roles.isLoading || emails.length === 0 || (!bootstrap && admins.isLoading);
  if (resolving) return { rights: NO_RIGHTS, resolving: true, failed: false, configured: true };
  if (roles.isError) return { rights: NO_RIGHTS, resolving: false, failed: true, configured: true };

  // A failed Admins read only costs the admin's roles-list right; bootstrap
  // admins still count.
  const isArcAdmin = isArcAdminFor(admins.data ?? [], emails);
  return {
    rights: quoteRightsFrom(rolesFor(roles.data ?? [], emails), { isArcAdmin }),
    resolving: false,
    failed: false,
    configured: true,
  };
}

/**
 * The same answer inside a mutationFn, AWAITING the roles and Admins lists.
 * Never `resolving`: by the time it returns, both have answered or failed.
 */
export function useResolveQuoteAccess(): () => Promise<QuoteAccess> {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  // A ref so a callback captured early still reads the addresses /me added.
  const emailsRef = useRef(emails);
  emailsRef.current = emails;
  return useCallback(() => resolveQuoteAccess(qc, emailsRef.current), [qc]);
}

/** The plumbing behind `useResolveQuoteAccess` — exported for tests. */
export async function resolveQuoteAccess(qc: QueryClient, emails: string[]): Promise<QuoteAccess> {
  if (!quoteRolesConfigured()) return { rights: NO_RIGHTS, resolving: false, failed: false };

  let entries: QuoteRoleEntry[];
  try {
    entries = await qc.ensureQueryData({
      queryKey: QUOTE_ROLES_KEY,
      queryFn: listQuoteRoleEntries,
      staleTime: STALE_MS,
    });
  } catch {
    // A failed read REFUSES the write — the gate says it couldn't check.
    // Granting on error would make every gate advisory.
    return { rights: NO_RIGHTS, resolving: false, failed: true };
  }

  let admins: AdminEntry[] = [];
  try {
    admins = await qc.ensureQueryData({ queryKey: ADMINS_KEY, queryFn: listAdmins, staleTime: STALE_MS });
  } catch {
    // Only the roles-list right depends on this; bootstrap admins still count.
  }

  return {
    rights: quoteRightsFrom(rolesFor(entries, emails), { isArcAdmin: isArcAdminFor(admins, emails) }),
    resolving: false,
    failed: false,
  };
}

// -----------------------------------------------------------------------------
// Roles admin CRUD — a quote manager OR an ARC admin, asked inside every write.
// -----------------------------------------------------------------------------

export function useCreateQuoteRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async (input: QuoteRoleInput) => {
      requireQuoteGate(manageRolesGate(await resolve()));
      return createQuoteRoleEntry(input);
    },
    onSuccess: (created) =>
      qc.setQueryData<QuoteRoleEntry[]>(QUOTE_ROLES_KEY, (old) => (old ? [...old, created] : [created])),
    onSettled: () => qc.invalidateQueries({ queryKey: QUOTE_ROLES_KEY }),
  });
}

export interface QuoteRoleUpdate {
  id: number;
  displayName?: string;
  roles?: QuoteRole[];
  note?: string;
}

export function useUpdateQuoteRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async (input: QuoteRoleUpdate) => {
      requireQuoteGate(manageRolesGate(await resolve()));
      return updateQuoteRoleEntry(input);
    },
    // Optimistic — a tick lands at once and is restored on error.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: QUOTE_ROLES_KEY });
      const previous = qc.getQueryData<QuoteRoleEntry[]>(QUOTE_ROLES_KEY);
      qc.setQueryData<QuoteRoleEntry[]>(QUOTE_ROLES_KEY, (old) =>
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
      if (ctx?.previous) qc.setQueryData(QUOTE_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUOTE_ROLES_KEY }),
  });
}

export function useDeleteQuoteRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolveQuoteAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requireQuoteGate(manageRolesGate(await resolve()));
      return deleteQuoteRoleEntry(id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: QUOTE_ROLES_KEY });
      const previous = qc.getQueryData<QuoteRoleEntry[]>(QUOTE_ROLES_KEY);
      qc.setQueryData<QuoteRoleEntry[]>(QUOTE_ROLES_KEY, (old) => old?.filter((e) => e.id !== id));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUOTE_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUOTE_ROLES_KEY }),
  });
}
