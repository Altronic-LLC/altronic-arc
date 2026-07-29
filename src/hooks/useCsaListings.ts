import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCsaListing,
  deleteCsaListing,
  listCsaListings,
  updateCsaListing,
} from "@/api/csaListings";
import type { CsaListing, CsaListingInput } from "@/types/task";
import { csaListingLabel } from "@/lib/csaListingMapper";
import { pushToast } from "@/components/Toast";
import { useIsAdmin } from "./useIsAdmin";

// =============================================================================
// CSA Listings hooks — queries + mutations for Engineering's CSA certification
// register. Standard per-list pattern: api/csaListings.ts owns the mock/real
// branch, these own caching and invalidation.
//
// Certification records change rarely, so the list is cached for longer than the
// task/log queries — there's nothing gained by re-fetching a register that moves
// a few times a year.
//
// WRITES ARE ADMIN-ONLY, guarded here as well as in the view. The view hides the
// controls; this stops any future call path — a new screen, a bulk action, a
// keyboard shortcut — from writing without the check. Same defence-in-depth
// pattern as useAdmins / useEirRoles. Reading stays open to everyone, and the
// real security boundary is still SharePoint's per-list permissions.
// =============================================================================

const ADMIN_ONLY = "Only admins can add, edit or delete CSA listings.";

export const CSA_LISTINGS_KEY = ["csaListings"] as const;

export function useCsaListings() {
  return useQuery({
    queryKey: CSA_LISTINGS_KEY,
    queryFn: listCsaListings,
    staleTime: 5 * 60_000,
  });
}

export function useCreateCsaListing() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (input: CsaListingInput) => {
      if (!isAdmin) throw new Error(ADMIN_ONLY);
      return createCsaListing(input);
    },
    onSuccess: (created) => {
      pushToast({ message: `Added ${csaListingLabel(created)}` });
      qc.invalidateQueries({ queryKey: CSA_LISTINGS_KEY });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't add the listing: ${err.message}`, variant: "error" });
    },
  });
}

export function useUpdateCsaListing() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: CsaListingInput }) => {
      if (!isAdmin) throw new Error(ADMIN_ONLY);
      return updateCsaListing(id, input);
    },
    onSuccess: (updated) => {
      // Patch in place so the table reflects the edit immediately, keeping the
      // fields a PATCH can't return (createdAt, csaId, hasAttachments) from the
      // already-loaded row.
      qc.setQueryData<CsaListing[]>(CSA_LISTINGS_KEY, (prev) =>
        prev?.map((l) =>
          l.id === updated.id
            ? {
                ...updated,
                createdAt: l.createdAt,
                csaId: l.csaId,
                hasAttachments: l.hasAttachments,
              }
            : l,
        ),
      );
      pushToast({ message: `Saved ${csaListingLabel(updated)}` });
      qc.invalidateQueries({ queryKey: CSA_LISTINGS_KEY });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't save the listing: ${err.message}`, variant: "error" });
    },
  });
}

export function useDeleteCsaListing() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  return useMutation({
    mutationFn: (id: number) => {
      if (!isAdmin) throw new Error(ADMIN_ONLY);
      return deleteCsaListing(id);
    },
    onSuccess: (_void, id) => {
      qc.setQueryData<CsaListing[]>(CSA_LISTINGS_KEY, (prev) =>
        prev?.filter((l) => l.id !== id),
      );
      pushToast({ message: "Listing deleted" });
      qc.invalidateQueries({ queryKey: CSA_LISTINGS_KEY });
    },
    onError: (err: Error) => {
      pushToast({ message: `Couldn't delete the listing: ${err.message}`, variant: "error" });
    },
  });
}
