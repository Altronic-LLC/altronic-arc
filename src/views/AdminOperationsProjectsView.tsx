import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, Shield, X } from "lucide-react";
import {
  useCreateOperationsProject,
  useOperationsProjects,
  useUpdateOperationsProject,
} from "@/hooks/useOperationsTasks";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { LoadingTasks } from "@/components/LoadingTasks";
import type { ProjectReference } from "@/types/task";

/**
 * Admin page for the Operations Projects list — mirrors AdminProjectsView.tsx
 * (the Engineering Project Log admin page), but this list keeps the project
 * number and name in separate SharePoint columns (ProjectNumber, Title) plus
 * a combined ProjectRef ("0002-Name") that tasks actually look up against —
 * so create/rename take two inputs instead of Engineering's single combined
 * Title field. No bucket taxonomy here (Operations project numbers are just
 * sequential), so it's one flat sorted table.
 */
export function AdminOperationsProjectsView() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const { data: projects = [], isLoading } = useOperationsProjects();
  const createProject = useCreateOperationsProject();
  const updateProject = useUpdateOperationsProject();
  const [newNumber, setNewNumber] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <Shield className="mx-auto h-10 w-10 text-fg-muted" />
        <h1 className="mt-4 font-display text-xl font-semibold text-fg">Admin access required</h1>
        <p className="mt-2 text-sm text-fg-muted">
          The Operations Projects admin page is restricted to authorised
          users. If you need access, contact your administrator.
        </p>
        <button
          onClick={() => navigate("/")}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent underline-offset-2 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </button>
      </div>
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const projectNumber = newNumber.trim();
    const title = newTitle.trim();
    if (!projectNumber || !title) return;
    await createProject.mutateAsync({
      projectNumber,
      title,
      description: newDescription.trim() || undefined,
    });
    setNewNumber("");
    setNewTitle("");
    setNewDescription("");
  }

  const sorted = [...projects].sort((a, b) =>
    b.title.localeCompare(a.title, undefined, { numeric: true }),
  );

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
            Operations Projects
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            The master list of Operations projects. New projects added here
            become available immediately as the Project Ref choice on
            Operations tasks.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Link to="/admin/admins" className="text-xs text-accent underline-offset-2 hover:underline">
            Admins →
          </Link>
          <Link to="/admin/projects" className="text-xs text-accent underline-offset-2 hover:underline">
            Engineering Project Log →
          </Link>
          <Link to="/admin/eir-roles" className="text-xs text-accent underline-offset-2 hover:underline">
            EIR Roles →
          </Link>
          <Link to="/admin/panel-projects" className="text-xs text-accent underline-offset-2 hover:underline">
            Panel Projects →
          </Link>
        </div>
      </div>

      <section className="mb-6 rounded-lg border border-border bg-surface p-4 sm:p-5">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Add new project
        </h2>
        <form onSubmit={handleCreate} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex w-full flex-col gap-1 sm:w-28">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Number
            </span>
            <input
              type="text"
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              placeholder="e.g. 0004"
              className="rounded-md border border-border bg-bg px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              disabled={createProject.isPending}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Name
            </span>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. New Conveyor Install"
              className="rounded-md border border-border bg-bg px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              disabled={createProject.isPending}
            />
          </label>
          <button
            type="submit"
            disabled={!newNumber.trim() || !newTitle.trim() || createProject.isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {createProject.isPending ? "Creating…" : "Create"}
          </button>
        </form>
        <label className="mt-2 flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Description (optional)
          </span>
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="What this project is for…"
            rows={2}
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            disabled={createProject.isPending}
          />
        </label>
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
        <div className="scroll-elegant flex max-h-[32rem] flex-col gap-1.5 overflow-y-auto pr-1">
          {sorted.map((p) => (
            <ProjectRow
              key={p.lookupId}
              project={p}
              onRename={(lookupId, projectNumber, title, description) =>
                updateProject.mutate({ lookupId, projectNumber, title, description })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Split a "0002-Name" ProjectRef back into its number/name parts for editing. */
function splitRef(title: string): { projectNumber: string; name: string } {
  const m = /^(\d+)-(.*)$/.exec(title);
  return m ? { projectNumber: m[1], name: m[2] } : { projectNumber: "", name: title };
}

function ProjectRow({
  project,
  onRename,
}: {
  project: ProjectReference;
  onRename: (lookupId: number, projectNumber: string, title: string, description?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const initial = splitRef(project.title);
  const [draftNumber, setDraftNumber] = useState(initial.projectNumber);
  const [draftName, setDraftName] = useState(initial.name);
  const [draftDescription, setDraftDescription] = useState(project.description ?? "");

  function startEdit() {
    const parts = splitRef(project.title);
    setDraftNumber(parts.projectNumber);
    setDraftName(parts.name);
    setDraftDescription(project.description ?? "");
    setEditing(true);
  }

  function save() {
    const number = draftNumber.trim();
    const name = draftName.trim();
    if (number && name) onRename(project.lookupId, number, name, draftDescription.trim());
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-accent/50 bg-surface px-2 py-1.5">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draftNumber}
            onChange={(e) => setDraftNumber(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-16 shrink-0 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            maxLength={10}
          />
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
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
        <textarea
          value={draftDescription}
          onChange={(e) => setDraftDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="Description (optional)"
          rows={2}
          className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 transition-colors hover:border-fg-muted hover:bg-surface-2">
      <div className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-fg">{project.title}</span>
        {project.description && (
          <span className="mt-0.5 block truncate text-xs text-fg-muted">
            {project.description}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={startEdit}
          className="rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg group-hover:opacity-100 focus:opacity-100"
          aria-label="Edit project number / name / description"
          title="Edit number / name / description"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <span className="font-mono text-[11px] text-fg-muted">#{project.lookupId}</span>
      </div>
    </div>
  );
}
