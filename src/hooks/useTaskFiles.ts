import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  deleteTaskFile,
  listProjectFolders,
  listTaskFiles,
  resolveFolderForProject,
  uploadTaskFile,
  type ProjectFile,
  type ProjectFolder,
  type ResolvedFolder,
} from "@/api/projectFiles";
import {
  deleteAttachment,
  listAttachments,
  uploadAttachment,
  type ListAttachment,
} from "@/api/attachments";
import { useProjects } from "@/hooks/useTasks";
import type { Task } from "@/types/task";

const FOLDERS_KEY = ["project-files", "folders"] as const;
const filesKey = (taskId: number) => ["project-files", "for-task", taskId] as const;
const listAttachmentsKey = (taskId: number) =>
  ["list-attachments", "task", taskId] as const;

/** Cached list of every project folder + its tagged project lookupId. */
export function useProjectFolders() {
  return useQuery<ProjectFolder[]>({
    queryKey: FOLDERS_KEY,
    queryFn: listProjectFolders,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * Returns the resolved folder for this task (project folder if matched,
 * otherwise the Miscellaneous folder + filename prefix). Memoised so a
 * stable identity reaches the file-list / mutation hooks below.
 */
export function useResolvedTaskFolder(task: Task | null | undefined): {
  resolved: ResolvedFolder | null;
  isLoading: boolean;
  error: unknown;
} {
  const { data: folders = [], isLoading, error } = useProjectFolders();
  // Projects catalogue is a backup source for the project title when
  // the task's own parentProject.title came back blank (which left the
  // Misc filename without a prefix).
  const { data: projects = [] } = useProjects();
  const resolved = useMemo(() => {
    if (!task) return null;
    // If the task has no parent project, use its numbered title (e.g.
    // "T15-AMP-coil") as the misc prefix so the file is still
    // attributable to a specific task in SharePoint. NumberedTitle can
    // be empty on freshly-created tasks; fall back to the bare item id.
    const taskFallback =
      (task.numberedTitle && task.numberedTitle.trim()) || `T-${task.id}`;
    return resolveFolderForProject(folders, task.parentProject, projects, taskFallback);
  }, [folders, task, projects]);
  return { resolved, isLoading, error };
}

/** Top-N most-recently-modified files for the task's project folder. */
export function useTaskFiles(task: Task | null | undefined) {
  const { resolved } = useResolvedTaskFolder(task);
  return useQuery<ProjectFile[]>({
    queryKey: filesKey(task?.id ?? 0),
    queryFn: () => (resolved ? listTaskFiles(resolved) : Promise.resolve([])),
    enabled: !!task && !!resolved,
    retry: false,
  });
}

export function useUploadTaskFile(task: Task | null | undefined) {
  const qc = useQueryClient();
  const { resolved } = useResolvedTaskFolder(task);
  return useMutation({
    // Project folder is the source of truth (always returned). We ALSO
    // best-effort-write a list-item attachment so the file shows up on the
    // task itself in SharePoint — but if that path is unavailable (missing
    // AllSites.Manage scope, no SP_SITE_URL), we just log a warning and
    // keep going. The comment composer relies on this mutation returning
    // {name, webUrl}, so the project-folder upload has to be the contract.
    mutationFn: async (file: File) => {
      if (!resolved) throw new Error("No project folder resolved for this task yet.");
      const uploaded = await uploadTaskFile(resolved, file);
      if (task) {
        try {
          await uploadAttachment("task", task.id, file);
        } catch (err) {
          /* eslint-disable no-console */
          console.warn(
            "[useUploadTaskFile] List-item attachment upload failed " +
              "(project folder upload still succeeded):",
            err,
          );
          /* eslint-enable no-console */
        }
      }
      return uploaded;
    },
    onSuccess: () => {
      if (!task) return;
      qc.invalidateQueries({ queryKey: filesKey(task.id) });
      qc.invalidateQueries({ queryKey: listAttachmentsKey(task.id) });
    },
  });
}

export function useDeleteTaskFile(task: Task | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (driveItemId: string) => deleteTaskFile(driveItemId),
    onSuccess: () => {
      if (task) qc.invalidateQueries({ queryKey: filesKey(task.id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Task-specific (list-item) attachments — these are the "On this task" files
// shown above the project-folder files in TaskAttachmentsSection.
// ---------------------------------------------------------------------------

/**
 * SharePoint list-item attachments for this task. May be empty if the user's
 * Entra app doesn't have AllSites.Manage admin-consented yet — in that case
 * the query returns [] and we silently degrade to project-folder only.
 */
export function useTaskListAttachments(task: Task | null | undefined) {
  return useQuery<ListAttachment[]>({
    queryKey: listAttachmentsKey(task?.id ?? 0),
    queryFn: async () => {
      if (!task) return [];
      try {
        return await listAttachments("task", task.id);
      } catch (err) {
        // Don't break the rest of the page if SP REST is unavailable.
        /* eslint-disable no-console */
        console.warn("[useTaskListAttachments] list failed:", err);
        /* eslint-enable no-console */
        return [];
      }
    },
    enabled: !!task,
    retry: false,
  });
}

export function useDeleteTaskListAttachment(task: Task | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileName: string) => {
      if (!task) throw new Error("No task to delete attachment from.");
      return deleteAttachment("task", task.id, fileName);
    },
    onSuccess: () => {
      if (task) qc.invalidateQueries({ queryKey: listAttachmentsKey(task.id) });
    },
  });
}
