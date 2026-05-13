import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addComment,
  createTask,
  deleteTask,
  getTask,
  listProjects,
  listTasks,
  setTaskStatus,
  updateTaskFields,
} from "@/api/tasks";
import type { Status, Task } from "@/types/task";

const TASK_LIST_KEY = ["tasks", "list"] as const;
const TASK_DETAIL_KEY = (id: number) => ["tasks", "detail", id] as const;
const PROJECTS_KEY = ["projects"] as const;

export function useTasks() {
  return useQuery({
    queryKey: TASK_LIST_KEY,
    queryFn: listTasks,
    staleTime: 30_000,
  });
}

export function useTask(id: number | null) {
  return useQuery({
    queryKey: id ? TASK_DETAIL_KEY(id) : ["tasks", "detail", "null"],
    queryFn: () => (id ? getTask(id) : Promise.resolve(null)),
    enabled: id !== null,
  });
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
    onSuccess: (task) => {
      qc.setQueryData(TASK_DETAIL_KEY(task.id), task);
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
      comment: { authorName: string; authorEmail: string; bodyHtml: string };
    }) => addComment(id, comment),
    onSuccess: (task) => {
      qc.setQueryData(TASK_DETAIL_KEY(task.id), task);
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
