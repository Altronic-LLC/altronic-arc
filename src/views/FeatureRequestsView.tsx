import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lightbulb, Plus } from "lucide-react";
import { SP_FEATURE_REQUESTS_LIST_ID, USE_MOCK } from "@/api/config";
import { useFeatureRequests } from "@/hooks/useFeatureRequests";
import type { FeatureRequest, FeatureRequestDepartment, FeatureRequestStatus } from "@/types/task";
import { FEATURE_REQUEST_DEPARTMENTS, FEATURE_REQUEST_STATUSES } from "@/types/task";
import { featureRequestLabel } from "@/lib/featureRequestMapper";
import { matchesTokens } from "@/lib/itemSearch";
import { SearchInput } from "@/components/SearchInput";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { LoadingTasks } from "@/components/LoadingTasks";
import { FeatureRequestFormModal } from "@/components/FeatureRequestFormModal";
import { cn } from "@/lib/cn";

// =============================================================================
// ARC Feature Requests — a place for any signed-in user to request a new ARC
// feature or change, separate from "Report issue" (which is for something
// BROKEN). No admin gate: any signed-in user can view, create, comment and
// change status/priority/target version. See CLAUDE.md.
// =============================================================================

const INITIAL_ROWS = 150;

function matchesSearch(request: FeatureRequest, query: string): boolean {
  if (!query) return true;
  const haystack = [
    request.title,
    request.description,
    request.department ?? "",
    request.requestedBy?.displayName ?? "",
    request.targetVersion,
  ].join(" ");
  return matchesTokens(haystack, query);
}

