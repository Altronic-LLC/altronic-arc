import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteAttachment,
  fetchAttachmentBlob,
  listAttachments,
  uploadAttachment,
  type AttachmentParent,
  type ListAttachment,
} from "@/api/attachments";

// Exported so a mutation that writes an attachment OUTSIDE this hook file
// (e.g. `useUpdateSupplierLogo`, which uploads via `updateSupplierLogo`
// rather than `useUploadAttachment`) can invalidate the right query — the
// Logo card and the Attachments card would otherwise disagree about whether
// a new logo attachment exists until something else happened to refetch.
export const attachmentsKey = (parent: AttachmentParent, itemId: number) =>
  ["attachments", parent, itemId] as const;

export function useAttachments(parent: AttachmentParent, itemId: number | null) {
  return useQuery<ListAttachment[]>({
    queryKey: attachmentsKey(parent, itemId ?? 0),
    queryFn: () => listAttachments(parent, itemId!),
    enabled: itemId != null,
    // Surface SharePoint REST errors directly to the UI — the section
    // shows a friendly "unavailable" hint when listAttachments throws.
    retry: false,
  });
}

/**
 * Load an attachment's bytes as a browser object URL — for embedding as
 * `<img src>`, which (unlike a click-through "Download" link) can't rely on
 * the plain `ServerRelativeUrl` file link `useAttachments` returns: that
 * link 401s from an `<img>` fetch (no auth header, no session cookie) and,
 * even routed through an authenticated fetch, fails CORS (it's a raw file
 * link, not an `_api/` REST call). `fetchAttachmentBlob` takes
 * (parent, itemId, fileName) rather than a URL for exactly that reason — it
 * builds the `_api/.../$value` OData download path instead. See its doc
 * comment in api/attachments.ts for the two-bugs history.
 *
 * Object URLs are intentionally never revoked — these are small images
 * (a company logo), fetched at most once per session per file thanks to
 * `staleTime: Infinity`, so the leak is bounded by how many distinct logos
 * a session actually opens.
 */
export function useAttachmentBlobUrl(
  parent: AttachmentParent,
  itemId: number | undefined,
  fileName: string | undefined,
) {
  return useQuery({
    queryKey: ["attachment-blob-url", parent, itemId, fileName],
    queryFn: async () => URL.createObjectURL(await fetchAttachmentBlob(parent, itemId!, fileName!)),
    enabled: itemId != null && !!fileName,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}

export function useUploadAttachment(parent: AttachmentParent, itemId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      if (itemId == null) throw new Error("No item id");
      return uploadAttachment(parent, itemId, file);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: attachmentsKey(parent, itemId ?? 0) });
    },
  });
}

export function useDeleteAttachment(parent: AttachmentParent, itemId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileName: string) => {
      if (itemId == null) throw new Error("No item id");
      return deleteAttachment(parent, itemId, fileName);
    },
    // Optimistic: the row disappears immediately; restored on error.
    onMutate: async (fileName) => {
      const key = attachmentsKey(parent, itemId ?? 0);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ListAttachment[]>(key);
      qc.setQueryData<ListAttachment[]>(key, (old) =>
        old?.filter((a) => a.fileName !== fileName),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(attachmentsKey(parent, itemId ?? 0), ctx.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: attachmentsKey(parent, itemId ?? 0) });
    },
  });
}
