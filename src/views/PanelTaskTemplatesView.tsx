import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ListTodo, Loader2, Plus, Trash2 } from "lucide-react";
import {
  useCreatePanelTaskTemplate,
  useDeletePanelTaskTemplate,
  usePanelTaskTemplates,
  useUpdatePanelTaskTemplate,
} from "@/hooks/usePanelTaskTemplates";
import { usePanelTeamAccess } from "@/hooks/usePanelRoles";
import { PANEL_TASK_TEMPLATES_CONFIGURED } from "@/api/panelTaskTemplates";
import type { PanelTaskTemplateInput } from "@/api/panelTaskTemplates";
import { PANEL_TASK_TYPES, type PanelTaskTemplate, type PanelTaskType } from "@/types/task";
import { panelTaskTemplateProblem } from "@/lib/panelOrderTasks";
import { parseEstimatedHours } from "@/lib/capacity";
import { LoadingTasks } from "@/components/LoadingTasks";
import { ListAccessNotice } from "@/components/ListAccessNotice";
import { ChoiceSelect } from "@/components/SearchableSelect";
import { isAccessDeniedError } from "@/lib/listAccess";

// =============================================================================
// Panel Orders → Standard tasks (/panels/task-templates). The tasks every new
// Panel Order raises — ARC's version of Wrike's "Panel Blueprint - Production
// Job". Readable by anyone (the New Order form lists them); changed by a panel
// Manager, Admin or Super User, or an ARC admin.
//
// A short ordered list, not a table: the order IS the content (it's the order
// tasks are raised in), so it's arrows, not column sorting.
// =============================================================================

interface Draft {
  title: string;
  taskType: string;
  hours: string;
  active: boolean;
}

function draftOf(t: PanelTaskTemplate | null): Draft {
  return {
    title: t?.title ?? "",
    taskType: t?.taskType ?? "",
    hours: t?.estimatedHours === null || t?.estimatedHours === undefined ? "" : String(t.estimatedHours),
    active: t?.active ?? true,
  };
}

function inputOf(d: Draft, sortOrder: number): PanelTaskTemplateInput | string {
  const hours = parseEstimatedHours(d.hours);
  const input = {
    title: d.title.trim(),
    taskType: (d.taskType || null) as PanelTaskType | null,
    estimatedHours: hours,
    sortOrder,
    active: d.active,
  };
  return panelTaskTemplateProblem(input) ?? input;
}

export function PanelTaskTemplatesView() {
  const { data: rows = [], isLoading, error, refetch } = usePanelTaskTemplates();
  const access = usePanelTeamAccess();
  const canEdit = access.canManageTemplates && PANEL_TASK_TEMPLATES_CONFIGURED;
  const create = useCreatePanelTaskTemplate();
  const update = useUpdatePanelTaskTemplate();
  const remove = useDeletePanelTaskTemplate();
  const [adding, setAdding] = useState(false);

  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  async function move(index: number, by: -1 | 1) {
    const a = sorted[index];
    const b = sorted[index + by];
    if (!a || !b) return;
    // Swap the two orders; if they were equal, make them distinct.
    const aOrder = b.sortOrder === a.sortOrder ? a.sortOrder + by : b.sortOrder;
    await update.mutateAsync({ id: a.id, input: { ...a, sortOrder: aOrder } });
    await update.mutateAsync({ id: b.id, input: { ...b, sortOrder: a.sortOrder } });
  }

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <ListTodo className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-fg">Standard tasks</h1>
            <p className="text-sm text-fg-muted">
              The tasks every new <Link to="/panels/orders" className="underline">Panel Order</Link>{" "}
              raises, in this order. Changing one changes no task already raised.
            </p>
          </div>
        </div>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" /> Add task
          </button>
        )}
      </div>

      {!PANEL_TASK_TEMPLATES_CONFIGURED && (
        <div className="rounded-md border border-ajax-yellow/50 bg-ajax-yellow/10 px-3 py-2 text-sm text-fg">
          The Panel Task Templates list isn't set up yet, so new orders raise the four built-in
          tasks below and they can't be changed here. Run scripts/setup-panel-planning.ps1 and
          set VITE_SP_PANEL_TASK_TEMPLATES_LIST_ID.
        </div>
      )}
      {PANEL_TASK_TEMPLATES_CONFIGURED && !access.canManageTemplates && access.templatesHint && (
        <p className="text-sm text-fg-muted">{access.templatesHint}</p>
      )}

      {isLoading ? (
        <LoadingTasks noun="the standard tasks" />
      ) : error ? (
        isAccessDeniedError(error) ? (
          <ListAccessNotice list="Panel Task Templates" site="ALTRONICPANELTEAM" onRetry={() => void refetch()} />
        ) : (
          <p className="text-sm text-cooper-red">
            Couldn't load the standard tasks: {error instanceof Error ? error.message : String(error)}
          </p>
        )
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Standard tasks">
          {sorted.map((t, i) => (
            <TemplateRow
              key={t.id}
              template={t}
              canEdit={canEdit}
              busy={update.isPending || remove.isPending}
              first={i === 0}
              last={i === sorted.length - 1}
              onMove={(by) => void move(i, by)}
              onSave={(input) => update.mutateAsync({ id: t.id, input })}
              onRemove={() => remove.mutate(t.id)}
            />
          ))}
          {sorted.length === 0 && (
            <li className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-fg-muted">
              No standard tasks — new orders won't raise any.
            </li>
          )}
          {adding && (
            <TemplateEditor
              initial={draftOf(null)}
              saveLabel="Add"
              busy={create.isPending}
              onCancel={() => setAdding(false)}
              onSave={async (d) => {
                const next = Math.max(0, ...sorted.map((r) => r.sortOrder)) + 1;
                const input = inputOf(d, next);
                if (typeof input === "string") return input;
                await create.mutateAsync(input);
                setAdding(false);
                return null;
              }}
            />
          )}
        </ol>
      )}
    </div>
  );
}

