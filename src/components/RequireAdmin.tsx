import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAdmins } from "@/hooks/useAdmins";
import { BOOTSTRAP_ADMINS, isAdminEmail } from "@/lib/adminAccess";

/**
 * Route guard for the /admin/* pages. Non-admins are redirected to the
 * dashboard so they never see the admin page at all (not even a
 * "not authorised" notice).
 *
 * The Admins list loads asynchronously, so a non-bootstrap admin would read
 * as "not an admin" for a beat on first load. To avoid bouncing a legitimate
 * admin home during that window, we only redirect once the list has resolved.
 * Bootstrap admins (e.g. the app maintainer) pass immediately regardless of
 * the list, so they can never be locked out.
 *
 * This is UX/navigation gating — the real security boundary is SharePoint
 * per-list permissions plus the mutation guards in useAdmins / useEirRoles.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const { data: admins = [], isLoading } = useAdmins();

  const email = (user.email ?? "").toLowerCase();
  const isBootstrap = BOOTSTRAP_ADMINS.has(email);

  // Still resolving the Admins list and we can't yet rule the user in via the
  // bootstrap set — hold rather than redirect, so a real admin isn't bounced.
  if (!isBootstrap && isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center text-sm text-fg-muted">
        Checking access…
      </div>
    );
  }

  if (!isAdminEmail(user.email, admins)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
