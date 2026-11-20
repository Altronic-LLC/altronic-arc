import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createPricingRoleEntry,
  deletePricingRoleEntry,
  listPricingRoleEntries,
  updatePricingRoleEntry,
} from "@/api/pricingRoles";
import { listAdmins } from "@/api/admins";
import { PRICING_LIVE, PRICING_PREVIEW_USERS } from "@/api/config";
import type { AdminEntry } from "@/types/task";
import type { PricingRole, PricingRoleEntry } from "@/types/pricing";
import type { PricingRoleInput } from "@/lib/pricingMapper";
import { BOOTSTRAP_ADMINS } from "@/lib/adminAccess";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import { parseRecipientList } from "@/lib/recipientList";
import {
  NO_PRICING_RIGHTS,
  managePricingRolesGate,
  previewAllows,
  pricingRightsFrom,
  type PricingAccess,
  type PricingGate,
} from "@/lib/pricingRoles";
import { ADMINS_KEY, useAdmins } from "./useAdmins";
import { useCurrentUserEmails } from "./useCurrentUser";

// =============================================================================
// Pricing Roles — who may use Sales Pricing, and what the signed-in user may do.
//
// Two jobs, the Quote Roles arrangement:
//   1. The roles screen's CRUD, every write gated by `managePricingRolesGate`
//      INSIDE its mutationFn.
//   2. "What can I do" — `useMyPricingAccess` for rendering, and
//      `useResolvePricingAccess` for a mutationFn, which AWAITS the roles and
//      Admins lists rather than trusting a render-time flag.
//
// THE PREVIEW SWITCH SITS IN FRONT OF BOTH. While PRICING_LIVE is off, an
// address not in PRICING_PREVIEW_USERS has NO rights — whatever the roles list
// says, ARC admins included (Ray, 2026-10-13: exclusive access to review it).
// =============================================================================

export const PRICING_ROLES_KEY = ["pricing-roles", "list"] as const;

const STALE_MS = 60_000;

const PREVIEW_EMAILS = parseRecipientList(PRICING_PREVIEW_USERS).map((p) => p.email ?? "");

/** True when the preview switch lets these addresses in. */
export function pricingPreviewAllows(emails: string[]): boolean {
  return previewAllows({ live: PRICING_LIVE, previewEmails: PREVIEW_EMAILS, myEmails: emails });
}

/** The signed-in user's access, plus whether the preview switch is what refused them. */
export type MyPricingAccess = PricingAccess & { inPreviewOnly: boolean };

export function requirePricingGate(gate: PricingGate): void {
  if (!gate.allowed) throw new Error(gate.hint);
}

function rolesFor(entries: PricingRoleEntry[], emails: string[]): PricingRole[] {
  // Matched on ADDRESS against every address the account carries — a sign-in
  // name is not a mailbox in this tenant (lib/emailIdentity.ts).
  return entries.find((e) => matchesAnyEmail(emails, e.email))?.roles ?? [];
}

function isArcAdminFor(admins: AdminEntry[], emails: string[]): boolean {
  if (emails.some((e) => BOOTSTRAP_ADMINS.has(e.toLowerCase()))) return true;
  return admins.some((a) => matchesAnyEmail(emails, a.email));
}

export function usePricingRoleEntries(enabled = true) {
  return useQuery<PricingRoleEntry[]>({
    queryKey: PRICING_ROLES_KEY,
    queryFn: listPricingRoleEntries,
    staleTime: STALE_MS,
    enabled,
  });
}

/** For rendering — feed it to the gates in lib/pricingRoles.ts. */
export function useMyPricingAccess(): MyPricingAccess {
  const emails = useCurrentUserEmails();
  const previewOk = emails.length > 0 && pricingPreviewAllows(emails);
  // Somebody the preview keeps out never fetches the roles list at all.
  const roles = usePricingRoleEntries(previewOk);
  const admins = useAdmins();

  if (emails.length === 0) return { rights: NO_PRICING_RIGHTS, resolving: true, failed: false, inPreviewOnly: false };
  if (!previewOk) return { rights: NO_PRICING_RIGHTS, resolving: false, failed: false, inPreviewOnly: true };

  const bootstrap = emails.some((e) => BOOTSTRAP_ADMINS.has(e.toLowerCase()));
  if (roles.isLoading || (!bootstrap && admins.isLoading)) {
    return { rights: NO_PRICING_RIGHTS, resolving: true, failed: false, inPreviewOnly: false };
  }
  if (roles.isError) return { rights: NO_PRICING_RIGHTS, resolving: false, failed: true, inPreviewOnly: false };
  return {
    rights: pricingRightsFrom(rolesFor(roles.data ?? [], emails), {
      isArcAdmin: isArcAdminFor(admins.data ?? [], emails),
    }),
    resolving: false,
    failed: false,
    inPreviewOnly: false,
  };
}

