import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardCheck, MessageSquare, Paperclip, Plus } from "lucide-react";
import { useFaits } from "@/hooks/useFaits";
import { useProjects } from "@/hooks/useTasks";
import type { Fait } from "@/types/task";
import { FAIT_STATUSES, isFaitOpen } from "@/lib/faitFields";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { FaitFormModal } from "@/components/FaitFormModal";
import { FaitStatusChip, FirstPassChip } from "@/components/faitAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// FAITs — First Article Inspection Tests.
//
// **Open is the default view.** A closed FAIT is history, and the ones that
// matter are the handful sitting with SQE, Engineering or the KAM. The pills
// switch it, and the choice is in the URL like every other filter.
//
// The table leads with SAP Part Number, not Title: Title is empty on every row
// the list holds, and people identify a FAIT by the part.
// =============================================================================

type StatusFilter = "Open" | "Closed" | "All";
const STATUS_TABS: StatusFilter[] = ["Open", "Closed", "All"];

export function FaitsView() {
  const navigate = useNavigate();
  const { data: faits = [], isLoading } = useFaits();
  const { data: projects = [] } = useProjects();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);

  const q = params.get("q") ?? "";
  const project = params.get("project") ?? "";
  const supplier = params.get("supplier") ?? "";
  const stage = params.get("stage") ?? "";
  const status = (params.get("status") as StatusFilter) || "Open";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const projectTitles = useMemo(
    () => new Map(projects.map((p) => [p.lookupId, p.title])),
    [projects],
  );
  const projectOptions = useMemo(
    () =>
      [...projects]
        .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
        .map((p) => ({ value: String(p.lookupId), label: p.title })),
    [projects],
  );
  const supplierOptions = useMemo(() => {
    const names = new Set<string>();
    for (const f of faits) {
      const s = f.values.supplierName?.trim();
      if (s) names.add(s);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [faits]);

  const counts = useMemo(() => {
    const open = faits.filter((f) => isFaitOpen(f.status)).length;
    return { Open: open, Closed: faits.length - open, All: faits.length };
  }, [faits]);

  const filtered = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return faits.filter((f) => {
      if (status === "Open" && !isFaitOpen(f.status)) return false;
      if (status === "Closed" && isFaitOpen(f.status)) return false;
      if (project && String(f.parentProject?.lookupId ?? "") !== project) return false;
      if (supplier && (f.values.supplierName ?? "").trim() !== supplier) return false;
      if (stage && f.status !== stage) return false;
      return matchesSearch(f, tokens);
    });
  }, [faits, q, project, supplier, stage, status]);

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <ClipboardCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">FAITs</h1>
          <p className="text-sm text-fg-muted">
            First Article Inspection Tests — a new or changed part from a
            supplier, inspected and signed off.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          New FAIT
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
              status === tab ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
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
        aria-label="FAIT filters"
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Filter label="Search">
          <SearchInput
            value={q}
            onChange={(v) => setParam("q", v)}
            placeholder="Part number, description, supplier…"
          />
        </Filter>
        <Filter label="Project">
          <ChoiceSelect
            value={project}
            onChange={(v) => setParam("project", v)}
            options={projectOptions}
            emptyLabel="Any project"
            searchPlaceholder="Search projects…"
          />
        </Filter>
        <Filter label="Supplier">
          <ChoiceSelect
            value={supplier}
            onChange={(v) => setParam("supplier", v)}
            options={supplierOptions}
            emptyLabel="Any supplier"
            searchPlaceholder="Search suppliers…"
          />
        </Filter>
        <Filter label="Stage">
          <ChoiceSelect
            value={stage}
            onChange={(v) => setParam("stage", v)}
            options={FAIT_STATUSES}
            emptyLabel="Any"
          />
        </Filter>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
          {isLoading ? "Loading…" : `${filtered.length} FAIT${filtered.length === 1 ? "" : "s"}`}
        </div>

        {isLoading ? (
          <LoadingTasks noun="FAITs" />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            {status === "Open" && !q && !project && !supplier && !stage
              ? "Nothing open. Switch to All to see closed FAITs."
              : "No FAITs match these filters."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Part</th>
                  <th className="px-4 py-2 font-semibold">Description</th>
                  <th className="px-4 py-2 font-semibold">Supplier</th>
                  <th className="px-4 py-2 font-semibold">Project</th>
                  <th className="px-4 py-2 font-semibold">First pass</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((fait) => (
                  <Row
                    key={fait.id}
                    fait={fait}
                    projectTitle={
                      fait.parentProject
                        ? (projectTitles.get(fait.parentProject.lookupId) ?? "")
                        : ""
                    }
                    onOpen={() => navigate(`/supply-chain/fait/${fait.id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <FaitFormModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => navigate(`/supply-chain/fait/${id}`)}
        />
      )}
    </div>
  );
}

function Row({
  fait,
  projectTitle,
  onOpen,
}: {
  fait: Fait;
  projectTitle: string;
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
            to={`/supply-chain/fait/${fait.id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-accent hover:underline"
          >
            {fait.values.sapPartNumber || `#${fait.id}`}
          </Link>
          {fait.comments.length > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-fg-muted"
              title={`${fait.comments.length} comment${fait.comments.length === 1 ? "" : "s"}`}
            >
              <MessageSquare className="h-3 w-3" />
              {fait.comments.length}
            </span>
          )}
          {fait.hasAttachments && (
            <Paperclip className="h-3 w-3 text-fg-muted" aria-label="Has attachments" />
          )}
        </span>
      </td>
      <td className="max-w-[20rem] truncate px-4 py-2 text-fg" title={fait.values.description}>
        {fait.values.description || "—"}
      </td>
      <td className="max-w-[14rem] truncate px-4 py-2 text-fg-muted" title={fait.values.supplierName}>
        {fait.values.supplierName || "—"}
      </td>
      <td className="max-w-[12rem] truncate px-4 py-2 text-fg-muted" title={projectTitle}>
        {projectTitle || "—"}
      </td>
      <td className="px-4 py-2">
        <FirstPassChip
          passed={fait.values.meetsFirstPass ?? ""}
          failed={fait.values.failedFirstPass ?? ""}
        />
      </td>
      <td className="px-4 py-2">
        <FaitStatusChip status={fait.status} />
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
