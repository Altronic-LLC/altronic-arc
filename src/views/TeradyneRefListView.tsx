import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Info, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  useCreateTeradyneRef,
  useDeleteTeradyneRef,
  useTeradyneRefUsage,
  useTeradyneRefs,
  useUpdateTeradyneRef,
} from "@/hooks/useTeradyne";
import { LoadingTasks } from "@/components/LoadingTasks";
import { buildTeradyneEmployeeTitle } from "@/lib/teradyneMapper";
import {
  TERADYNE_REF_KINDS,
  type TeradyneEmployee,
  type TeradyneProduct,
  type TeradyneRefInput,
  type TeradyneRefKind,
  type TeradyneRefRow,
} from "@/types/task";

// =============================================================================
// Manage one of the three Teradyne reference lists (Employees / Products /
// Remarks). ONE view for all three, picked by the :kind route param — the lists
// differ only in which columns they carry, so three copies of this screen would
// be three places to fix every bug.
//
// Open to any signed-in user (no admin gate) — reached from "Manage lists" on
// the Teradyne Log. Client-side openness is a UX decision, not a security one:
// SharePoint's own list permissions are what actually govern who can write.
//
// Deleting is blocked while a row is still referenced by the log, because these
// lists don't have SharePoint referential integrity switched on — the lookups
// would silently degrade to "(missing #n)" on every affected entry.
// =============================================================================

interface KindConfig {
  title: string;
  singular: string;
  blurb: string;
  /** Which editable fields this list shows. */
  fields: Array<"name" | "firstLast" | "clockNum" | "workCenter" | "testOnStation">;
}

const KINDS: Record<TeradyneRefKind, KindConfig> = {
  employees: {
    title: "Teradyne Employees",
    singular: "employee",
    blurb:
      "People who can be logged against a test entry. The displayed name is built from the first and last name, and the clock number auto-fills onto new log entries.",
    fields: ["firstLast", "clockNum", "workCenter"],
  },
  products: {
    title: "Teradyne Products",
    singular: "product",
    blurb:
      "Boards and assemblies that get tested. The product name is half of each log entry's name, so keep it as it appears on the tester.",
    fields: ["name", "testOnStation"],
  },
  remarks: {
    title: "Teradyne Remarks",
    singular: "remark",
    blurb:
      "The canned failure descriptions operators pick from. Add one here and it's immediately available on the log.",
    fields: ["name"],
  },
};

function isEmployee(row: TeradyneRefRow): row is TeradyneEmployee {
  return "firstName" in row;
}
function isProduct(row: TeradyneRefRow): row is TeradyneProduct {
  return "testOnStation" in row;
}

export function TeradyneRefListView() {
  const { kind: rawKind } = useParams<{ kind: string }>();
  const kind = (TERADYNE_REF_KINDS as readonly string[]).includes(rawKind ?? "")
    ? (rawKind as TeradyneRefKind)
    : null;

  // An unknown :kind is a typo'd URL, not an error state worth a screen.
  if (!kind) return <Navigate to="/operations/teradyne" replace />;
  return <RefList kind={kind} />;
}

