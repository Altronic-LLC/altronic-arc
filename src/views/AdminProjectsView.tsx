import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Pencil, Plus, Shield, Trash2, X } from "lucide-react";
import { useCreateProject, useProjects, useUpdateProject } from "@/hooks/useTasks";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useDeleteProject, useProjectUsage } from "@/hooks/useDeleteProject";
import { describeProjectUsage } from "@/lib/projectUsage";
import { LoadingTasks } from "@/components/LoadingTasks";
import { SearchInput } from "@/components/SearchInput";
import { matchesSearch, tokenizeQuery } from "@/lib/itemSearch";
import { cn } from "@/lib/cn";
import type { ProjectReference } from "@/types/task";

// The Engineering Project Log is organised into tables by the project number:
//   0xxx        → Engineering items that aren't products
//   2000-series → Legacy projects (four-digit 2xxx, no previously-assigned no.)
//   5xxx        → Insourcing projects
//   three-digit → New projects (next number + requesting engineer's initials)
//   no number   → Other
type BucketKey = "new" | "legacy" | "eng" | "insourcing" | "other";

function classifyProject(title: string): BucketKey {
  const m = /^\s*(\d+)/.exec(title ?? "");
  if (!m) return "other";
  const num = m[1];
  const first = num[0];
  if (first === "0") return "eng"; // 0xxx
  if (first === "5") return "insourcing"; // 5xxx
  // 2000-series (four-digit 2xxx) is legacy; a three-digit 2xx is a new number.
  if (first === "2" && num.length >= 4) return "legacy";
  return "new"; // three-digit numbers (+ any other non-0/2xxx/5 leading number)
}

// Display order, labels, and an accent dot for each table. The 2×2 quadrant is
// New / Legacy on top, Engineering Items / Insourcing below. "Other" renders
// only when it has entries; the four defined tables always show so the
// taxonomy is visible.
const BUCKETS: { key: BucketKey; label: string; hint: string; dot: string }[] = [
  { key: "new", label: "New Projects", hint: "3-digit number + engineer initials", dot: "bg-superior-blue" },
  { key: "legacy", label: "Legacy Projects", hint: "2000-series", dot: "bg-slate-400" },
  { key: "eng", label: "Engineering Items", hint: "0xxx · not products", dot: "bg-ajax-yellow" },
  { key: "insourcing", label: "Insourcing", hint: "5xxx", dot: "bg-cooper-green" },
  { key: "other", label: "Other", hint: "no number prefix", dot: "bg-fg-muted" },
];

/**
 * Admin page for the Engineering Project Log — the master list of projects.
 *
 * Today's scope: list existing projects, add new ones. Adding new ones
 * writes to the Project Overview SharePoint list (VITE_SP_PROJECTS_LIST_ID)
 * — the same list every Project Reference lookup in the app reads from — or
 * to the mock store in demo mode.
 *
 * Access gated by useIsAdmin() — non-admins get a friendly notice rather
 * than a hard 404, since the page might be linked from elsewhere and we
 * want them to know what they're missing (so they can ask for access)
 * rather than thinking the link is broken.
 */