function TemplateRow({
  template,
  canEdit,
  busy,
  first,
  last,
  onMove,
  onSave,
  onRemove,
}: {
  template: PanelTaskTemplate;
  canEdit: boolean;
  busy: boolean;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
  onSave: (input: PanelTaskTemplateInput) => Promise<unknown>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <TemplateEditor
        initial={draftOf(template)}
        saveLabel="Save"
        busy={busy}
        onCancel={() => setEditing(false)}
        onSave={async (d) => {
          const input = inputOf(d, template.sortOrder);
          if (typeof input === "string") return input;
          await onSave(input);
          setEditing(false);
          return null;
        }}
      />
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-fg">
          {template.title}
          {!template.active && (
            <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase text-fg-muted">
              Not raised
            </span>
          )}
        </div>
        <div className="text-xs text-fg-muted">
          {template.taskType ?? "No type"} ·{" "}
          {template.estimatedHours === null ? "no hours" : `${template.estimatedHours}h`}
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1">
          <IconButton label={`Move ${template.title} up`} disabled={first || busy} onClick={() => onMove(-1)}>
            <ArrowUp className="h-4 w-4" />
          </IconButton>
          <IconButton label={`Move ${template.title} down`} disabled={last || busy} onClick={() => onMove(1)}>
            <ArrowDown className="h-4 w-4" />
          </IconButton>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md px-2 py-1 text-sm text-accent hover:bg-surface-2"
          >
            Edit
          </button>
          <IconButton
            label={`Remove ${template.title}`}
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Remove "${template.title}"? New orders stop raising it; tasks already raised stay.`)) {
                onRemove();
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      )}
    </li>
  );
}

function TemplateEditor({
  initial,
  saveLabel,
  busy,
  onCancel,
  onSave,
}: {
  initial: Draft;
  saveLabel: string;
  busy: boolean;
  onCancel: () => void;
  /** Returns a problem to show, or null when saved. */
  onSave: (d: Draft) => Promise<string | null>;
}) {
  const [d, setD] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <li className="rounded-md border border-accent/50 bg-surface px-3 py-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            setProblem(await onSave(d));
          } catch {
            // The hook has already toasted why.
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wider text-fg-muted">Task</span>
          <input
            className="select"
            value={d.title}
            onChange={(e) => setD({ ...d, title: e.target.value })}
            placeholder="e.g. Drawing Creation"
            autoFocus
          />
        </label>
        {/* A div, not a label: the picker's own buttons would steal its click. */}
        <div className="flex w-40 flex-col gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wider text-fg-muted">Type</span>
          <ChoiceSelect
            value={d.taskType}
            onChange={(v) => setD({ ...d, taskType: v })}
            options={PANEL_TASK_TYPES}
            emptyLabel="No type"
            ariaLabel="Type"
          />
        </div>
        <label className="flex w-24 flex-col gap-1 text-xs">
          <span className="font-semibold uppercase tracking-wider text-fg-muted">Hours</span>
          <input
            className="select"
            inputMode="decimal"
            value={d.hours}
            onChange={(e) => setD({ ...d, hours: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-sm text-fg">
          <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />
          Raise on new orders
        </label>
        <div className="flex gap-2 pb-0.5">
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !d.title.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {saveLabel}
          </button>
        </div>
        {problem && <p className="w-full text-xs text-cooper-red">{problem}</p>}
      </form>
    </li>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30"
    >
      {children}
    </button>
  );
}
