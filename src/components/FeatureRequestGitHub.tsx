import { useState, type MouseEvent } from "react";
import { CircleCheck, CircleDot, ExternalLink, Github, Loader2, Plus } from "lucide-react";
import { BUSINESS_IT_PROJECT_URL, BUSINESS_IT_REPO, USE_MOCK } from "@/api/config";
import {
  findLinkedIssue,
  findSimilarIssues,
  wantedLabels,
  type GitHubIssue,
} from "@/lib/featureRequestIssues";
import { featureRequestLabel } from "@/lib/featureRequestMapper";
import { clearGitHubToken, setGitHubToken } from "@/hooks/useGitHubToken";
import type { FeatureRequest } from "@/types/task";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { cn } from "@/lib/cn";

// =============================================================================
// The BusinessIT GitHub controls on ARC Feature Requests — Ray and Tim only.
// The rules are in lib/featureRequestIssues.ts; the calls in
// api/githubIssues.ts. These pieces only render.
// =============================================================================

const REPO_LABEL = `${BUSINESS_IT_REPO.owner}/${BUSINESS_IT_REPO.name}`;

export type IssueScanStatus = "disconnected" | "loading" | "error" | "ready";

const stop = (e: MouseEvent) => e.stopPropagation();

/** Connection status above the list: connect, disconnect, or what went wrong. */
export function GitHubConnectBar({
  status,
  error,
  needsReconnect,
  onConnect,
  onRetry,
}: {
  status: IssueScanStatus;
  error: string | null;
  needsReconnect: boolean;
  onConnect: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg">
      <Github className="h-4 w-4 shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1">
        {status === "disconnected" && (
          <>
            Connect GitHub to see which requests are already issues in{" "}
            <strong>{REPO_LABEL}</strong> and to create new ones.
          </>
        )}
        {status === "loading" && <>Checking {REPO_LABEL} for existing issues…</>}
        {status === "ready" && (
          <>
            Matched against <strong>{REPO_LABEL}</strong>. New issues go on the{" "}
            <a
              href={BUSINESS_IT_PROJECT_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent hover:underline"
            >
              Business IT Tasks board
            </a>
            .
          </>
        )}
        {status === "error" && <span className="text-accent">{error}</span>}
      </span>
      {status === "error" && !needsReconnect && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border px-2.5 py-1 font-medium hover:bg-surface-2"
        >
          Try again
        </button>
      )}
      {!USE_MOCK && (status === "disconnected" || needsReconnect) && (
        <button
          type="button"
          onClick={onConnect}
          className="rounded-md bg-accent px-2.5 py-1 font-semibold text-white hover:bg-accent/90"
        >
          {status === "disconnected" ? "Connect GitHub" : "Reconnect GitHub"}
        </button>
      )}
      {!USE_MOCK && status !== "disconnected" && (
        <button
          type="button"
          onClick={clearGitHubToken}
          className="rounded-md border border-border px-2.5 py-1 font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          Disconnect
        </button>
      )}
    </div>
  );
}

/** Paste a personal access token. It stays in this browser. */
export function GitHubConnectDialog({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: () => void;
}) {
  const [token, setToken] = useState("");
  const overlayDismiss = useOverlayDismiss(onClose);
  const save = () => {
    if (!token.trim()) return;
    setGitHubToken(token);
    onConnected();
    onClose();
  };
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[12vh]"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-connect-title"
        onClick={stop}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="w-full max-w-lg rounded-lg border border-border bg-surface shadow-xl"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-3 p-5 text-sm text-fg-muted">
            <h2 id="github-connect-title" className="font-display text-base font-semibold text-fg">
              Connect GitHub
            </h2>
            <p>
              ARC uses <strong>your own</strong> GitHub token to read and create issues in{" "}
              <strong>{REPO_LABEL}</strong>. It is saved in this browser only and sent to nobody
              but GitHub.
            </p>
            <p>
              Create a{" "}
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-accent hover:underline"
              >
                fine-grained token
              </a>{" "}
              with resource owner <strong>Altronic-LLC</strong>, access to the{" "}
              <strong>BusinessIT</strong> repo, repository permission{" "}
              <strong>Issues: read and write</strong>, and organization permission{" "}
              <strong>Projects: read and write</strong> (so new issues land on the board). A
              classic token with the <code>repo</code> and <code>project</code> scopes also works.
            </p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg">Token</span>
              <input
                type="password"
                autoComplete="off"
                autoFocus
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="github_pat_…"
                className="input w-full font-mono"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!token.trim()}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
            >
              Save token
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function IssueLink({ issue, prefix }: { issue: GitHubIssue; prefix?: string }) {
  const Icon = issue.state === "open" ? CircleDot : CircleCheck;
  return (
    <a
      href={issue.htmlUrl}
      target="_blank"
      rel="noreferrer"
      onClick={stop}
      title={`${issue.title} (${issue.state}) — opens GitHub`}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-fg hover:border-fg-muted"
    >
      <Icon
        className={cn("h-3 w-3", issue.state === "open" ? "text-cooper-green" : "text-superior-blue")}
      />
      {prefix}#{issue.number}
      <ExternalLink className="h-3 w-3 text-fg-muted" />
    </a>
  );
}

const BOARD_STATUS_TONE: Record<string, string> = {
  backlog: "bg-fg-muted/15 text-fg-muted",
  "on hold": "bg-ajax-yellow/15 text-ajax-yellow",
  "in progress": "bg-superior-blue/15 text-superior-blue",
  "in review": "bg-superior-blue/15 text-superior-blue",
  done: "bg-cooper-green/15 text-cooper-green",
};

