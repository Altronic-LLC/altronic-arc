import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, Shield, X } from "lucide-react";
import {
  useCreatePanelProject,
  usePanelProjects,
  useUpdatePanelProject,
} from "@/hooks/usePanelOrders";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { LoadingTasks } from "@/components/LoadingTasks";
import {
  PANEL_PROJECT_DEPARTMENTS,
  PANEL_PROJECT_TYPES,
  type PanelProject,
} from "@/types/task";

/**
 * Admin page for the Panel Project Reference list — mirrors
 * AdminOperationsProjectsView. Each row is a project reference number
 * (Title — numbering scheme TBD, admins type it) plus type, description,
 * DWG NO, customer, and department. Panel orders pick from this list via
 * their Project Reference dropdown.
 */
export function AdminPanelProjectsView() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const { data: projects = [], isLoading } = usePanelProjects();
  const createProject = useCreatePanelProject();
  const updateProject = useUpdatePanelProject();
  const [showNew, setShowNew] = useState(false);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <Shield className="mx-auto h-10 w-10 text-fg-muted" />
        <h1 className="mt-4 font-display text-xl font-semibold text-fg">Admin access required</h1>
        <p className="mt-2 text-sm text-fg-muted">
          The Panel Projects admin page is restricted to authorised users. If
          you need access, contact your administrator.
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

  const sorted = [...projects].sort((a, b) =>
    b.title.localeCompare(a.title, undefined, { numeric: true }),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6 sm:py-6">
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
          <h1 className="mt-1 font-display text-2xl font-semibold text-fg">Panel Projects</h1>
          <p className="mt-1 text-sm text-fg-muted">
            The master list of panel project reference numbers. New projects
            added here become available immediately in the Project Reference
            dropdown on panel orders.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Link to="/admin/admins" className="text-xs text-accent underline-offset-2 hover:underline">
            Admins →
          </Link>
          <Link to="/admin/panel-roles" className="text-xs text-accent underline-offset-2 hover:underline">
            Panel User Roles →
          </Link>
          <Link to="/admin/projects" className="text-xs text-accent underline-offset-2 hover:underline">
            Engineering Project Log →
          </Link>
          <Link to="/admin/operations-projects" className="text-xs text-accent underline-offset-2 hover:underline">
            Operations Projects →
          </Link>
        </div>
      </div>

      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Existing projects ({projects.length})
        </h2>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90"
        >
          <Plus className="h-4 w-4" />
          New project
        </button>
      </div>

      {isLoading ? (
        <LoadingTasks noun="panel projects" />
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-fg-muted">
          No projects yet. Click "New project" to add the first one.
        </div>
      ) : (
        <div className="scroll-elegant flex max-h-[36rem] flex-col gap-1.5 overflow-y-auto pr-1">
          {sorted.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              onSave={(id, input) => updateProject.mutate({ id, input })}
            />
          ))}
        </div>
      )}

      {showNew && (
        <ProjectFormModal
          title="New panel project"
          initial={{
            title: "",
            projectType: null,
            description: "",
            dwgNo: "",
            customer: "",
            department: null,
          }}
          submitting={createProject.isPending}
          onClose={() => setShowNew(false)}
          onSubmit={async (input) => {
            await createProject.mutateAsync(input);
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}

function ProjectRow({
  project,
  onSave,
}: {
  project: PanelProject;
  onSave: (id: number, input: Omit<PanelProject, "id">) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="group flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 transition-colors hover:border-fg-muted hover:bg-surface-2">
        <div className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-fg">{project.title}</span>
            {project.projectType && (
              <span className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                {project.projectType}
              </span>
            )}
            {project.department && (
              <span className="inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                {project.department}
              </span>
            )}
            {project.customer && <span className="text-xs text-fg-muted">{project.customer}</span>}
            {project.dwgNo && (
              <span className="font-mono text-[11px] text-fg-muted">DWG {project.dwgNo}</span>
            )}
          </div>
          {project.description && (
            <span className="mt-0.5 block truncate text-xs text-fg-muted">
              {project.description}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setEditing(true)}
            className="rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg group-hover:opacity-100 focus:opacity-100"
            aria-label="Edit project"
            title="Edit project"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <span className="font-mono text-[11px] text-fg-muted">#{project.id}</span>
        </div>
      </div>

      {editing && (
        <ProjectFormModal
          title={`Edit ${project.title}`}
          initial={project}
          submitting={false}
          onClose={() => setEditing(false)}
          onSubmit={async (input) => {
            onSave(project.id, input);
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

function ProjectFormModal({
  title,
  initial,
  submitting,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: Omit<PanelProject, "id"> | PanelProject;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (input: Omit<PanelProject, "id">) => Promise<void> | void;
}) {
  const [refNo, setRefNo] = useState(initial.title);
  const [projectType, setProjectType] = useState<string>(initial.projectType ?? "");
  const [description, setDescription] = useState(initial.description);
  const [dwgNo, setDwgNo] = useState(initial.dwgNo);
  const [customer, setCustomer] = useState(initial.customer);
  const [department, setDepartment] = useState<string>(initial.department ?? "");

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!refNo.trim()) return;
            void onSubmit({
              title: refNo.trim(),
              projectType: (projectType || null) as PanelProject["projectType"],
              description: description.trim(),
              dwgNo: dwgNo.trim(),
              customer: customer.trim(),
              department: (department || null) as PanelProject["department"],
            });
          }}
          className="flex flex-col gap-3"
        >
          <FieldLabel label="Project Reference Number *">
            <input
              autoFocus
              type="text"
              required
              value={refNo}
              onChange={(ev) => setRefNo(ev.target.value)}
              placeholder="e.g. P-0006"
              className="select"
            />
          </FieldLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldLabel label="Project Type">
              <select
                value={projectType}
                onChange={(ev) => setProjectType(ev.target.value)}
                className="select"
              >
                <option value="">Not set</option>
                {PANEL_PROJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <FieldLabel label="Department">
              <select
                value={department}
                onChange={(ev) => setDepartment(ev.target.value)}
                className="select"
              >
                <option value="">Not set</option>
                {PANEL_PROJECT_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </FieldLabel>
          </div>
          <FieldLabel label="Customer">
            <input
              type="text"
              value={customer}
              onChange={(ev) => setCustomer(ev.target.value)}
              placeholder="Customer name"
              className="select"
            />
          </FieldLabel>
          <FieldLabel label="DWG NO">
            <input
              type="text"
              value={dwgNo}
              onChange={(ev) => setDwgNo(ev.target.value)}
              placeholder="Drawing number"
              className="select"
            />
          </FieldLabel>
          <FieldLabel label="Project Description">
            <textarea
              value={description}
              onChange={(ev) => setDescription(ev.target.value)}
              rows={2}
              placeholder="What this project is for…"
              className="select resize-y"
            />
          </FieldLabel>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !refNo.trim()}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
