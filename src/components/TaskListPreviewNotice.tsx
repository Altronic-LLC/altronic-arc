import { Loader2 } from "lucide-react";

/**
 * Said above the task List and Kanban while they show the PREVIEW — the most
 * recently changed tasks — and the full list is still downloading (see
 * useTaskListWithPreview). Counts, filters and pills cover only those tasks
 * until then, so the screen has to say it isn't everything yet.
 */
export function TaskListPreviewNotice({ shown, board = false }: { shown: number; board?: boolean }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-border bg-surface-2/60 px-3 py-2 text-xs text-fg-muted"
    >
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      <span>
        Showing the {shown} most recently updated tasks while the rest load
        {board ? " — cards can be moved once they have." : "."}
      </span>
    </div>
  );
}
