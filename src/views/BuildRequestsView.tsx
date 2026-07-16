import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { HardHat, Plus, X } from "lucide-react";
import { useBuildRequestItems, useBuildRequests } from "@/hooks/useBuildRequests";
import { useProjects } from "@/hooks/useTasks";
import { LoadingTasks } from "@/components/LoadingTasks";
import { MultiSelect, SingleSelect } from "@/components/SearchableSelect";
import { SearchInput } from "@/components/SearchInput";
import { BuildRequestFormModal } from "@/components/BuildRequestFormModal";
import { BuildRequestRow } from "@/components/BuildRequestRow";
import {
  BUILD_REQUEST_STATUSES,
  type BuildRequest,
  type BuildRequestStatus,
  type Person,
} from "@/types/task";
import { cn } from "@/lib/cn";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { withPerson } from "@/lib/people";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useUnseenMentionSet } from "@/hooks/useUnseenMentions";

// =============================================================================
// Build Requests list view — modelled on EirsView (status pills + filter bar
// + row list; no View tabs). All filter axes live in the URL so a filtered
// view is shareable: status, q, project, engineer, requestor.
// =============================================================================

type StatusFilter = BuildRequestStatus | "ALL_OPEN" | null;

function isOpen(status: BuildRequestStatus): boolean {
  return status !== "Complete";
}