export function FeatureRequestsView() {
  const { data: requests = [], isLoading } = useFeatureRequests();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState<FeatureRequestDepartment | "">("");
  const [status, setStatus] = useState<FeatureRequestStatus | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (department && r.department !== department) return false;
      if (status && r.status !== status) return false;
      return matchesSearch(r, query);
    });
  }, [requests, department, status, query]);

  const visible = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);

  const countByStatus = useMemo(() => {
    const counts: Record<FeatureRequestStatus, number> = {
      "Pending Review": 0,
      "In Work": 0,
      Completed: 0,
      "Not Implementing": 0,
    };
    for (const r of requests) counts[r.status]++;
    return counts;
  }, [requests]);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ajax-yellow/10 text-ajax-yellow">
          <Lightbulb className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            ARC Feature Requests
          </h1>
          <p className="text-sm text-fg-muted">
            Ask for a new ARC feature or change. For something that's broken, use "Report issue"
            instead.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          Suggest a Feature
        </button>
      </header>

      {!USE_MOCK && !SP_FEATURE_REQUESTS_LIST_ID && (
        <div className="rounded-lg border border-ajax-yellow/40 bg-ajax-yellow/10 px-3 py-2 text-xs text-fg">
          <span className="font-semibold text-ajax-yellow">Feature Requests list not configured.</span>{" "}
          An admin needs to run <code>scripts/create-feature-requests-list.ps1</code> and set{" "}
          <code>VITE_SP_FEATURE_REQUESTS_LIST_ID</code>. Until then no requests can be submitted.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FEATURE_REQUEST_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatus(status === s ? null : s);
              setShowAll(false);
            }}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-all",
              status === s
                ? "border-accent bg-accent text-white shadow-sm"
                : "border-border bg-surface text-fg-muted hover:border-fg-muted hover:text-fg",
            )}
          >
            <span>{s}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
                status === s ? "bg-white/20 text-white" : "bg-surface-2 text-fg",
              )}
            >
              {countByStatus[s]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchInput
            value={query}
            onChange={(v) => {
              setQuery(v);
              setShowAll(false);
            }}
            placeholder="Search title, description, requester…"
          />
        </div>
        <div className="w-full sm:w-64">
          <ChoiceSelect
            value={department}
            onChange={(v) => {
              setDepartment((v as FeatureRequestDepartment) || "");
              setShowAll(false);
            }}
            options={FEATURE_REQUEST_DEPARTMENTS}
            emptyLabel="All departments"
            searchPlaceholder="Search departments…"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
          <h2 className="text-sm font-medium text-fg">
            {isLoading
              ? "Loading…"
              : `${filtered.length} request${filtered.length === 1 ? "" : "s"}`}
            {(query || department || status) && !isLoading && (
              <span className="ml-1 text-fg-muted">of {requests.length}</span>
            )}
          </h2>
        </div>

        {!showAll && filtered.length > INITIAL_ROWS && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-ajax-yellow/10 px-4 py-2 text-xs text-fg">
            <span>
              Showing <strong>{INITIAL_ROWS}</strong> of <strong>{filtered.length}</strong> — the
              rest are loaded, just not drawn yet.
            </span>
            <button
              onClick={() => setShowAll(true)}
              className="rounded-md border border-border bg-surface px-2.5 py-1 font-medium text-fg transition-colors hover:bg-surface-2"
            >
              Show all {filtered.length}
            </button>
          </div>
        )}

        {isLoading ? (
          <LoadingTasks noun="feature requests" />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            {query || department || status
              ? "No requests match that search."
              : "No feature requests yet. Click \"Suggest a Feature\" to raise the first."}
          </div>
        ) : (
          <>
            {/* Phone: a card per request. */}
            <div className="divide-y divide-border sm:hidden">
              {visible.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  onClick={() => navigate(`/feature-request/${request.id}`)}
                />
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Summary</th>
                    <th className="px-4 py-2 font-semibold">Department</th>
                    <th className="px-4 py-2 font-semibold">Priority</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 font-semibold">Requested By</th>
                    <th className="px-4 py-2 font-semibold">Target Version</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((request) => (
                    <Row
                      key={request.id}
                      request={request}
                      onClick={() => navigate(`/feature-request/${request.id}`)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showNew && <FeatureRequestFormModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function Row({ request, onClick }: { request: FeatureRequest; onClick: () => void }) {
  return (
    <tr
      onClick={onClick}
      className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
    >
      <td className="px-4 py-2 font-medium text-fg">{featureRequestLabel(request)}</td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
        {request.department ?? "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{request.priority ?? "—"}</td>
      <td className="whitespace-nowrap px-4 py-2">
        <StatusBadge status={request.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
        {request.requestedBy?.displayName || "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
        {request.targetVersion || "—"}
      </td>
    </tr>
  );
}

function RequestCard({ request, onClick }: { request: FeatureRequest; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-fg">{featureRequestLabel(request)}</span>
        <StatusBadge status={request.status} />
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <div className="contents">
          <dt className="text-fg-muted">Department</dt>
          <dd className="truncate text-right text-fg">{request.department ?? "—"}</dd>
        </div>
        <div className="contents">
          <dt className="text-fg-muted">Priority</dt>
          <dd className="truncate text-right text-fg">{request.priority ?? "—"}</dd>
        </div>
        <div className="contents">
          <dt className="text-fg-muted">Requested By</dt>
          <dd className="truncate text-right text-fg">
            {request.requestedBy?.displayName || "—"}
          </dd>
        </div>
        {request.targetVersion && (
          <div className="contents">
            <dt className="text-fg-muted">Target Version</dt>
            <dd className="truncate text-right text-fg">{request.targetVersion}</dd>
          </div>
        )}
      </dl>
    </button>
  );
}

const STATUS_TONE: Record<FeatureRequestStatus, string> = {
  "Pending Review": "bg-ajax-yellow/15 text-ajax-yellow",
  "In Work": "bg-superior-blue/15 text-superior-blue",
  Completed: "bg-cooper-green/15 text-cooper-green",
  "Not Implementing": "bg-fg-muted/15 text-fg-muted",
};

function StatusBadge({ status }: { status: FeatureRequestStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
        STATUS_TONE[status],
      )}
    >
      {status}
    </span>
  );
}
