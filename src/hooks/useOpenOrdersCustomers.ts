import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOpenOrdersCustomer,
  deleteOpenOrdersCustomer,
  listOpenOrdersCustomers,
  updateOpenOrdersCustomer,
} from "@/api/openOrdersCustomers";
import {
  createOpenOrdersRole,
  deleteOpenOrdersRole,
  listOpenOrdersRoles,
  updateOpenOrdersRole,
} from "@/api/openOrdersRoles";
import { OPEN_ORDERS_ROLES_ENFORCED } from "@/api/config";
import type {
  OpenOrderCustomerAccountInput,
  OpenOrdersRoleEntry,
} from "@/types/task";
import { matchesAnyEmail } from "@/lib/emailIdentity";
import { useCurrentUserEmails } from "./useCurrentUser";
import { useAdminAccess } from "./useIsAdmin";
import { pushToast } from "@/components/Toast";

// =============================================================================
// The managed customer list, and who may change it.
//
// Editing is gated the way EIR fields are gated — a role tag on a list, not a
// group membership — plus admins, who can always fix a list nobody else can
// reach. Every mutation re-checks the permission in its own `mutationFn` as
// well as the view hiding the controls: the same defence-in-depth as
// useCsaListings / useAdmins, so a future bulk action can't write without the
// check. It remains UI-level gating; SharePoint's list permission is the real
// boundary.
// =============================================================================

export const OPEN_ORDERS_CUSTOMERS_KEY = ["openOrdersCustomers"] as const;
export const OPEN_ORDERS_ROLES_KEY = ["openOrdersRoles"] as const;

export function useOpenOrdersCustomers() {
  return useQuery({
    queryKey: OPEN_ORDERS_CUSTOMERS_KEY,
    queryFn: listOpenOrdersCustomers,
    staleTime: 60_000,
  });
}

export function useOpenOrdersRoles() {
  return useQuery({
    queryKey: OPEN_ORDERS_ROLES_KEY,
    queryFn: listOpenOrdersRoles,
    staleTime: 60_000,
  });
}

export interface MyOpenOrdersAccess {
  /** May edit the customer list and run the weekly generation. */
  isReportManager: boolean;
  /** False while the roles list isn't configured — gating is off, not denied. */
  enforced: boolean;
  /** True until the roles and admin lookups have settled. */
  isResolving: boolean;
}

/**
 * What the signed-in user may do here.
 *
 * Two things this deliberately does:
 *
 *  - **Admins always count.** A roles list that nobody with the role can reach
 *    is a locked door with the key inside; an admin can always add the first
 *    report manager.
 *  - **`isResolving` is reported** rather than defaulting to "no". A screen
 *    that says "you don't have access" for a second before the lists load
 *    reads as a refusal, and people stop trying. Same reason
 *    `useAdminAccess` exposes it.
 */
export function useMyOpenOrdersAccess(): MyOpenOrdersAccess {
  const emails = useCurrentUserEmails();
  const { data: entries = [], isLoading: rolesLoading } = useOpenOrdersRoles();
  const { isAdmin, isResolving: adminResolving } = useAdminAccess();

  if (!OPEN_ORDERS_ROLES_ENFORCED) {
    return { isReportManager: true, enforced: false, isResolving: false };
  }

  // Matched on ADDRESS across every address the account carries — never on a
  // display name, and never on the sign-in name alone. See lib/emailIdentity.ts
  // and the Steven Pirko note in useMyEirRoles.
  const mine = entries.find((e) => matchesAnyEmail(emails, e.email));
  return {
    isReportManager: isAdmin || (mine?.roles.includes("report manager") ?? false),
    enforced: true,
    isResolving: rolesLoading || adminResolving,
  };
}

function useGuard() {
  const { isReportManager } = useMyOpenOrdersAccess();
  return () => {
    if (!isReportManager) {
      throw new Error(
        "Only an Open Orders report manager can change the customer list. " +
          "Ask an admin to add you at Admin → Open Orders Roles.",
      );
    }
  };
}

export function useCreateOpenOrdersCustomer() {
  const qc = useQueryClient();
  const guard = useGuard();
  return useMutation({
    mutationFn: (input: OpenOrderCustomerAccountInput) => {
      guard();
      return createOpenOrdersCustomer(input);
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: OPEN_ORDERS_CUSTOMERS_KEY });
      pushToast({ message: `Added ${created.customerName || created.accountNumber}.` });
    },
    onError: (err: Error) => pushToast({ message: err.message, variant: "error" }),
  });
}

export function useUpdateOpenOrdersCustomer() {
  const qc = useQueryClient();
  const guard = useGuard();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: OpenOrderCustomerAccountInput }) => {
      guard();
      return updateOpenOrdersCustomer(id, input);
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: OPEN_ORDERS_CUSTOMERS_KEY });
      pushToast({ message: `Saved ${updated.customerName || updated.accountNumber}.` });
    },
    onError: (err: Error) => pushToast({ message: err.message, variant: "error" }),
  });
}

export function useDeleteOpenOrdersCustomer() {
  const qc = useQueryClient();
  const guard = useGuard();
  return useMutation({
    mutationFn: (id: number) => {
      guard();
      return deleteOpenOrdersCustomer(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OPEN_ORDERS_CUSTOMERS_KEY });
      pushToast({ message: "Removed from the report list." });
    },
    onError: (err: Error) => pushToast({ message: err.message, variant: "error" }),
  });
}

// -----------------------------------------------------------------------------
// The roles list itself — admin-only, exactly like /admin/eir-roles.
// -----------------------------------------------------------------------------

function useAdminGuard() {
  const { isAdmin } = useAdminAccess();
  return () => {
    if (!isAdmin) throw new Error("Only an admin can change the Open Orders roles.");
  };
}

export function useCreateOpenOrdersRole() {
  const qc = useQueryClient();
  const guard = useAdminGuard();
  return useMutation({
    mutationFn: (entry: Omit<OpenOrdersRoleEntry, "id">) => {
      guard();
      return createOpenOrdersRole(entry);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: OPEN_ORDERS_ROLES_KEY }),
    onError: (err: Error) => pushToast({ message: err.message, variant: "error" }),
  });
}

export function useUpdateOpenOrdersRole() {
  const qc = useQueryClient();
  const guard = useAdminGuard();
  return useMutation({
    mutationFn: ({ id, entry }: { id: number; entry: Omit<OpenOrdersRoleEntry, "id"> }) => {
      guard();
      return updateOpenOrdersRole(id, entry);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: OPEN_ORDERS_ROLES_KEY }),
    onError: (err: Error) => pushToast({ message: err.message, variant: "error" }),
  });
}

export function useDeleteOpenOrdersRole() {
  const qc = useQueryClient();
  const guard = useAdminGuard();
  return useMutation({
    mutationFn: (id: number) => {
      guard();
      return deleteOpenOrdersRole(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: OPEN_ORDERS_ROLES_KEY }),
    onError: (err: Error) => pushToast({ message: err.message, variant: "error" }),
  });
}
