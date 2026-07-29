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

// =============================================================================
// CSA Listings hooks — queries + mutations for Engineering's CSA certification
// register. Standard per-list pattern: api/csaListings.ts owns the mock/real
// branch, these own caching and invalidation.
//
// Certification records change rarely, so the list is cached for longer than the
// task/log queries — there's nothing gained by re-fetching a register that moves
// a few times a year.
// =============================================================================

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
  return useMutation({
    mutationFn: (input: CsaListingInput) => createCsaListing(input),
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
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: CsaListingInput }) =>
      updateCsaListing(id, input),
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
  return useMutation({
    mutationFn: (id: number) => deleteCsaListing(id),
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
