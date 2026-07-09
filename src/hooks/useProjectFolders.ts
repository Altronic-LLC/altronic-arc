import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listProjectFolderEntries,
  uploadFileToFolder,
  type DriveEntry,
} from "@/api/projectFiles";
import { pushToast } from "@/components/Toast";

// =============================================================================
// Project Folders browser hooks. Entries for a folder are cached per folder id
// ("root" for the top level); uploads invalidate the folder they landed in.
// =============================================================================

const KEY = (folderId?: string) => ["project-folder-entries", folderId ?? "root"] as const;

export function useProjectFolderEntries(folderId?: string) {
  return useQuery<DriveEntry[]>({
    queryKey: KEY(folderId),
    queryFn: () => listProjectFolderEntries(folderId),
    staleTime: 60_000,
  });
}

export function useUploadToFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, file }: { folderId: string; file: File }) =>
      uploadFileToFolder(folderId, file),
    onSuccess: (entry, { folderId }) => {
      qc.invalidateQueries({ queryKey: KEY(folderId) });
      pushToast({ message: `Uploaded "${entry.name}".` });
    },
    onError: (err) => {
      const detail = err instanceof Error ? err.message : String(err);
      pushToast({ message: `Couldn't upload. ${detail.slice(0, 200)}`, variant: "error" });
    },
  });
}
