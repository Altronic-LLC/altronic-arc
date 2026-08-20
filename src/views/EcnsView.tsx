import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FileDiff, MessageSquare, Paperclip, Plus } from "lucide-react";
import { useEcns } from "@/hooks/useEcns";
import { useProjects } from "@/hooks/useTasks";
import type { Ecn } from "@/types/task";
import { stockDispositions } from "@/lib/ecnFields";
import { isEcnOnHold } from "@/lib/ecnMapper";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { htmlToPlainText } from "@/lib/htmlText";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { EcnFormModal } from "@/components/EcnFormModal";
import { EcnFlagChip, EcnOnHoldChip, EcnStockChip } from "@/components/ecnAtoms";
import { cn } from "@/lib/cn";

// =============================================================================
// ECNs — Engineering Change Notices.
//
// 1,813 notices and growing. The whole list is loaded and filtered here rather
// than paged from SharePoint, because the question people actually arrive with
// is "which ECN changed part 711478?" — and that part number lives in the
// Detailed Description, not in the title. Searching the descriptions is the
// point of the screen, and it needs the rows to be here.
//
// What's RENDERED is capped (`INITIAL_ROWS`, with a "Show all") — a couple of
// thousand rows of five cells each makes typing in the search box stutter. The
// filters and the count always run over everything.
// =============================================================================

const INITIAL_ROWS = 150;

type HoldFilter = "" | "On hold" | "Not on hold";

