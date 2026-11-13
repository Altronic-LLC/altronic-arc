import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listAdmins } from "@/api/admins";
import { isAdminEmail } from "@/lib/adminAccess";
import { ADMINS_KEY } from "./useAdmins";
import { useCurrentUserEmails } from "./useCurrentUser";
import { useIsAdmin } from "./useIsAdmin";

/**
 * Throws unless the signed-in user is an ARC admin — for use INSIDE a
 * mutationFn, so a gated write can't be reached from a screen that forgot to
 * grey its button.
 *
 * It AWAITS the Admins list rather than trusting the render-time flag: that
 * reads false while the list loads, which would refuse a real admin on first
 * paint (the Build Request production guard's lesson). Falls back to the
 * render-time answer only if the list can't be read at all.
 *
 * Shared by the Harness Production Log and Crimp Height Checks.
 */
export function useRequireArcAdmin(): (action: string) => Promise<void> {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  const renderTimeAdmin = useIsAdmin();
  const ref = useRef({ emails, renderTimeAdmin });
  ref.current = { emails, renderTimeAdmin };
  return useCallback(
    async (action: string) => {
      const admins = await qc
        .ensureQueryData({ queryKey: ADMINS_KEY, queryFn: listAdmins })
        .catch(() => null);
      const isAdmin = admins
        ? ref.current.emails.some((e) => isAdminEmail(e, admins))
        : ref.current.renderTimeAdmin;
      if (!isAdmin) throw new Error(`Only ARC admins can ${action}.`);
    },
    [qc],
  );
}
