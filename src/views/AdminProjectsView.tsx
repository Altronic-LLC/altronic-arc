import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Shield } from "lucide-react";
import { useCreateProject, useProjects } from "@/hooks/useTasks";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { LoadingTasks } from "@/components/LoadingTasks";
import type { ProjectReference } from "@/types/task";

// The Engineering Project Log is organised into tables by the first digit of
// each project's number:
//   0xxx → Engineering items that aren't products
//   5xxx → Insourcing projects
//   any other leading number → New & Legacy projects (new = next number +
//     requesting engineer's initials; legacy = 2xxx, no prior number) — these
//     are treated as one table
//   no leading number → Other
type BucketKey = "projects" | "eng" | "insourcing" | "other";

function classifyProject(title: string): BucketKey {
  const m = /^\s*(\d)/.exec(title ?? "");
  if (!m) return "other";
  switch (m[1]) {
    case "0":
      return "eng";
    case "5":
      return "insourcing";
    default:
      // 1–4, 6–9 → new projects + legacy 2xxx (one combined table).
      return "projects";
  }
}

// Display order + labels for each table. "Other" is rendered only when it has
// entries; the three defined tables always show (even empty) so the taxonomy
// is visible.
const BUCKETS: { key: BucketKey; label: string; hint: string }[] = [
  { key: "projects", label: "New & Legacy Projects", hint: "number + initials · 2xxx legacy" },
  { key: "eng", label: "Engineering Items", hint: "0xxx · not products" },
  { key: "insourcing", label: "Insourcing", hint: "5xxx" },
  { key: "other", label: "Other", hint: "no number prefix" },
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
  const [newTitle, setNewTitle] = useState("");

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

  const grouped = useMemo(() => {
    const g: Record<BucketKey, ProjectReference[]> = {
      projects: [],
      eng: [],
      insourcing: [],
      other: [],
    };
    for (const p of projects) g[classifyProject(p.title)].push(p);
    // Highest number first within each table (descending, numeric-aware).
    for (const key of Object.keys(g) as BucketKey[]) {
      g[key].sort((a, b) => b.title.localeCompare(a.title, undefined, { numeric: true }));
    }
    return g;
  }, [projects]);

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

      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Existing projects ({projects.length})
        </h2>
      </div>

      {isLoading ? (
        <LoadingTasks noun="projects" />
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-fg-muted">
          No projects yet. Add one above.
        </div>
      ) : (
        // Three tables wide on large screens (New & Legacy · Engineering Items
        // · Insourcing), single column on smaller screens. "Other" wraps below.
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
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
                items={items}
                onOpen={(id) => navigate(`/project/${id}`)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One titled table of projects within the Engineering Project Log. */
function ProjectTable({
  label,
  hint,
  items,
  onOpen,
}: {
  label: string;
  hint: string;
  items: ProjectReference[];
  onOpen: (lookupId: number) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-3">
        <h3 className="flex items-baseline gap-2 font-display text-sm font-semibold uppercase tracking-wider text-fg">
          {label}
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-fg-muted">
            {items.length}
          </span>
        </h3>
        <span className="text-[11px] text-fg-muted">{hint}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      {items.length === 0 ? (
        <p className="px-1 py-2 text-xs text-fg-muted">No projects in this series yet.</p>
      ) : (
        <div className="scroll-elegant flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto pr-1">
          {items.map((p) => (
            <button
              key={p.lookupId}
              onClick={() => onOpen(p.lookupId)}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left text-sm text-fg transition-colors hover:border-fg-muted hover:bg-surface-2"
            >
              <span className="truncate font-medium">{p.title}</span>
              <span className="shrink-0 font-mono text-[11px] text-fg-muted">#{p.lookupId}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
