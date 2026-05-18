import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addComment,
  createProject,
  createTask,
  deleteTask,
  editComment,
  listProjects,
  listTasks,
  setAssigned,
  setParentProject,
  setParentTask,
  setRelatedProjects,
  setTaskStatus,
  setWatchers,
  unwatchTask,
  updateTaskFields,
  watchTask,
} from "@/api/tasks";
import type {
  CommentAttachment,
  Person,
  Status,
  Task,
} from "@/types/task";

const TASK_LIST_KEY = ["tasks", "list"] as const;
const PROJECTS_KEY = ["projects"] as const;

export function useTasks() {
  return useQuery({
    queryKey: TASK_LIST_KEY,
    queryFn: listTasks,
    // 2 minutes: long enough that view-switches (List ↔ Kanban) and tab
    // refocus feel instant without a network round-trip; short enough that
    // a freshly-edited task elsewhere shows up within a minute or two.
    // DetailView's background invalidate handles the live-comments case
    // independently.
    staleTime: 120_000,
  });
}

/**
 * Read a single task from the list cache, derived rather than separately
 * fetched. This means useTask never triggers its own network call — it
 * relies on useTasks (which the same component or a parent typically also
 * calls) to populate the cache.
 *
 * Rationale: getTask() in the API layer is currently implemented by
 * re-running listTasks() (so child/parent links get populated), so a
 * separate query key would just duplicate the same data in the cache
 * under two keys.
 */
export function useTask(id: number | null) {
  const list = useTasks();
  return {
    ...list,
    data: id !== null ? list.data?.find((t) => t.id === id) ?? null : null,
  };
}

export function useProjects() {
  return useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: listProjects,
    staleTime: 5 * 60_000,
  });
}

/**
 * Kanban drag-and-drop calls this. Performs an optimistic update so the card
 * appears in the new column instantly, then reconciles when the server replies.
 */
export function useSetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: Status }) => setTaskStatus(id, status),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: TASK_LIST_KEY });
      const previous = qc.getQueryData<Task[]>(TASK_LIST_KEY);
      qc.setQueryData<Task[]>(TASK_LIST_KEY, (old) =>
        old?.map((t) => (t.id === id ? { ...t, status } : t)) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(TASK_LIST_KEY, context.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
    },
  });
}

export function useUpdateTaskFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      updateTaskFields(id, fields),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
    },
  });
}

export function useSetParentTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, parentId }: { id: number; parentId: number | null }) =>
      setParentTask(id, parentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
    },
  });
}

export function useSetParentProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectLookupId }: { id: number; projectLookupId: number | null }) =>
      setParentProject(id, projectLookupId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
    },
  });
}

export function useSetRelatedProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lookupIds }: { id: number; lookupIds: number[] }) =>
      setRelatedProjects(id, lookupIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
    },
  });
}

export function useSetAssigned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) => setAssigned(id, people),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
    },
  });
}

export function useSetWatchers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, people }: { id: number; people: Person[] }) => setWatchers(id, people),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
    },
  });
}

export function useWatchTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) => watchTask(id, person),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
    },
  });
}

export function useUnwatchTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, person }: { id: number; person: Person }) => unwatchTask(id, person),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
    },
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      comment,
    }: {
      id: number;
      comment: {
        authorName: string;
        authorEmail: string;
        bodyHtml: string;
        attachments?: CommentAttachment[];
      };
    }) => addComment(id, comment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
    },
  });
}

export function useEditComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      target,
      newBodyHtml,
    }: {
      id: number;
      target: { timestamp: Date; authorEmail: string };
      newBodyHtml: string;
    }) => editComment(id, target, newBodyHtml),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TASK_LIST_KEY });
    },
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: TASK_LIST_KEY }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: TASK_LIST_KEY }),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  });
}
