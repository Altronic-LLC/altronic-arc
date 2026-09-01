import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowUpFromLine, Building2, Check, MapPin, Plus, Shield, X } from "lucide-react";
import {
  useCreateMaintenanceReferenceValue,
  useMaintenanceReferenceValues,
  useSetMaintenanceReferenceValueActive,
  useUpdateMaintenanceReferenceValue,
} from "@/hooks/useMaintenanceReferenceLists";
import { useMyMaintenanceRoles } from "@/hooks/useMaintenanceRoles";
import { manageAssetsGate } from "@/lib/maintenanceRoles";
import { duplicateHints } from "@/lib/maintenanceReferences";
import { LoadingTasks } from "@/components/LoadingTasks";
import type { MaintenanceReferenceKind, MaintenanceReferenceValue } from "@/types/task";

// =============================================================================
// Admin → Maintenance reference lists.
//
// ONE screen for BOTH lists — Maintenance Departments and Maintenance
// Locations. They are structurally identical (Title, Active, Note), they are
// maintained by the same person in the same sitting, and two screens is how
// one of them quietly grows a feature the other lacks. Same reasoning as the
// single parametrised api/maintenanceReferenceLists.ts behind it.
//
// **These lists exist because Department and Location used to be CHOICE
// columns.** A choice column's allowed values live in the column DEFINITION,
// so adding one needed site-manage rights that nobody in the shop has; adding
// a lookup value is adding a list item, which ARC's `Sites.Selected` grant
// already covers. That is the whole point of this screen.
//
// Three rules it holds to:
//
//  1. **Retire, never delete.** Hundreds of assets and work orders point at
//     these rows. `Active = false` takes a value out of every picker while
//     every record already using it keeps showing it — see the note at the top
//     of api/maintenanceReferenceLists.ts. There is no delete button here
//     because there is no delete in the API.
//  2. **Duplicates are FLAGGED, never merged.** The seeded Locations list
//     holds a literal `-`, "Q.C." beside "QC" and "Q.C. DIGITAL" beside "QC
//     DIGITAL". Which of a pair survives, and what happens to the rows
//     pointing at the other, is a judgement about real data — so this screen
//     says "looks like a duplicate of X" and stops there.
//  3. **Renaming is safe, and that is new.** A lookup rename carries every
//     record pointing at it; under the old choice column, fixing a typo meant
//     editing the column definition AND every row holding the old spelling.
//     The screen says so, because people arrive expecting the old danger.
//
// Gated by `manageAssetsGate` — "manage the asset register, departments and
// locations", maintenance admins only. That gate was written when the CMMS
// roles landed and had no caller until this screen; asking it rather than
// inventing a fourth rule here is the point of it existing. As ever, this is
// UI-level gating: SharePoint's own list permissions are the real boundary,
// and every mutation re-checks the same gate inside its `mutationFn`.
// =============================================================================

interface TabSpec {
  kind: MaintenanceReferenceKind;
  label: string;
  singular: string;
  icon: typeof Building2;
  blurb: string;
}

const TABS: TabSpec[] = [
  {
    kind: "departments",
    label: "Departments",
    singular: "department",
    icon: Building2,
    blurb:
      "The owning shop-floor departments, offered on every asset, work order and PM schedule.",
  },
  {
    kind: "locations",
    label: "Locations",
    singular: "location",
    icon: MapPin,
    blurb: "Where things physically are. Longer and messier than Departments — see the flags below.",
  },
];

export default function AdminMaintenanceReferenceListsView() {
  const navigate = useNavigate();
  const access = useMyMaintenanceRoles();
  const gate = manageAssetsGate(access);
  const [kind, setKind] = useState<MaintenanceReferenceKind>("departments");

  if (gate.resolving) {
    return <LoadingTasks noun="maintenance permissions" />;
  }

  if (!gate.allowed) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <Shield className="mx-auto h-10 w-10 text-fg-muted" />
        <h1 className="mt-4 font-display text-xl font-semibold text-fg">
          Maintenance admin access required
        </h1>
        <p className="mt-2 text-sm text-fg-muted">{gate.hint}</p>
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

  const tab = TABS.find((t) => t.kind === kind) ?? TABS[0];

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
            Maintenance reference lists
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Departments and Locations for the CMMS. A value added here is available immediately on
            every asset, work order and PM schedule — and renaming one carries every record already
            pointing at it, so fixing a typo is safe.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Link
            to="/admin/maintenance-roles"
            className="text-xs text-accent underline-offset-2 hover:underline"
          >
            Maintenance Roles →
          </Link>
          <Link to="/admin/admins" className="text-xs text-accent underline-offset-2 hover:underline">
            Admins →
          </Link>
        </div>
      </div>

      <div role="tablist" aria-label="Reference list" className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const selected = t.kind === kind;
          return (
            <button
              key={t.kind}
              role="tab"
              aria-selected={selected}
              onClick={() => setKind(t.kind)}
              className={
                selected
                  ? "inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
                  : "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
              }
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Keyed on the kind so switching tabs resets the add form and any row
          mid-edit — carrying a half-typed department across to Locations would
          be a way to add it to the wrong list. */}
      <ReferenceListPanel key={tab.kind} tab={tab} />
    </div>
  );
}

