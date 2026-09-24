import { Lock, RotateCw } from "lucide-react";

export function ListAccessNotice({
  list,
  site,
  onRetry,
}: {
  list: string;
  site: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
      <div className="min-w-0">
        <div className="font-medium text-fg">You don't have access to this SharePoint list yet</div>
        <div className="mt-0.5 text-fg-muted">
          {list} cannot load for your account, so entries cannot be displayed or added. Ask an admin to grant you access to the <span className="font-mono text-xs">{site}</span> site.
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Check again
          </button>
        )}
      </div>
    </div>
  );
}