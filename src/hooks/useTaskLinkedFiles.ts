import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  linkTaskFiles,
  lookUpLinkedFile,
  readTaskLinkedFiles,
  unlinkTaskFile,
  type LinkedFileState,
} from "@/api/taskLinkedFiles";
import type { LinkedFile, ParsedLinkedFiles, PickedLibraryFile } from "@/lib/linkedFiles";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { pushToast } from "@/components/Toast";
import { useCurrentUser } from "./useCurrentUser";

// =============================================================================
// Files linked to an Engineering task from the project-folder library
// (BusinessIT#62) — see api/taskLinkedFiles.ts. A link is a pointer: linking
// copies nothing, and unlinking never deletes the file.
// =============================================================================

export const linkedFilesKey = (taskId: number) => ["task-linked-files", taskId] as const;
const fileStateKey = (fileId: string) => ["linked-file-state", fileId] as const;

/** One task's linked files. `error` is the column-missing case among others. */
export function useTaskLinkedFiles(taskId: number | null | undefined) {
  return useQuery<ParsedLinkedFiles>({
    queryKey: linkedFilesKey(taskId ?? 0),
    queryFn: () => readTaskLinkedFiles(taskId as number),
    enabled: !!taskId,
    retry: false,
  });
}

/**
 * Each linked file as SharePoint has it NOW — renamed, moved, or gone. One
 * small read per file, cached for five minutes; a failed read leaves that
 * file's stored details showing.
 */
export function useLinkedFileStates(files: LinkedFile[]): Map<string, LinkedFileState> {
  const results = useQueries({
    queries: files.map((f) => ({
      queryKey: fileStateKey(f.id),
      queryFn: () => lookUpLinkedFile(f.id),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });
  const states = new Map<string, LinkedFileState>();
  files.forEach((f, i) => {
    const data = results[i]?.data;
    if (data) states.set(f.id, data);
  });
  return states;
}

const SITE = "Altronic_Engineering";

/** Link files picked in the library to the task. */
export function useLinkTaskFiles(taskId: number | null | undefined) {
  const qc = useQueryClient();
  const me = useCurrentUser();
  return useMutation({
    mutationFn: (picked: PickedLibraryFile[]) => {
      if (!taskId) throw new Error("No task to link the files to.");
      return linkTaskFiles(taskId, picked, { name: me.displayName, email: me.email ?? "" });
    },
    onSuccess: (files, picked) => {
      if (!taskId) return;
      qc.setQueryData<ParsedLinkedFiles>(linkedFilesKey(taskId), { files, corrupt: false });
      const names = picked.map((p) => `"${p.name}"`);
      pushToast({
        message:
          picked.length === 1
            ? `Linked ${names[0]} — it stays where it is in SharePoint.`
            : `Linked ${picked.length} files — they stay where they are in SharePoint.`,
      });
    },
    onError: (err) => {
      if (taskId) void qc.invalidateQueries({ queryKey: linkedFilesKey(taskId) });
      pushToast({
        message: describeListWriteFailure(err, {
          action: "link the files to this task",
          site: SITE,
          permission: "editing",
        }),
        variant: "error",
      });
    },
  });
}

/** Unlink one file. The file stays in SharePoint. */
export function useUnlinkTaskFile(taskId: number | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: LinkedFile) => {
      if (!taskId) throw new Error("No task to unlink the file from.");
      return unlinkTaskFile(taskId, file.id);
    },
    onMutate: async (file) => {
      if (!taskId) return {};
      const key = linkedFilesKey(taskId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ParsedLinkedFiles>(key);
      if (previous) {
        qc.setQueryData<ParsedLinkedFiles>(key, {
          ...previous,
          files: previous.files.filter((f) => f.id !== file.id),
        });
      }
      return { previous };
    },
    onSuccess: (files, file) => {
      if (taskId) qc.setQueryData<ParsedLinkedFiles>(linkedFilesKey(taskId), { files, corrupt: false });
      pushToast({ message: `Unlinked "${file.name}". The file is still in SharePoint.` });
    },
    onError: (err, file, ctx) => {
      if (taskId && ctx?.previous) qc.setQueryData(linkedFilesKey(taskId), ctx.previous);
      pushToast({
        message: describeListWriteFailure(err, {
          action: `unlink "${file.name}"`,
          site: SITE,
          permission: "editing",
        }),
        variant: "error",
      });
    },
  });
}
