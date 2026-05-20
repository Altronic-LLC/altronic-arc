import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteAttachment,
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: attachmentsKey(parent, itemId ?? 0) });
    },
  });
}