export function BuildRequestsView() {
  const navigate = useNavigate();
  const { data: brs = [], isLoading, error: brsError } = useBuildRequests();
  const { data: items = [] } = useBuildRequestItems();
  const { data: projects = [] } = useProjects();
  const [showNew, setShowNew] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();

  const statusFilter = (searchParams.get("status") as StatusFilter) ?? null;
  const setStatus = (s: StatusFilter) => {
    const sp = new URLSearchParams(searchParams);
    if (s) sp.set("status", s);
    else sp.delete("status");
    setSearchParams(sp, { replace: true });
  };
  const query = searchParams.get("q") ?? "";
  const setQuery = (q: string) => {
    const sp = new URLSearchParams(searchParams);
    if (q) sp.set("q", q);
    else sp.delete("q");
    setSearchParams(sp, { replace: true });
  };
  const projectIds = parseIntList(searchParams.get("project"));
  const setProjectIds = (ids: number[]) => {
    const sp = new URLSearchParams(searchParams);
    if (ids.length > 0) sp.set("project", ids.join(","));
    else sp.delete("project");
    setSearchParams(sp, { replace: true });
  };
  const engineerEmails = parseStringList(searchParams.get("engineer"));
  const setEngineers = (emails: string[]) => {
    const sp = new URLSearchParams(searchParams);
    if (emails.length > 0) sp.set("engineer", emails.join(","));
    else sp.delete("engineer");
    setSearchParams(sp, { replace: true });
  };
  const requestorEmail = searchParams.get("requestor");
  const setRequestor = (v: string | null) => {
    const sp = new URLSearchParams(searchParams);
    if (v) sp.set("requestor", v);
    else sp.delete("requestor");
    setSearchParams(sp, { replace: true });
  };
  // "Mine" deep link from the Dashboard: requested-by OR engineer-assigned
  // matches this email. Shown as a dismissible chip (not a hidden filter) so
  // an empty result is self-explanatory.
  const mineEmail = searchParams.get("mine");
  const clearMine = () => {
    const sp = new URLSearchParams(searchParams);
    sp.delete("mine");
    setSearchParams(sp, { replace: true });
  };

  const currentUser = useCurrentUser();
  const people = useMemo(() => withPerson(collectPeople(brs), currentUser), [brs, currentUser]);

  // Group items per header once — used for item counts, item-text search,
  // and the "any item mentioned" row badge.
  const itemsByHeader = useMemo(() => {
    const map = new Map<number, typeof items>();
    for (const i of items) {
      const list = map.get(i.buildRequestLookupId);
      if (list) list.push(i);
      else map.set(i.buildRequestLookupId, [i]);
    }
    return map;
  }, [items]);

  const filteredByBar = useMemo(() => {
    const searchTokens = tokenizeQuery(query);
    const mineKey = (mineEmail ?? "").toLowerCase();
    return brs.filter((b) => {
      if (mineKey) {
        const isMine =
          (b.requestor?.email ?? "").toLowerCase() === mineKey ||
          (b.engineerAssigned?.email ?? "").toLowerCase() === mineKey;
        if (!isMine) return false;
      }
      if (projectIds.length > 0) {
        const matched = b.parentProjects.some((p) => projectIds.includes(p.lookupId));
        if (!matched) return false;
      }
      if (engineerEmails.length > 0) {
        const key = (b.engineerAssigned?.email ?? b.engineerAssigned?.displayName ?? "").toLowerCase();
        if (!engineerEmails.map((s) => s.toLowerCase()).includes(key)) return false;
      }
      if (requestorEmail) {
        const key = (b.requestor?.email ?? b.requestor?.displayName ?? "").toLowerCase();
        if (key !== requestorEmail.toLowerCase()) return false;
      }
      // Search covers the header AND its parts, so a part number finds its BR.
      if (searchTokens.length > 0) {
        const headerHit = matchesSearch(b, searchTokens);
        const itemHit = (itemsByHeader.get(b.id) ?? []).some((i) => matchesSearch(i, searchTokens));
        if (!headerHit && !itemHit) return false;
      }
      return true;
    });
  }, [brs, mineEmail, projectIds, engineerEmails, requestorEmail, query, itemsByHeader]);

  const filtered = useMemo(
    () =>
      filteredByBar
        .filter((b) => {
          if (statusFilter === "ALL_OPEN") return isOpen(b.status);
          if (statusFilter) return b.status === statusFilter;
          return true;
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [filteredByBar, statusFilter],
  );

  const countByStatus = useMemo(() => {
    const counts = Object.fromEntries(BUILD_REQUEST_STATUSES.map((s) => [s, 0])) as Record<
      BuildRequestStatus,
      number
    >;
    for (const b of filteredByBar) counts[b.status]++;
    return counts;
  }, [filteredByBar]);
  const openCount = filteredByBar.filter((b) => isOpen(b.status)).length;

  // Header ids that have at least one part with an unseen mention — surfaces
  // the "Mentioned" pill on the row even when the mention is on an item.
  const unseenMentions = useUnseenMentionSet();
  const mentionedItemHeaders = useMemo(() => {
    const headers = new Set<number>();
    for (const i of items) {
      if (unseenMentions.has(`buildRequestItem:${i.id}`)) headers.add(i.buildRequestLookupId);
    }
    return headers;
  }, [items, unseenMentions]);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <header className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <HardHat className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">Build Requests</h1>
          <p className="text-xs text-fg-muted">
            Requests for manufacturing to build parts — prototypes, samples, production updates.
          </p>
        </div>
      </header>

      {mineEmail && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-fg">
          <span>
            Showing <strong>your</strong> build requests — where you're the requestor or the
            assigned engineer.
          </span>
          <button
            onClick={clearMine}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
          >
            <X className="h-3 w-3" />
            Show all
          </button>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Pill
            label="Open"
            count={openCount}
            active={statusFilter === "ALL_OPEN"}
            onClick={() => setStatus(statusFilter === "ALL_OPEN" ? null : "ALL_OPEN")}
            emphasized
          />
          {BUILD_REQUEST_STATUSES.map((s) => (
            <Pill
              key={s}
              label={s}
              count={countByStatus[s]}
              active={statusFilter === s}
              onClick={() => setStatus(statusFilter === s ? null : s)}
            />
          ))}
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Build Request</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Project Reference">
          <MultiSelect
            allLabel="All projects"
            searchPlaceholder="Search projects…"
            options={projects.map((p) => ({ value: String(p.lookupId), label: p.title }))}
            selected={projectIds.map(String)}
            onChange={(next) =>
              setProjectIds(next.map((v) => parseInt(v, 10)).filter((n) => !Number.isNaN(n)))
            }
          />
        </Field>
        <Field label="Engineer Assigned">
          <MultiSelect
            allLabel="Anyone"
            searchPlaceholder="Search people…"
            options={people.map((p) => ({
              value: p.email ?? p.displayName,
              label: p.displayName,
            }))}
            selected={engineerEmails}
            onChange={setEngineers}
          />
        </Field>
        <Field label="Search">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search anything — add words to narrow"
            className="select"
          />
        </Field>
        <Field label="Requestor">
          <SingleSelect
            allLabel="Anyone"
            searchPlaceholder="Search people…"
            options={people.map((p) => ({
              value: p.email ?? p.displayName,
              label: p.displayName,
            }))}
            selected={requestorEmail}
            onChange={setRequestor}
          />
        </Field>
      </div>

      {brsError != null && (
        <div className="rounded-lg border border-cooper-red/40 bg-cooper-red/10 p-3 text-xs">
          <div className="mb-1 font-semibold text-cooper-red">
            Couldn't load Build Requests from SharePoint
          </div>
          <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-fg">
            {(brsError as Error)?.message ?? "Unknown error"}
          </pre>
        </div>
      )}
      {isLoading ? (
        <LoadingTasks noun="build requests" />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-fg-muted">
          {brs.length === 0
            ? "No build requests yet. Click 'New Build Request' to create the first one."
            : "No build requests match the current filters."}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-fg-muted">
            Showing {filtered.length} of {brs.length} build requests
          </div>
          {filtered.map((b) => (
            <BuildRequestRow
              key={b.id}
              br={b}
              itemCount={(itemsByHeader.get(b.id) ?? []).length}
              hasItemMention={mentionedItemHeaders.has(b.id)}
              onOpen={() => navigate(`/build-request/${b.id}`)}
            />
          ))}
        </div>
      )}

      {showNew && <BuildRequestFormModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function Pill({
  label,
  count,
  active,
  onClick,
  emphasized,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  emphasized?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-all",
        active
          ? "border-accent bg-accent text-white shadow-sm"
          : "border-border bg-surface text-fg-muted hover:border-fg-muted hover:text-fg",
        emphasized && !active && "border-accent/40 text-fg",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
          active ? "bg-white/20 text-white" : "bg-surface-2 text-fg",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function collectPeople(brs: BuildRequest[]): Person[] {
  const map = new Map<string, Person>();
  const note = (p: Person | null) => {
    if (!p || !p.displayName) return;
    const k = (p.email ?? p.displayName).toLowerCase();
    if (!map.has(k)) map.set(k, p);
  };
  for (const b of brs) {
    note(b.requestor);
    note(b.engineerAssigned);
    b.watchers.forEach((w) => note(w));
  }
  return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function parseIntList(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^-?\d+$/.test(s))
    .map((s) => parseInt(s, 10));
}

function parseStringList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