/** The same answer inside a mutationFn, AWAITING the lists. Never `resolving`. */
export function useResolvePricingAccess(): () => Promise<PricingAccess> {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  const emailsRef = useRef(emails);
  emailsRef.current = emails;
  return useCallback(() => resolvePricingAccess(qc, emailsRef.current), [qc]);
}

/** The plumbing behind `useResolvePricingAccess` — exported for tests. */
export async function resolvePricingAccess(qc: QueryClient, emails: string[]): Promise<PricingAccess> {
  if (emails.length === 0 || !pricingPreviewAllows(emails)) {
    return { rights: NO_PRICING_RIGHTS, resolving: false, failed: false };
  }
  let entries: PricingRoleEntry[];
  try {
    entries = await qc.ensureQueryData({ queryKey: PRICING_ROLES_KEY, queryFn: listPricingRoleEntries, staleTime: STALE_MS });
  } catch {
    // A failed read REFUSES — granting on error would make every gate advisory.
    return { rights: NO_PRICING_RIGHTS, resolving: false, failed: true };
  }
  let admins: AdminEntry[] = [];
  try {
    admins = await qc.ensureQueryData({ queryKey: ADMINS_KEY, queryFn: listAdmins, staleTime: STALE_MS });
  } catch {
    // Only the roles-list right depends on this; bootstrap admins still count.
  }
  return {
    rights: pricingRightsFrom(rolesFor(entries, emails), { isArcAdmin: isArcAdminFor(admins, emails) }),
    resolving: false,
    failed: false,
  };
}

/** The roles list as it stands NOW — the email recipients are read from it at send time. */
export function readPricingRoles(qc: QueryClient): Promise<PricingRoleEntry[]> {
  return qc.ensureQueryData({ queryKey: PRICING_ROLES_KEY, queryFn: listPricingRoleEntries, staleTime: STALE_MS });
}

// -----------------------------------------------------------------------------
// Roles CRUD — a pricing admin or an ARC admin, asked inside every write.
// -----------------------------------------------------------------------------

export function useCreatePricingRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async (input: PricingRoleInput) => {
      requirePricingGate(managePricingRolesGate(await resolve()));
      return createPricingRoleEntry(input);
    },
    onSuccess: (created) =>
      qc.setQueryData<PricingRoleEntry[]>(PRICING_ROLES_KEY, (old) => (old ? [...old, created] : [created])),
    onSettled: () => qc.invalidateQueries({ queryKey: PRICING_ROLES_KEY }),
  });
}

export interface PricingRoleUpdate {
  id: number;
  displayName?: string;
  roles?: PricingRole[];
  note?: string;
}

export function useUpdatePricingRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async (input: PricingRoleUpdate) => {
      requirePricingGate(managePricingRolesGate(await resolve()));
      return updatePricingRoleEntry(input);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: PRICING_ROLES_KEY });
      const previous = qc.getQueryData<PricingRoleEntry[]>(PRICING_ROLES_KEY);
      qc.setQueryData<PricingRoleEntry[]>(PRICING_ROLES_KEY, (old) =>
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
      if (ctx?.previous) qc.setQueryData(PRICING_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PRICING_ROLES_KEY }),
  });
}

export function useDeletePricingRoleEntry() {
  const qc = useQueryClient();
  const resolve = useResolvePricingAccess();
  return useMutation({
    mutationFn: async (id: number) => {
      requirePricingGate(managePricingRolesGate(await resolve()));
      return deletePricingRoleEntry(id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: PRICING_ROLES_KEY });
      const previous = qc.getQueryData<PricingRoleEntry[]>(PRICING_ROLES_KEY);
      qc.setQueryData<PricingRoleEntry[]>(PRICING_ROLES_KEY, (old) => old?.filter((e) => e.id !== id));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(PRICING_ROLES_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PRICING_ROLES_KEY }),
  });
}