/**
 * The linked issue's Status on the Business IT Tasks board, beside ARC's own
 * Status. Board columns are read by NAME, so a column added on the board shows
 * as itself (in neutral grey) with no code change.
 */
export function IssueBoardStatusCell({
  request,
  issues,
  status,
  boardStatuses,
  boardError,
}: {
  request: FeatureRequest;
  issues: GitHubIssue[] | undefined;
  status: IssueScanStatus;
  boardStatuses: Record<number, string> | undefined;
  boardError: string | null;
}) {
  if (status === "loading") return <span className="text-xs text-fg-muted">Checking…</span>;
  if (status !== "ready" || !issues) return <span className="text-fg-muted">—</span>;
  const linked = findLinkedIssue(request.id, issues);
  if (!linked) return <span className="text-fg-muted">—</span>;
  if (boardError) {
    return (
      <span className="text-xs text-fg-muted" title={`Couldn't read the board: ${boardError}`}>
        Unknown
      </span>
    );
  }
  if (!boardStatuses) return <span className="text-xs text-fg-muted">Checking…</span>;
  const name = boardStatuses[linked.number];
  if (!name) {
    // Say WHY there's no board status, rather than a bare dash that reads as
    // "not linked".
    return (
      <span className="whitespace-nowrap text-xs text-fg-muted">
        {linked.state === "closed" ? "Closed" : "Not on board"}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
        BOARD_STATUS_TONE[name.toLowerCase()] ?? "bg-fg-muted/15 text-fg-muted",
      )}
    >
      {name}
    </span>
  );
}

/** One request's GitHub state: its issue, or a Create issue button. */
export function FeatureRequestIssueCell({
  request,
  issues,
  status,
  creating,
  onCreate,
}: {
  request: FeatureRequest;
  issues: GitHubIssue[] | undefined;
  status: IssueScanStatus;
  creating: boolean;
  onCreate: (request: FeatureRequest, similar: GitHubIssue[]) => void;
}) {
  if (status === "loading") {
    return <span className="text-xs text-fg-muted">Checking…</span>;
  }
  if (status !== "ready" || !issues) return <span className="text-fg-muted">—</span>;

  const linked = findLinkedIssue(request.id, issues);
  if (linked) return <IssueLink issue={linked} />;

  const similar = findSimilarIssues(request, issues);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={creating}
        onClick={(e) => {
          e.stopPropagation();
          onCreate(request, similar);
        }}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-fg hover:bg-surface-2 disabled:opacity-60"
      >
        {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        {creating ? "Working…" : similar.length > 0 ? "Link or create" : "Create issue"}
      </button>
      {similar.slice(0, 2).map((issue) => (
        <IssueLink key={issue.number} issue={issue} prefix="Similar " />
      ))}
    </span>
  );
}

/**
 * Confirm before anything is written to GitHub. When the scan found likely
 * matches, each can be LINKED instead — the common case for the issues raised
 * by hand before ARC could do it.
 */
export function CreateIssueDialog({
  request,
  similar,
  onConfirm,
  onLink,
  onCancel,
}: {
  request: FeatureRequest;
  similar: GitHubIssue[];
  onConfirm: () => void;
  onLink: (issue: GitHubIssue) => void;
  onCancel: () => void;
}) {
  const overlayDismiss = useOverlayDismiss(onCancel);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[15vh]"
      {...overlayDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-issue-title"
        onClick={stop}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        className="w-full max-w-md rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="space-y-3 p-5 text-sm text-fg-muted">
          <h2 id="create-issue-title" className="font-display text-base font-semibold text-fg">
            {similar.length > 0 ? "Is this already on GitHub?" : "Create a BusinessIT issue?"}
          </h2>
          {similar.length > 0 && (
            <div className="rounded-md border border-ajax-yellow/40 bg-ajax-yellow/10 p-3 text-fg">
              <p className="mb-2 font-medium">
                {similar.length === 1 ? "This issue looks" : "These issues look"} like{" "}
                {featureRequestLabel(request)}:
              </p>
              <ul className="space-y-2">
                {similar.map((issue) => (
                  <li key={issue.number} className="flex items-start gap-2">
                    <IssueLink issue={issue} />
                    <span className="min-w-0 flex-1 text-xs">{issue.title}</span>
                    <button
                      type="button"
                      onClick={() => onLink(issue)}
                      aria-label={`Link #${issue.number}`}
                      className="shrink-0 rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-semibold hover:bg-surface-2"
                    >
                      Link
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-fg-muted">
                Link adds a link to this request at the bottom of that issue, so ARC recognises it
                from then on. Nothing else on the issue changes.
              </p>
            </div>
          )}
          <p>
            {similar.length > 0 ? "Or create a new one: " : ""}
            <strong className="text-fg">{featureRequestLabel(request)}</strong> will be opened as an
            issue in {REPO_LABEL}, titled "ARC: …", and added to the Business IT Tasks board. The
            issue links back to this request.
          </p>
          <p>
            Labels: {wantedLabels(request).join(", ")}{" "}
            <span className="text-xs">(any the repo doesn't have are skipped)</span>
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent/90"
          >
            {similar.length > 0 ? "Create new issue" : "Create issue"}
          </button>
        </div>
      </div>
    </div>
  );
}