function RefList({ kind }: { kind: TeradyneRefKind }) {
  const navigate = useNavigate();
  const config = KINDS[kind];
  const { data: rows = [], isLoading } = useTeradyneRefs(kind);
  const { usage, isLoading: usageLoading } = useTeradyneRefUsage(kind);
  const createRef = useCreateTeradyneRef(kind);
  const updateRef = useUpdateTeradyneRef(kind);
  const deleteRef = useDeleteTeradyneRef(kind);

  const [draft, setDraft] = useState<TeradyneRefInput>(emptyInput());

  const canCreate = config.fields.includes("firstLast")
    ? Boolean((draft.firstName ?? "").trim() || (draft.lastName ?? "").trim())
    : Boolean(draft.title.trim());

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    const input: TeradyneRefInput = config.fields.includes("firstLast")
      ? { ...draft, title: buildTeradyneEmployeeTitle(draft.firstName, draft.lastName) }
      : draft;
    await createRef.mutateAsync(input);
    setDraft(emptyInput());
  }

  async function handleDelete(row: TeradyneRefRow) {
    // Belt and braces: the button is already disabled in both these cases, but
    // deleting a referenced row is the one irreversible thing on this screen.
    if (usageLoading) return;
    const inUse = usage.get(row.lookupId) ?? 0;
    if (inUse > 0) return;
    const ok = window.confirm(
      `Remove “${row.title}” from ${config.title}?\n\nNothing in the log references it, so this is safe. It can't be undone from here.`,
    );
    if (!ok) return;
    await deleteRef.mutateAsync(row.lookupId);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6 sm:py-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            Teradyne reference list
          </div>
          <h1 className="mt-1 font-display text-2xl font-semibold text-fg">{config.title}</h1>
          <p className="mt-1 max-w-xl text-sm text-fg-muted">{config.blurb}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Link
            to="/operations/teradyne"
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            Teradyne Log →
          </Link>
          {TERADYNE_REF_KINDS.filter((k) => k !== kind).map((k) => (
            <Link
              key={k}
              to={`/operations/teradyne/${k}`}
              className="text-xs text-accent underline-offset-2 hover:underline"
            >
              {KINDS[k].title} →
            </Link>
          ))}
        </div>
      </div>

      <section className="mb-6 rounded-lg border border-border bg-surface p-4 sm:p-5">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Add {config.singular}
        </h2>
        <form onSubmit={handleCreate} className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            {config.fields.includes("firstLast") && (
              <>
                <Labelled label="First name" className="flex-1">
                  <input
                    type="text"
                    value={draft.firstName ?? ""}
                    onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
                    className="select"
                    disabled={createRef.isPending}
                  />
                </Labelled>
                <Labelled label="Last name" className="flex-1">
                  <input
                    type="text"
                    value={draft.lastName ?? ""}
                    onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
                    className="select"
                    disabled={createRef.isPending}
                  />
                </Labelled>
              </>
            )}
            {config.fields.includes("name") && (
              <Labelled label={kind === "products" ? "Product" : "Remark"} className="flex-1">
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder={
                    kind === "products" ? "e.g. EX-4000 Display 672337-1" : "e.g. Solder bridge"
                  }
                  className="select"
                  disabled={createRef.isPending}
                />
              </Labelled>
            )}
            {config.fields.includes("clockNum") && (
              <Labelled label="Clock #" className="sm:w-24">
                <input
                  type="number"
                  value={draft.clockNum ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      clockNum: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="select"
                  disabled={createRef.isPending}
                />
              </Labelled>
            )}
            {config.fields.includes("workCenter") && (
              <Labelled label="Work center" className="sm:w-32">
                <input
                  type="text"
                  value={draft.workCenter ?? ""}
                  onChange={(e) => setDraft({ ...draft, workCenter: e.target.value })}
                  placeholder="PCB"
                  className="select"
                  disabled={createRef.isPending}
                />
              </Labelled>
            )}
            {config.fields.includes("testOnStation") && (
              <Labelled label="Test on station" className="sm:w-40">
                <input
                  type="text"
                  value={draft.testOnStation ?? ""}
                  onChange={(e) => setDraft({ ...draft, testOnStation: e.target.value })}
                  placeholder="Spea"
                  className="select"
                  disabled={createRef.isPending}
                />
              </Labelled>
            )}
            <button
              type="submit"
              disabled={!canCreate || createRef.isPending}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {createRef.isPending ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </section>

      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          {config.title} ({rows.length})
        </h2>
      </div>

      {isLoading ? (
        <LoadingTasks noun={config.title} />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-fg-muted">
          Nothing here yet. Add the first {config.singular} above.
        </div>
      ) : (
        <div className="scroll-elegant flex max-h-[36rem] flex-col gap-1.5 overflow-y-auto pr-1">
          {rows.map((row) => (
            <RefRow
              key={row.lookupId}
              row={row}
              config={config}
              inUse={usage.get(row.lookupId) ?? 0}
              usageLoading={usageLoading}
              onSave={(input) => updateRef.mutate({ lookupId: row.lookupId, input })}
              onDelete={() => handleDelete(row)}
            />
          ))}
        </div>
      )}

      <p className="mt-4 flex items-start gap-1.5 text-[11px] text-fg-muted">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>
          Renaming a row updates it everywhere the log shows it. Rows already used by a log entry
          can't be deleted — edit them instead, so past entries keep reading correctly.
        </span>
      </p>
    </div>
  );
}

function emptyInput(): TeradyneRefInput {
  return {
    title: "",
    firstName: "",
    lastName: "",
    clockNum: null,
    workCenter: "",
    testOnStation: "",
  };
}

function rowToInput(row: TeradyneRefRow): TeradyneRefInput {
  return {
    title: row.title,
    firstName: isEmployee(row) ? row.firstName : "",
    lastName: isEmployee(row) ? row.lastName : "",
    clockNum: isEmployee(row) ? row.clockNum : null,
    workCenter: isEmployee(row) ? row.workCenter : "",
    testOnStation: isProduct(row) ? row.testOnStation : "",
  };
}

function RefRow({
  row,
  config,
  inUse,
  usageLoading,
  onSave,
  onDelete,
}: {
  row: TeradyneRefRow;
  config: KindConfig;
  inUse: number;
  /** True while the log is still loading, so `inUse` can't be trusted yet. */
  usageLoading: boolean;
  onSave: (input: TeradyneRefInput) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TeradyneRefInput>(() => rowToInput(row));

  function startEdit() {
    setDraft(rowToInput(row));
    setEditing(true);
  }

  function save() {
    const input = config.fields.includes("firstLast")
      ? { ...draft, title: buildTeradyneEmployeeTitle(draft.firstName, draft.lastName) }
      : draft;
    if (!input.title.trim()) return;
    onSave(input);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/50 bg-surface px-2 py-1.5">
        {config.fields.includes("firstLast") && (
          <>
            <input
              autoFocus
              value={draft.firstName ?? ""}
              onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
              placeholder="First"
              className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <input
              value={draft.lastName ?? ""}
              onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
              placeholder="Last"
              className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </>
        )}
        {config.fields.includes("name") && (
          <input
            autoFocus
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            maxLength={255}
          />
        )}
        {config.fields.includes("clockNum") && (
          <input
            type="number"
            value={draft.clockNum ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, clockNum: e.target.value === "" ? null : Number(e.target.value) })
            }
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            placeholder="Clock"
            className="w-20 shrink-0 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        )}
        {config.fields.includes("workCenter") && (
          <input
            value={draft.workCenter ?? ""}
            onChange={(e) => setDraft({ ...draft, workCenter: e.target.value })}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            placeholder="Work center"
            className="w-28 shrink-0 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        )}
        {config.fields.includes("testOnStation") && (
          <input
            value={draft.testOnStation ?? ""}
            onChange={(e) => setDraft({ ...draft, testOnStation: e.target.value })}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            placeholder="Station"
            className="w-28 shrink-0 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        )}
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

  const meta: string[] = [];
  if (isEmployee(row)) {
    if (row.clockNum != null) meta.push(`Clock #${row.clockNum}`);
    if (row.workCenter) meta.push(row.workCenter);
  }
  if (isProduct(row) && row.testOnStation) meta.push(row.testOnStation);

  return (
    <div className="group flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 transition-colors hover:border-fg-muted hover:bg-surface-2">
      <div className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-fg">{row.title || "(no name)"}</span>
        {meta.length > 0 && (
          <span className="mt-0.5 block truncate text-xs text-fg-muted">{meta.join(" · ")}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] text-fg-muted">
          {usageLoading ? "checking…" : inUse > 0 ? `${inUse} ${inUse === 1 ? "entry" : "entries"}` : "unused"}
        </span>
        <button
          onClick={startEdit}
          className="rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
          aria-label={`Edit ${row.title}`}
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          disabled={usageLoading || inUse > 0}
          className="rounded p-1 text-fg-muted transition-opacity hover:bg-surface hover:text-cooper-red disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-fg-muted"
          aria-label={`Delete ${row.title}`}
          title={
            usageLoading
              ? "Checking whether the log uses this…"
              : inUse > 0
                ? `Used by ${inUse} log ${inUse === 1 ? "entry" : "entries"} — edit it instead`
                : "Delete"
          }
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <span className="font-mono text-[11px] text-fg-muted">#{row.lookupId}</span>
      </div>
    </div>
  );
}

function Labelled({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex w-full flex-col gap-1 ${className ?? ""}`}>
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
