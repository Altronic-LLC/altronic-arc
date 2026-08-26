import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteAttachment,
  fetchAttachmentBlob,
  listAttachments,
  uploadAttachment,
  type AttachmentParent,
  type ListAttachment,
} from "@/api/attachments";

const attachmentsKey = (parent: AttachmentParent, itemId: number) =>
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
 * a plain SharePoint URL: an `<img>` fetch carries no Authorization header
 * and no SharePoint session cookie either, so it 401s and the browser shows
 * a broken-image icon. `fetchAttachmentBlob` does the same bearer-token
 * fetch every other SP REST call here uses; this just wraps it in a query.
 *
 * Object URLs are intentionally never revoked — these are small images
 * (a company logo), fetched at most once per session per file thanks to
 * `staleTime: Infinity`, so the leak is bounded by how many distinct logos
 * a session actually opens.
 */
export function useAttachmentBlobUrl(downloadUrl: string | undefined) {
  return useQuery({
    queryKey: ["attachment-blob-url", downloadUrl],
    queryFn: async () => URL.createObjectURL(await fetchAttachmentBlob(downloadUrl!)),
    enabled: !!downloadUrl,
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
