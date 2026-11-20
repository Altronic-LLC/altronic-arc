import { useState } from "react";
import { Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { layerCounts, layerKey, layerTitleProblem } from "@/lib/plantLayers";
import type { PlantLayer, PlantLayoutItem } from "@/types/plant";
import { cn } from "@/lib/cn";

/** What the editor can do to the layers. Every change is undoable and saved with the draft. */
export interface PlantLayersEdit {
  onAddLayer: (title: string) => void;
  onUpdateLayer: (key: string, patch: { title?: string; hiddenByDefault?: boolean }) => void;
  onRemoveLayer: (key: string) => void;
  onAddGroup: (layer: string, title: string) => void;
  onRenameGroup: (layer: string, group: string, title: string) => void;
  onRemoveGroup: (layer: string, group: string) => void;
}

/**
 * Show and hide a layout's layers, and each layer's groups. The base plan is
 * always shown, so it has no box. Hiding is display only — the placement
 * check still reads every item.
 *
 * With `edit` (the layout editor), layers and groups can be added, renamed and
 * removed, and a layer can be set to start hidden for whoever opens the
 * layout. A layer or group is removed only once nothing is on it — the
 * inspector's Layer picker moves items off. Without `edit`, a layout with no
 * layers shows nothing.
 */
export function PlantLayersPanel({
  layers,
  items,
  hidden,
  onLayer,
  onGroup,
  edit,
}: {
  layers: readonly PlantLayer[];
  items: readonly PlantLayoutItem[];
  hidden: ReadonlySet<string>;
  onLayer: (layer: string, shown: boolean) => void;
  onGroup: (layer: string, group: string, shown: boolean) => void;
  edit?: PlantLayersEdit;
}) {
  const [adding, setAdding] = useState(false);
  /** "layer:<key>", "group:<layer>/<group>" or "newgroup:<layer>" — the one name being typed. */
  const [naming, setNaming] = useState<string | null>(null);
  if (layers.length === 0 && !edit) return null;
  const counts = layerCounts(items);

  return (
    <section aria-label="Layers" className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
          <Layers className="h-4 w-4" />
          Layers
        </h2>
        {edit && !adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setNaming(null);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-fg hover:bg-surface-2"
          >
            <Plus className="h-3.5 w-3.5" />
            New layer
          </button>
        )}
      </div>

      {edit && adding && (
        <NameForm
          label="New layer name"
          submitLabel="Add layer"
          problemFor={(t) => layerTitleProblem(t, layers)}
          onSubmit={(t) => {
            edit.onAddLayer(t);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {layers.length === 0 ? (
        <p className="mt-2 text-xs text-fg-muted">
          No layers yet — everything is on the base plan. A layer is a set of items shown and hidden together, such as
          Safety.
        </p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {layers.map((layer) => {
            const layerShown = !hidden.has(layer.key);
            const count = counts.get(layer.key) ?? 0;
            const id = `layer:${layer.key}`;
            return (
              <li key={layer.key} data-layer-key={layer.key}>
                {naming === id && edit ? (
                  <NameForm
                    label={`Rename ${layer.title}`}
                    submitLabel="Rename"
                    initial={layer.title}
                    problemFor={(t) => layerTitleProblem(t, layers, layer.key)}
                    onSubmit={(t) => {
                      edit.onUpdateLayer(layer.key, { title: t });
                      setNaming(null);
                    }}
                    onCancel={() => setNaming(null)}
                  />
                ) : (
                  <div className="flex items-center gap-1">
                    <label className="inline-flex min-w-0 flex-1 items-center gap-2 font-medium text-fg">
                      <input
                        type="checkbox"
                        checked={layerShown}
                        onChange={(e) => onLayer(layer.key, e.target.checked)}
                        className="h-3.5 w-3.5 accent-cooper-red"
                      />
                      <span className="truncate">{layer.title}</span>
                      <span className="text-xs font-normal tabular-nums text-fg-muted">{count}</span>
                    </label>
                    {edit && (
                      <RowActions
                        name={layer.title}
                        onRename={() => {
                          setNaming(id);
                          setAdding(false);
                        }}
                        onAddGroup={() => {
                          setNaming(`newgroup:${layer.key}`);
                          setAdding(false);
                        }}
                        onRemove={() => edit.onRemoveLayer(layer.key)}
                        blockedBy={count}
                      />
                    )}
                  </div>
                )}
                {edit && (
                  <label className="mt-0.5 inline-flex items-center gap-2 pl-5 text-xs text-fg-muted">
                    <input
                      type="checkbox"
                      checked={layer.hiddenByDefault}
                      onChange={(e) => edit.onUpdateLayer(layer.key, { hiddenByDefault: e.target.checked })}
                      className="h-3 w-3 accent-cooper-red"
                      aria-label={`Start ${layer.title} hidden`}
                    />
                    Starts hidden when the layout opens
                  </label>
                )}
                {layer.groups.length > 0 && (
                  <ul className="mt-1 space-y-1 pl-5">
                    {layer.groups.map((g) => {
                      const gid = `group:${layer.key}/${g.key}`;
                      const gCount = counts.get(layerKey(layer.key, g.key)) ?? 0;
                      return (
                        <li key={g.key}>
                          {naming === gid && edit ? (
                            <NameForm
                              label={`Rename ${g.title}`}
                              submitLabel="Rename"
                              initial={g.title}
                              problemFor={(t) => layerTitleProblem(t, layer.groups, g.key)}
                              onSubmit={(t) => {
                                edit.onRenameGroup(layer.key, g.key, t);
                                setNaming(null);
                              }}
                              onCancel={() => setNaming(null)}
                            />
                          ) : (
                            <div className="flex items-center gap-1">
                              {/* Faded while its layer is hidden; the edit buttons and forms are not. */}
                              <label
                                className={cn("inline-flex min-w-0 flex-1 items-center gap-2 text-fg", !layerShown && "opacity-50")}
                              >
                                <input
                                  type="checkbox"
                                  checked={layerShown && !hidden.has(layerKey(layer.key, g.key))}
                                  onChange={(e) => onGroup(layer.key, g.key, e.target.checked)}
                                  className="h-3.5 w-3.5 accent-cooper-red"
                                />
                                <span className="truncate">{g.title}</span>
                                <span className="text-xs tabular-nums text-fg-muted">{gCount}</span>
                              </label>
                              {edit && (
                                <RowActions
                                  name={g.title}
                                  onRename={() => {
                                    setNaming(gid);
                                    setAdding(false);
                                  }}
                                  onRemove={() => edit.onRemoveGroup(layer.key, g.key)}
                                  blockedBy={gCount}
                                />
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {edit && naming === `newgroup:${layer.key}` && (
                  <div className="pl-5">
                    <NameForm
                      label={`New group in ${layer.title}`}
                      submitLabel="Add group"
                      problemFor={(t) => layerTitleProblem(t, layer.groups)}
                      onSubmit={(t) => {
                        edit.onAddGroup(layer.key, t);
                        setNaming(null);
                      }}
                      onCancel={() => setNaming(null)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-fg-muted">
        Hidden items are still checked for problems.
        {edit && layers.length > 0 && " Put an item on a layer from the panel above when it's selected."}
      </p>
    </section>
  );
}

/** Rename / add group / remove, as small icon buttons. Remove waits until nothing is on it. */
function RowActions({
  name,
  onRename,
  onAddGroup,
  onRemove,
  blockedBy,
}: {
  name: string;
  onRename: () => void;
  onAddGroup?: () => void;
  onRemove: () => void;
  /** How many items are on it — removing waits until it's 0. */
  blockedBy: number;
}) {
  const blocked = blockedBy > 0;
  const removeTitle = blocked
    ? `${blockedBy} ${blockedBy === 1 ? "item is" : "items are"} on ${name}. Move ${blockedBy === 1 ? "it" : "them"} off first.`
    : `Remove ${name}`;
  const btn = "rounded-sm p-1 text-fg-muted hover:bg-surface-2 hover:text-fg";
  return (
    <span className="flex shrink-0 items-center">
      <button type="button" onClick={onRename} aria-label={`Rename ${name}`} title={`Rename ${name}`} className={btn}>
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {onAddGroup && (
        <button type="button" onClick={onAddGroup} aria-label={`Add a group to ${name}`} title={`Add a group to ${name}`} className={btn}>
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
      {/* aria-disabled, not disabled: the reason stays in the tooltip and the tab order. */}
      <button
        type="button"
        onClick={() => !blocked && onRemove()}
        aria-label={`Remove ${name}`}
        aria-disabled={blocked || undefined}
        title={removeTitle}
        className={cn(btn, blocked && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-fg-muted")}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/** A name typed in place: Enter saves, Escape cancels (and goes no further). */
function NameForm({
  label,
  submitLabel,
  initial = "",
  problemFor,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initial?: string;
  problemFor: (title: string) => string | null;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = () => {
    const p = problemFor(value);
    if (p) return setProblem(p);
    onSubmit(value.trim());
  };
  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
          aria-label={label}
          placeholder="Name"
          className="input h-7! min-w-0 flex-1 px-2! text-sm"
        />
        <button
          type="button"
          onClick={submit}
          className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent/90"
        >
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-1.5 py-1 text-xs text-fg-muted hover:text-fg">
          Cancel
        </button>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-cooper-red">
          {problem}
        </p>
      )}
    </div>
  );
}