export function AdminProjectsView() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const { data: projects = [], isLoading } = useProjects();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const [deleting, setDeleting] = useState<ProjectReference | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [search, setSearch] = useState("");

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <Shield className="mx-auto h-10 w-10 text-fg-muted" />
        <h1 className="mt-4 font-display text-xl font-semibold text-fg">Admin access required</h1>
        <p className="mt-2 text-sm text-fg-muted">
          The Engineering Project Log admin page is restricted to authorised
          users. If you need access, contact your administrator.
        </p>
        <button
          onClick={() => navigate("/")}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent underline-offset-2 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to task list
        </button>
      </div>
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    await createProject.mutateAsync({ title });
    setNewTitle("");
  }

  // Multi-keyword, all-fields search — same behaviour as every other list in
  // ARC (see "How search works (all lists)" in the manual). A project has
  // little beyond its title, but this still matches "AMP 5000" against
  // "0017-AMP-5000 Refresh" regardless of word order.
  const searchTokens = useMemo(() => tokenizeQuery(search), [search]);
  const filtered = useMemo(
    () => (searchTokens.length === 0 ? projects : projects.filter((p) => matchesSearch(p, searchTokens))),
    [projects, searchTokens],
  );

  const grouped = useMemo(() => {
    const g: Record<BucketKey, ProjectReference[]> = {
      new: [],
      legacy: [],
      eng: [],
      insourcing: [],
      other: [],
    };
    for (const p of filtered) g[classifyProject(p.title)].push(p);
    // Highest number first within each table (descending, numeric-aware).
    for (const key of Object.keys(g) as BucketKey[]) {
      g[key].sort((a, b) => b.title.localeCompare(a.title, undefined, { numeric: true }));
    }
    return g;
  }, [filtered]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6 sm:py-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
            <Shield className="h-3.5 w-3.5" />
            Admin
          </div>
          <h1 className="mt-1 font-display text-2xl font-semibold text-fg">
            Engineering Project Log
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            The master list of projects. New projects added here become available
            immediately as Project Reference choices on tasks, EIRs, and test
            sheets.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Link
            to="/admin/admins"
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            Admins →
          </Link>
          <Link
            to="/admin/eir-roles"
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            EIR Roles →
          </Link>
          <Link
            to="/admin/operations-projects"
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            Operations Projects →
          </Link>
          <Link
            to="/admin/panel-projects"
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            Panel Projects →
          </Link>
        </div>
      </div>

      <section className="mb-6 rounded-lg border border-border bg-surface p-4 sm:p-5">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Add new project
        </h2>
        <form onSubmit={handleCreate} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Title
            </span>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. 0042-New Engine Variant Trials"
              className="rounded-md border border-border bg-bg px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              disabled={createProject.isPending}
            />
          </label>
          <button
            type="submit"
            disabled={!newTitle.trim() || createProject.isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {createProject.isPending ? "Creating…" : "Create"}
          </button>
        </form>
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Existing projects (
          {searchTokens.length > 0 ? `${filtered.length} of ${projects.length}` : projects.length}
          )
        </h2>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search projects…"
          className="h-9 w-full max-w-xs rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {isLoading ? (
        <LoadingTasks noun="projects" />
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-fg-muted">
          No projects yet. Add one above.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-fg-muted">
          No projects match "{search}".
        </div>
      ) : (
        // 2×2 quadrants on large screens (New / Legacy on top, Engineering
        // Items / Insourcing below), single column on smaller screens.
        // "Other" wraps in below when present.
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {BUCKETS.map((bucket) => {
            const items = grouped[bucket.key];
            // Hide the "Other" table entirely when there's nothing in it; the
            // four defined tables always render so the taxonomy is visible.
            if (bucket.key === "other" && items.length === 0) return null;
            return (
              <ProjectTable
                key={bucket.key}
                label={bucket.label}
                hint={bucket.hint}
                dot={bucket.dot}
                items={items}
                onOpen={(id) => navigate(`/project/${id}`)}
                onRename={(id, title) => updateProject.mutate({ lookupId: id, title })}
                onDelete={setDeleting}
              />
            );
          })}
        </div>
      )}

      {deleting && <DeleteProjectDialog project={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

/** One titled table (card) of projects within the Engineering Project Log. */
function ProjectTable({
  label,
  hint,
  dot,
  items,
  onOpen,
  onRename,
  onDelete,
}: {
  label: string;
  hint: string;
  dot: string;
  items: ProjectReference[];
  onOpen: (lookupId: number) => void;
  onRename: (lookupId: number, title: string) => void;
  onDelete: (project: ProjectReference) => void;
}) {
  return (
    <section className="flex flex-col rounded-lg border border-border bg-surface p-4">
      <header className="mb-3 border-b border-border pb-2">
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dot)} />
          <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-fg">
            {label}
          </h3>
          <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-fg-muted">
            {items.length}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-fg-muted">{hint}</p>
      </header>
      {items.length === 0 ? (
        <p className="py-2 text-xs text-fg-muted">No projects in this series yet.</p>
      ) : (
        <div className="scroll-elegant flex max-h-[22rem] flex-col gap-1.5 overflow-y-auto pr-1">
          {items.map((p) => (
            <ProjectRow
              key={p.lookupId}
              project={p}
              onOpen={onOpen}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One project row. Click the title to open the project rollup; click the
 * pencil (admin-only page) to edit the Title inline — which is where both the
 * project number and name live, so one edit changes either. Enter saves,
 * Escape cancels. On save the list refetches, so changing the number also
 * re-sorts the project into the correct table.
 */
function ProjectRow({
  project,
  onOpen,
  onRename,
  onDelete,
}: {
  project: ProjectReference;
  onOpen: (lookupId: number) => void;
  onRename: (lookupId: number, title: string) => void;
  onDelete: (project: ProjectReference) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.title);

  function startEdit() {
    setDraft(project.title);
    setEditing(true);
  }
  function save() {
    const next = draft.trim();
    if (next && next !== project.title) onRename(project.lookupId, next);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-accent/50 bg-surface px-2 py-1.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              setEditing(false);
            }
          }}
          placeholder="e.g. 0017-AMP-5000 Refresh (number + name)"
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          maxLength={255}
        />
        <button
          onClick={save}
          className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent/90"
        >
          Save
        </button>
        <button
          onClick={() => setEditing(false)}
          className="shrink-0 rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Cancel"
          title="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 transition-colors hover:border-fg-muted hover:bg-surface-2">
      <button
        onClick={() => onOpen(project.lookupId)}
        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-fg"
        title="Open project"
      >
        {project.title}
      </button>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={startEdit}
          className="rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg group-hover:opacity-100 focus:opacity-100"
          aria-label="Edit project number / name"
          title="Edit number / name"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onDelete(project)}
          className="rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-cooper-red group-hover:opacity-100 focus:opacity-100"
          aria-label={`Delete ${project.title}`}
          title="Delete project"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <span className="font-mono text-[11px] text-fg-muted">#{project.lookupId}</span>
      </div>
    </div>
  );
}

/**
 * Confirm deleting a project (BusinessIT#41 — duplicates). Shows where the
 * project is still used, read fresh on open, and refuses while it's used by
 * anything: deleting it would leave every one of those records pointing at a
 * project that no longer exists. The hook checks again before it deletes.
 */
function DeleteProjectDialog({
  project,
  onClose,
}: {
  project: ProjectReference;
  onClose: () => void;
}) {
  const usage = useProjectUsage(project.lookupId);
  const del = useDeleteProject();
  const busy = del.isPending;
  const inUse = (usage.data?.length ?? 0) > 0;
  const blockedReason = usage.isLoading
    ? "Checking where this project is used…"
    : usage.isError
      ? "Couldn't check where this project is used, so it can't be deleted."
      : inUse
        ? "Still in use — move those records to the project you're keeping first."
        : null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function confirm() {
    if (blockedReason || busy) return;
    try {
      await del.mutateAsync(project);
      onClose();
    } catch {
      // Toasted by the hook; keep the dialog open so the reason stays visible.
      void usage.refetch();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-project-title"
        className="mt-16 w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <h2 id="delete-project-title" className="font-display text-lg font-semibold text-fg">
          Delete project?
        </h2>
        <p className="mt-2 text-sm text-fg">
          <span className="font-medium">{project.title}</span>{" "}
          <span className="font-mono text-xs text-fg-muted">#{project.lookupId}</span>
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          For removing a duplicate. A project can only be deleted once nothing points at it.
        </p>

        <div className="mt-4 rounded-md border border-border bg-bg p-3 text-sm">
          {usage.isLoading ? (
            <span className="inline-flex items-center gap-2 text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking tasks, EIRs, ECNs, test sheets, build requests, FAITs and project folders…
            </span>
          ) : usage.isError ? (
            <span className="text-cooper-red">
              {usage.error instanceof Error ? usage.error.message : "Couldn't check where it's used."}
            </span>
          ) : inUse ? (
            <span className="text-fg">
              Still used by {describeProjectUsage(usage.data ?? [])}. Move them to the project
              you're keeping, then delete this one.
            </span>
          ) : (
            <span className="text-fg">Nothing points at this project. It can be deleted.</span>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            aria-disabled={blockedReason !== null || busy}
            title={blockedReason ?? undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md bg-cooper-red px-3 py-1.5 text-sm font-medium text-white",
              blockedReason !== null || busy
                ? "cursor-not-allowed opacity-50"
                : "hover:bg-cooper-red/90",
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {busy ? "Deleting…" : "Delete project"}
          </button>
        </div>
      </div>
    </div>
  );
}
