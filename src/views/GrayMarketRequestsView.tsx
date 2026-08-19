import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { MessageSquare, PackageSearch, Paperclip, Plus } from "lucide-react";
import { useGrayMarketRequests } from "@/hooks/useGrayMarketRequests";
import type { GrayMarketRequest } from "@/types/task";
import { GRAY_MARKET_STATUSES } from "@/lib/grayMarketFields";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { formatSpDate } from "@/lib/spDates";
import { withPerson } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { GrayMarketRequestFormModal } from "@/components/GrayMarketRequestFormModal";
import { GrayMarketStatusChip } from "@/components/grayMarketAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// Gray Market Requests — parts bought outside normal distribution.
//
// Worked by Supply Chain AND Engineering, so it appears under both in the nav.
//
// **Open is the default view**, matching the SharePoint view the team lives in
// — a completed request is history, and 199 rows of history buries the six
// that need something doing. The pills switch it, and the choice is in the URL
// like every other filter so a view can be shared.
// =============================================================================

type StatusFilter = "Open" | "Complete" | "All";

const STATUS_TABS: StatusFilter[] = ["Open", "Complete", "All"];

export function GrayMarketRequestsView() {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const { data: requests = [], isLoading } = useGrayMarketRequests();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);

  const q = params.get("q") ?? "";
  const requestor = params.get("requestor") ?? "";
  const testing = params.get("testing") ?? "";
  const status = (params.get("status") as StatusFilter) || "Open";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  // Requestor options come from the data plus the signed-in user, so a
  // "mine" pick is possible before you've raised anything.
  const requestors = useMemo(() => {
    const people = requests
      .map((r) => r.requestor)
      .filter((p): p is NonNullable<typeof p> => !!p);
    return withPerson(people, currentUser).map((p) => p.displayName);
  }, [requests, currentUser]);

  const counts = useMemo(() => {
    let open = 0;
    for (const r of requests) if (r.status !== "Complete") open += 1;
    return { Open: open, Complete: requests.length - open, All: requests.length };
  }, [requests]);

  const filtered = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return requests.filter((r) => {
      // Anything not explicitly Complete counts as open — a blank status on an
      // old row is still something nobody has finished.
      if (status === "Open" && r.status === "Complete") return false;
      if (status === "Complete" && r.status !== "Complete") return false;
      if (requestor && r.requestor?.displayName !== requestor) return false;
      if (testing && r.testingRequired !== testing) return false;
      return matchesSearch(r, tokens);
    });
  }, [requests, q, requestor, testing, status]);

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <PackageSearch className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            Gray Market Requests
          </h1>
          <p className="text-sm text-fg-muted">
            Parts bought outside normal distribution — request through to
            production sign-off.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          New Request
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-surface-2 p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setParam("status", tab === "Open" ? "" : tab)}
            aria-pressed={status === tab}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              status === tab
                ? "bg-surface text-fg shadow-sm"
                : "text-fg-muted hover:text-fg",
            )}
          >
            {tab}
            <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-bold tabular-nums">
              {counts[tab]}
            </span>
          </button>
        ))}
      </div>

      <div
        role="search"
        aria-label="Gray market request filters"
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-3"
      >
        <Filter label="Requestor">
          <ChoiceSelect
            value={requestor}
            onChange={(v) => setParam("requestor", v)}
            options={requestors}
            emptyLabel="Anyone"
            searchPlaceholder="Search people…"
          />
        </Filter>
        <Filter label="Testing Required">
          <ChoiceSelect
            value={testing}
            onChange={(v) => setParam("testing", v)}
            options={["In Process", "Yes", "No"]}
            emptyLabel="Any"
          />
        </Filter>
        <Filter label="Search">
          <SearchInput
            value={q}
            onChange={(v) => setParam("q", v)}
            placeholder="Part, vendor, PO, comments…"
          />
        </Filter>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
          {isLoading
            ? "Loading…"
            : `${filtered.length} request${filtered.length === 1 ? "" : "s"}`}
        </div>

        {isLoading ? (
          <LoadingTasks noun="gray market requests" />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            {status === "Open" && !q && !requestor && !testing
              ? "Nothing open. Switch to All to see completed requests."
              : "No requests match these filters."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Log No.</th>
                  <th className="px-4 py-2 font-semibold">Title</th>
                  <th className="px-4 py-2 font-semibold">Part</th>
                  <th className="px-4 py-2 font-semibold">Vendor</th>
                  <th className="px-4 py-2 font-semibold">Requestor</th>
                  <th className="px-4 py-2 font-semibold">Requested</th>
                  <th className="px-4 py-2 font-semibold">Testing</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((request) => (
                  <Row
                    key={request.id}
                    request={request}
                    onOpen={() =>
                      navigate(`/supply-chain/gray-market-request/${request.id}`)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <GrayMarketRequestFormModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => navigate(`/supply-chain/gray-market-request/${id}`)}
        />
      )}
    </div>
  );
}

function Row({
  request,
  onOpen,
}: {
  request: GrayMarketRequest;
  onOpen: () => void;
}) {
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-t border-border transition-colors hover:bg-surface-2"
    >
      <td className="whitespace-nowrap px-4 py-2 font-medium text-fg">
        <span className="inline-flex items-center gap-1.5">
          <Link
            to={`/supply-chain/gray-market-request/${request.id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-accent hover:underline"
          >
            {request.logNo || `#${request.id}`}
          </Link>
          {request.comments.length > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-fg-muted"
              title={`${request.comments.length} comment${request.comments.length === 1 ? "" : "s"}`}
            >
              <MessageSquare className="h-3 w-3" />
              {request.comments.length}
            </span>
          )}
          {request.hasAttachments && (
            <Paperclip className="h-3 w-3 text-fg-muted" aria-label="Has attachments" />
          )}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg">{request.title}</td>
      <td className="max-w-[18rem] truncate px-4 py-2 text-fg-muted" title={request.values.partDescription}>
        {request.values.partDescription || request.values.mfgPartNo || "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
        {request.values.vendor || "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
        {request.requestor?.displayName ?? "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-fg-muted">
        {formatSpDate(request.requestDate)}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
        {request.testingRequired || "—"}
      </td>
      <td className="px-4 py-2">
        <GrayMarketStatusChip status={request.status} />
      </td>
    </tr>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

export { GRAY_MARKET_STATUSES };
