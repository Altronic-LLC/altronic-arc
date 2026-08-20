import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createProjectFolder,
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

/**
 * Create a top-level project folder, tagged with its Project Reference.
 *
 * Invalidates the ROOT listing — new folders only ever land there, because
 * only top-level folders carry the project metadata that routes task uploads.
 */
export function useCreateProjectFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, projectLookupId }: { name: string; projectLookupId: number }) =>
      createProjectFolder(name, projectLookupId),
    onSuccess: (entry) => {
      qc.invalidateQueries({ queryKey: KEY() });
      // The task-upload router keeps its own cached copy of the folder list
      // (useTaskFiles' FOLDERS_KEY) — without this, a task on the new project
      // would keep routing its uploads to Miscellaneous until that cache aged
      // out five minutes later.
      qc.invalidateQueries({ queryKey: ["project-files", "folders"] });
      pushToast({ message: `Created "${entry.name}".` });
    },
    onError: (err) => {
      const detail = err instanceof Error ? err.message : String(err);
      pushToast({ message: `Couldn't create the folder. ${detail.slice(0, 300)}`, variant: "error" });
    },
  });
}
