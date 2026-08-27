import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { DollarSign, MessageSquare, Paperclip, Plus } from "lucide-react";
import { useCostImpactNotices } from "@/hooks/useCostImpactNotices";
import type { CostImpactNotice } from "@/types/task";
import { COST_IMPACT_TIMES } from "@/types/task";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { CostImpactNoticeFormModal } from "@/components/CostImpactNoticeFormModal";
import { CostImpactDeltaChip } from "@/components/costImpactAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// Cost Impact Notices — Supply Chain's register of purchased parts whose cost
// has changed. 31 notices at discovery, so the whole list is loaded and
// filtered here, same as ECNs and the SRM Tool at this size.
//
// Raising one is the notable action: it emails a fixed intake list (see
// CLAUDE.md / api/config.ts's COST_IMPACT_NOTICE_ALERTS) since nothing
// watches this list on its own.
// =============================================================================

const INITIAL_ROWS = 150;

export function CostImpactNoticesView() {
  const navigate = useNavigate();
  const { data: notices = [], isLoading } = useCostImpactNotices();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const q = params.get("q") ?? "";
  const timeOfImpact = params.get("time") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setShowAll(false);
  }

  const filtered = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return notices.filter((n) => {
      if (timeOfImpact && n.timeOfImpact !== timeOfImpact) return false;
      return matchesSearch(n, tokens);
    });
  }, [notices, q, timeOfImpact]);

  const shown = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
            <DollarSign className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">
              Cost Impact Notices
            </h1>
            <p className="text-sm text-fg-muted">
              A purchased part's cost changed — original, new, the delta, and
              how soon it bites.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            New notice
          </button>
        </div>
      </header>

      <div
        role="search"
        aria-label="Cost impact notice filters"
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2"
      >
        <Filter label="Search">
          <SearchInput
            value={q}
            onChange={(v) => setParam("q", v)}
            placeholder="Part, supplier, SAP number…"
          />
        </Filter>
        <Filter label="Time of Impact">
          <ChoiceSelect
            value={timeOfImpact}
            onChange={(v) => setParam("time", v)}
            options={COST_IMPACT_TIMES}
            emptyLabel="Any"
          />
        </Filter>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
          <span>
            {isLoading
              ? "Loading…"
              : `${filtered.length.toLocaleString()} notice${filtered.length === 1 ? "" : "s"}`}
          </span>
          {!isLoading && shown.length < filtered.length && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              Showing {shown.length.toLocaleString()} — show all
            </button>
          )}
        </div>

        {isLoading ? (
          <LoadingTasks noun="cost impact notices" />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            No notices match these filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Part</th>
                  <th className="px-4 py-2 font-semibold">Supplier</th>
                  <th className="px-4 py-2 font-semibold">Original</th>
                  <th className="px-4 py-2 font-semibold">New</th>
                  <th className="px-4 py-2 font-semibold">Delta</th>
                  <th className="px-4 py-2 font-semibold">Time of Impact</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((n) => (
                  <Row
                    key={n.id}
                    notice={n}
                    onOpen={() => navigate(`/supply-chain/cost-impact-notice/${n.id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <CostImpactNoticeFormModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => navigate(`/supply-chain/cost-impact-notice/${id}`)}
        />
      )}
    </div>
  );
}

function Row({ notice, onOpen }: { notice: CostImpactNotice; onOpen: () => void }) {
  return (
    <tr onClick={onOpen} className={cn("cursor-pointer border-t border-border transition-colors hover:bg-surface-2")}>
      <td className="max-w-[18rem] truncate px-4 py-2 font-medium text-fg" title={notice.title}>
        <span className="inline-flex items-center gap-1.5">
          <Link
            to={`/supply-chain/cost-impact-notice/${notice.id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-accent hover:underline"
          >
            {notice.title || `#${notice.id}`}
          </Link>
          {notice.comments.length > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-fg-muted"
              title={`${notice.comments.length} comment${notice.comments.length === 1 ? "" : "s"}`}
            >
              <MessageSquare className="h-3 w-3" />
              {notice.comments.length}
            </span>
          )}
          {notice.hasAttachments && (
            <Paperclip className="h-3 w-3 text-fg-muted" aria-label="Has attachments" />
          )}
        </span>
      </td>
      <td className="max-w-[12rem] truncate px-4 py-2 text-fg-muted" title={notice.supplier}>
        {notice.supplier || "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{notice.originalCost || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">{notice.newCost || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2">
        <CostImpactDeltaChip deltaCost={notice.deltaCost} />
      </td>
      <td className="px-4 py-2 text-fg-muted">{notice.timeOfImpact || "—"}</td>
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