function ReferenceListPanel({ tab }: { tab: TabSpec }) {
  const { data: values = [], isLoading } = useMaintenanceReferenceValues(tab.kind);
  const create = useCreateMaintenanceReferenceValue();
  const update = useUpdateMaintenanceReferenceValue();
  const setActive = useSetMaintenanceReferenceValueActive();
  const [newTitle, setNewTitle] = useState("");
  const [showRetired, setShowRetired] = useState(false);

  const duplicates = useMemo(() => duplicateHints(values), [values]);
  const active = values.filter((v) => v.active);
  const retired = values.filter((v) => !v.active);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    await create.mutateAsync({ kind: tab.kind, input: { title } });
    setNewTitle("");
  }

  return (
    <>
      <section className="mb-6 rounded-lg border border-border bg-surface p-4 sm:p-5">
        <h2 className="mb-1 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Add a {tab.singular}
        </h2>
        <p className="mb-3 text-xs text-fg-muted">{tab.blurb}</p>
        <form onSubmit={handleCreate} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Name
            </span>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={tab.kind === "departments" ? "e.g. MACH SHOP" : "e.g. COMPRESSOR ROOM"}
              className="rounded-md border border-border bg-bg px-3 py-2 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:text-sm"
              disabled={create.isPending}
            />
          </label>
          <button
            type="submit"
            disabled={!newTitle.trim() || create.isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {create.isPending ? "Adding…" : "Add"}
          </button>
        </form>
      </section>

      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          In use ({active.length})
        </h2>
      </div>

      {isLoading ? (
        <LoadingTasks noun={tab.label.toLowerCase()} />
      ) : active.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-fg-muted">
          Nothing here yet. Add one above.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {active.map((value) => (
            <ValueRow
              key={value.lookupId}
              value={value}
              duplicateOf={duplicates.get(value.lookupId) ?? []}
              onRename={(title) =>
                update.mutate({ kind: tab.kind, lookupId: value.lookupId, input: { title } })
              }
              onSetActive={(next) =>
                setActive.mutate({ kind: tab.kind, lookupId: value.lookupId, active: next })
              }
            />
          ))}
        </div>
      )}

      {retired.length > 0 && (
        <section className="mt-6">
          <button
            onClick={() => setShowRetired((s) => !s)}
            aria-expanded={showRetired}
            className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          >
            Retired ({retired.length})
          </button>
          {/* Retired values are collapsed by default but never hidden: a
              record still pointing at one shows it, so whoever is asked "why
              does this asset say Q.C.?" has to be able to find it. */}
          {showRetired && (
            <div className="flex flex-col gap-1.5">
              {retired.map((value) => (
                <ValueRow
                  key={value.lookupId}
                  value={value}
                  duplicateOf={duplicates.get(value.lookupId) ?? []}
                  onRename={(title) =>
                    update.mutate({ kind: tab.kind, lookupId: value.lookupId, input: { title } })
                  }
                  onSetActive={(next) =>
                    setActive.mutate({ kind: tab.kind, lookupId: value.lookupId, active: next })
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function ValueRow({
  value,
  duplicateOf,
  onRename,
  onSetActive,
}: {
  value: MaintenanceReferenceValue;
  /** Titles this one looks like a duplicate of. A hint only — nothing merges. */
  duplicateOf: string[];
  onRename: (title: string) => void;
  onSetActive: (active: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value.title);

  function save() {
    const title = draft.trim();
    if (title && title !== value.title) onRename(title);
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
            if (e.key === "Escape") setEditing(false);
            if (e.key === "Enter") save();
          }}
          aria-label={`Rename ${value.title}`}
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
      <div className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-fg">
          {value.title || `#${value.lookupId}`}
          {!value.active && (
            <span className="ml-2 text-[11px] font-normal uppercase tracking-wider text-fg-muted">
              retired
            </span>
          )}
        </span>
        {value.note && (
          <span className="mt-0.5 block truncate text-xs text-fg-muted">{value.note}</span>
        )}
        {duplicateOf.length > 0 && (
          <span className="mt-0.5 block text-xs text-ajax-yellow">
            Looks like a duplicate of {duplicateOf.map((t) => `"${t}"`).join(", ")} — worth
            deciding which to keep. Nothing is merged automatically.
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={() => {
            setDraft(value.title);
            setEditing(true);
          }}
          className="rounded px-1.5 py-1 text-xs text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg group-hover:opacity-100 focus:opacity-100"
          aria-label={`Rename ${value.title}`}
        >
          Rename
        </button>
        {value.active ? (
          <button
            onClick={() => onSetActive(false)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-fg-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg group-hover:opacity-100 focus:opacity-100"
            // Not "Delete": records already pointing at it keep showing it,
            // and saying otherwise would promise something this can't do.
            title="Take it out of the pickers. Records already using it keep showing it."
            aria-label={`Retire ${value.title}`}
          >
            <Check className="h-3.5 w-3.5" />
            Retire
          </button>
        ) : (
          <button
            onClick={() => onSetActive(true)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-accent hover:underline"
            aria-label={`Restore ${value.title}`}
          >
            <ArrowUpFromLine className="h-3.5 w-3.5" />
            Restore
          </button>
        )}
        <span className="font-mono text-[11px] text-fg-muted">#{value.lookupId}</span>
      </div>
    </div>
  );
}