export function EcnsView() {
  const navigate = useNavigate();
  const { data: ecns = [], isLoading } = useEcns();
  const { data: projects = [] } = useProjects();
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const q = params.get("q") ?? "";
  const project = params.get("project") ?? "";
  const stock = params.get("stock") ?? "";
  const hold = (params.get("hold") as HoldFilter) || "";
  const drawings = params.get("drawings") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setShowAll(false);
  }

  const stockOptions = useMemo(
    () => stockDispositions(ecns.map((e) => e.values.inHouseStock ?? "")),
    [ecns],
  );
  // The lookup stores an id; titles come from the Projects list.
  const projectTitles = useMemo(
    () => new Map(projects.map((p) => [p.lookupId, p.title])),
    [projects],
  );
  const projectOptions = useMemo(
    () =>
      [...projects]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((p) => ({ value: String(p.lookupId), label: p.title })),
    [projects],
  );

  const filtered = useMemo(() => {
    const tokens = tokenizeQuery(q);
    return ecns.filter((ecn) => {
      if (project && String(ecn.parentProject?.lookupId ?? "") !== project) return false;
      if (stock && (ecn.values.inHouseStock ?? "") !== stock) return false;
      if (hold === "On hold" && !isEcnOnHold(ecn)) return false;
      if (hold === "Not on hold" && isEcnOnHold(ecn)) return false;
      if (drawings === "Complete" && ecn.values.drawingsComplete !== "Yes") return false;
      if (drawings === "Outstanding" && ecn.values.drawingsComplete === "Yes") return false;
      return matchesSearch(ecn, tokens);
    });
  }, [ecns, q, project, stock, hold, drawings]);

  const shown = showAll ? filtered : filtered.slice(0, INITIAL_ROWS);

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cooper-red/10 text-cooper-red">
          <FileDiff className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold text-fg sm:text-2xl">ECNs</h1>
          <p className="text-sm text-fg-muted">
            Engineering Change Notices — what changed, what happens to stock,
            and whether the drawings have caught up.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          New ECN
        </button>
      </header>

      <div
        role="search"
        aria-label="ECN filters"
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <Filter label="Search">
          <SearchInput
            value={q}
            onChange={(v) => setParam("q", v)}
            placeholder="Part number, assembly, description…"
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
        <Filter label="In House Stock">
          <ChoiceSelect
            value={stock}
            onChange={(v) => setParam("stock", v)}
            options={stockOptions}
            emptyLabel="Any"
            searchPlaceholder="Search dispositions…"
          />
        </Filter>
        <Filter label="Drawings">
          <ChoiceSelect
            value={drawings}
            onChange={(v) => setParam("drawings", v)}
            options={["Complete", "Outstanding"]}
            emptyLabel="Any"
          />
        </Filter>
        <Filter label="On hold">
          <ChoiceSelect
            value={hold}
            onChange={(v) => setParam("hold", v)}
            options={["On hold", "Not on hold"]}
            emptyLabel="Any"
          />
        </Filter>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-fg">
          <span>
            {isLoading
              ? "Loading…"
              : `${filtered.length.toLocaleString()} ECN${filtered.length === 1 ? "" : "s"}`}
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
          <LoadingTasks noun="ECNs" />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            No ECNs match these filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-fg-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Log#</th>
                  <th className="px-4 py-2 font-semibold">Title</th>
                  <th className="px-4 py-2 font-semibold">Project</th>
                  <th className="px-4 py-2 font-semibold">Final Assemblies</th>
                  <th className="px-4 py-2 font-semibold">Change</th>
                  <th className="px-4 py-2 font-semibold">In House Stock</th>
                  <th className="px-4 py-2 font-semibold">Drawings</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((ecn) => (
                  <Row
                    key={ecn.id}
                    ecn={ecn}
                    projectTitle={
                      ecn.parentProject
                        ? (projectTitles.get(ecn.parentProject.lookupId) ?? "")
                        : ""
                    }
                    onOpen={() => navigate(`/engineering/ecn/${ecn.id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <EcnFormModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => navigate(`/engineering/ecn/${id}`)}
        />
      )}
    </div>
  );
}

function Row({
  ecn,
  projectTitle,
  onOpen,
}: {
  ecn: Ecn;
  projectTitle: string;
  onOpen: () => void;
}) {
  // The description is rich text; the table shows the first line of it as
  // plain text, which is how you tell two revisions of one notice apart.
  const summary = htmlToPlainText(ecn.values.detailedDescription ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return (
    <tr
      onClick={onOpen}
      className={cn(
        "cursor-pointer border-t border-border transition-colors hover:bg-surface-2",
      )}
    >
      <td className="whitespace-nowrap px-4 py-2 font-medium text-fg">
        <span className="inline-flex items-center gap-1.5">
          <Link
            to={`/engineering/ecn/${ecn.id}`}
            onClick={(e) => e.stopPropagation()}
            className="tabular-nums hover:text-accent hover:underline"
          >
            {ecn.logNo || `#${ecn.id}`}
          </Link>
          {ecn.comments.length > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-fg-muted"
              title={`${ecn.comments.length} comment${ecn.comments.length === 1 ? "" : "s"}`}
            >
              <MessageSquare className="h-3 w-3" />
              {ecn.comments.length}
            </span>
          )}
          {ecn.hasAttachments && (
            <Paperclip className="h-3 w-3 text-fg-muted" aria-label="Has attachments" />
          )}
        </span>
      </td>
      <td className="max-w-[20rem] truncate px-4 py-2 text-fg" title={ecn.title}>
        <span className="inline-flex items-center gap-2">
          {ecn.title || "—"}
          <EcnOnHoldChip onHold={ecn.values.onHold ?? ""} />
        </span>
      </td>
      <td className="max-w-[12rem] truncate px-4 py-2 text-fg-muted" title={projectTitle}>
        {projectTitle || "—"}
      </td>
      <td className="max-w-[14rem] truncate px-4 py-2 text-fg-muted" title={ecn.values.finalAssemblyPartNumbers}>
        {ecn.values.finalAssemblyPartNumbers || "—"}
      </td>
      <td className="max-w-[24rem] truncate px-4 py-2 text-fg-muted" title={summary}>
        {summary || "—"}
      </td>
      <td className="px-4 py-2">
        <EcnStockChip disposition={ecn.values.inHouseStock ?? ""} />
      </td>
      <td className="px-4 py-2">
        <EcnFlagChip
          label="Complete"
          value={ecn.values.drawingsComplete ?? ""}
          tone="good"
        />
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
