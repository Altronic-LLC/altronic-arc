import { useCurrentUser } from "./useCurrentUser";
import { useAdmins } from "./useAdmins";
import { BOOTSTRAP_ADMINS, isAdminEmail } from "@/lib/adminAccess";

/**
 * Returns true if the signed-in user is authorised to use the admin UI.
 * Reads from the Admins SharePoint list (managed at /admin/admins) with
 * the bootstrap set as a fallback. The actual predicate (bootstrap set +
 * list membership) lives in `@/lib/adminAccess` so the admin/user-list
 * mutation guards can share it.
 */
export function useIsAdmin(): boolean {
  return useAdminAccess().isAdmin;
}

/**
 * Like `useIsAdmin`, but also reports whether the answer is still settling.
 *
 * The Admins list loads asynchronously, so a non-bootstrap admin reads as "not
 * an admin" for a beat on first load. `useIsAdmin` alone can't distinguish
 * "definitely not an admin" from "don't know yet", which matters wherever the UI
 * would otherwise tell someone they lack access and then take it back a moment
 * later. Gate the controls on `isAdmin`, but only show a "limited to admins"
 * explanation once `isResolving` is false.
 *
 * Bootstrap admins are never "resolving" — they're admins regardless of the
 * list, so they can't be locked out by it failing to load.
 */
export function useAdminAccess(): { isAdmin: boolean; isResolving: boolean } {
  const user = useCurrentUser();
  const { data: admins = [], isLoading } = useAdmins();
  const isBootstrap = BOOTSTRAP_ADMINS.has((user.email ?? "").toLowerCase());
  return {
    isAdmin: isAdminEmail(user.email, admins),
    isResolving: !isBootstrap && isLoading,
  };
}
