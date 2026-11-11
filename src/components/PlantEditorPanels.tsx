import { useMemo, useState } from "react";
import { Copy, Lock, RefreshCw, RotateCcw, RotateCw, Trash2, Unlock } from "lucide-react";
import type { Equipment } from "@/types/task";
import {
  PLANT_AREA_KINDS,
  PLANT_AREA_KIND_LABELS,
  type LayoutComponent,
  type PlantLayer,
  type PlantLayoutArea,
  type PlantLayoutItem,
} from "@/types/plant";
import { sanitiseSvg, svgDataUrl } from "@/lib/plantSvg";
import { feetLabel } from "@/lib/plantGeometry";
import { clampAreaSize, clampSize, normaliseRotation, sizeLimits, type ItemPatch } from "@/lib/plantEditor";
import { matchesTokens } from "@/lib/itemSearch";
import { SearchInput } from "./SearchInput";
import { SingleSelect } from "./SearchableSelect";
import { cn } from "@/lib/cn";

// =============================================================================
// The layout editor's two side panels: the symbol PALETTE (drag a symbol onto
// the plan, or click it to drop one in the middle of the view) and the
// INSPECTOR for the selected item (label, CMMS asset, exact position,
// rotation, size, lock, duplicate, delete).
//
// The inspector's boxes commit on Enter or when you leave them — not on every
// keystroke — so typing "120" is one undo step, not three.
// =============================================================================

export function PlantPalette({
  components,
  onPointerDownSymbol,
  onAdd,
}: {
  components: readonly LayoutComponent[];
  /** Starts a drag from the palette. */
  onPointerDownSymbol: (component: LayoutComponent, e: React.PointerEvent) => void;
  /** Keyboard (Enter / Space): drop one in the middle of the view. */
  onAdd: (component: LayoutComponent) => void;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const active = useMemo(() => components.filter((c) => c.active), [components]);
  const categories = useMemo(() => [...new Set(active.map((c) => c.category))].sort(), [active]);
  const shown = active.filter(
    (c) => (!category || c.category === category) && matchesTokens(`${c.title} ${c.category} ${c.key}`, q),
  );
  const thumbs = useMemo(() => {
    const out = new Map<number, string>();
    for (const c of active) {
      const clean = sanitiseSvg(c.svgMarkup);
      if (clean) out.set(c.id, svgDataUrl(clean));
    }
    return out;
  }, [active]);

  return (
    // h-full: the panel fills its fixed-height column, so the LIST scrolls inside it.
    // Without it the panel grew past the column and the last symbols sat under the footer.
    <section aria-label="Symbols" className="flex h-full min-h-0 flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Symbols</h2>
      <SearchInput value={q} onChange={setQ} placeholder="Search symbols…" />
      <div className="flex flex-wrap gap-1">
        {[null, ...categories].map((c) => (
          <button
            key={c ?? "all"}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
              category === c ? "border-accent bg-accent/10 text-fg" : "border-border text-fg-muted hover:text-fg",
            )}
          >
            {c ?? "All"}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-fg-muted">Drag onto the plan, or click to drop one in the middle.</p>
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {shown.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              aria-label={`Add ${c.title}`}
              onPointerDown={(e) => onPointerDownSymbol(c, e)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onAdd(c);
                }
              }}
              className="flex w-full touch-none select-none items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-left transition-colors hover:border-accent hover:bg-surface-2"
              style={{ cursor: "grab" }}
            >
              <span className="flex h-10 w-12 shrink-0 items-center justify-center rounded-sm bg-white">
                {thumbs.get(c.id) && <img src={thumbs.get(c.id)} alt="" className="max-h-9 max-w-11" draggable={false} />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-fg">{c.title}</span>
                <span className="block text-[11px] text-fg-muted">
                  {feetLabel(c.footprintW)} × {feetLabel(c.footprintD)}
                </span>
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-1 text-sm text-fg-muted">No symbols match.</li>}
      </ul>
    </section>
  );
}

/** A box that commits on Enter or blur, and resets when the value changes from outside. */
function CommitField({
  label,
  value,
  onCommit,
  disabled,
  type = "number",
  suffix,
}: {
  label: string;
  value: string;
  onCommit: (raw: string) => void;
  disabled?: boolean;
  type?: "number" | "text";
  suffix?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type={type}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== value && onCommit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setDraft(value);
          }}
          className="input h-8! px-2! text-sm disabled:opacity-60"
        />
        {suffix && <span className="text-xs text-fg-muted">{suffix}</span>}
      </span>
    </label>
  );
}

export function PlantInspector({
  item,
  component,
  equipment,
  layers = [],
  newerVersion,
  onUpdateSymbol,
  onPatch,
  onDuplicate,
  onDelete,
}: {
  item: PlantLayoutItem | null;
  component: LayoutComponent | undefined;
  /** A newer version of the item's symbol, when there is one (lib/plantSymbolVersions.ts). */
  newerVersion?: LayoutComponent;
  /** Move the item onto `newerVersion`. */
  onUpdateSymbol?: () => void;
  equipment: readonly Equipment[];
  /** The layout's layers — offered in a Layer picker when there are any. */
  layers?: readonly PlantLayer[];
  onPatch: (patch: ItemPatch) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const assetOptions = useMemo(
    () =>
      equipment.map((e) => ({
        value: String(e.lookupId),
        label: [e.name, e.assetTag].filter(Boolean).join(" · ") || `Asset #${e.lookupId}`,
      })),
    [equipment],
  );

  if (!item) {
    return (
      <section aria-label="Selected item" className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Selected</h2>
        <p className="mt-2 text-sm text-fg-muted">Click an item on the plan to move, turn or resize it.</p>
        <ul className="mt-3 space-y-0.5 text-[11px] text-fg-muted">
          <li>A draws an aisle · N a no-go area · V back to select</li>
          <li>Drag to move · Alt while dragging to place freely</li>
          <li>Round handle to turn (Shift for single degrees)</li>
          <li>Arrows nudge · R turns 90° · Ctrl+D duplicates · Delete removes</li>
          <li>Ctrl+Z undo · Ctrl+Shift+Z redo · Ctrl+S save</li>
          <li>Scroll to zoom · drag empty floor (or middle-drag) to pan</li>
        </ul>
      </section>
    );
  }

  const locked = item.locked;
  const canRotate = component?.allowRotate ?? true;
  const limits = component ? sizeLimits(component) : null;
  const canResize = !!component?.allowResize;
  const num = (raw: string) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const setSize = (w: number, d: number) => component && onPatch(clampSize(component, w, d));
  const assetSelected = item.equipmentId !== null ? String(item.equipmentId) : null;
  const options =
    assetSelected && !assetOptions.some((o) => o.value === assetSelected)
      ? [{ value: assetSelected, label: `Asset #${assetSelected}` }, ...assetOptions]
      : assetOptions;

  return (
    <section aria-label="Selected item" className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Selected</h2>
        <span className="truncate text-xs text-fg-muted">
          {component ? `${component.title} · v${component.version}` : `Component #${item.componentId}`}
        </span>
      </div>
      {newerVersion && onUpdateSymbol && (
        <div className="flex flex-col gap-1.5 rounded-md border border-superior-blue/40 bg-superior-blue/10 p-2 text-xs text-fg">
          <span>
            A newer version of this symbol is in the library (v{newerVersion.version}). It stays where it stands
            {newerVersion.footprintW !== component?.footprintW || newerVersion.footprintD !== component?.footprintD
              ? `; the new size is ${feetLabel(newerVersion.footprintW)} × ${feetLabel(newerVersion.footprintD)} unless it was resized`
              : ""}
            .
          </span>
          <button
            type="button"
            onClick={onUpdateSymbol}
            className="inline-flex items-center gap-1 self-start rounded-md border border-border bg-surface px-2 py-1 font-medium text-fg hover:bg-surface-2"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Use v{newerVersion.version}
          </button>
        </div>
      )}
      <CommitField label="Label" type="text" value={item.label} onCommit={(raw) => onPatch({ label: raw.trim() })} />
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Asset (CMMS)</span>
        <SingleSelect
          options={options}
          selected={assetSelected}
          onChange={(v) => onPatch({ equipmentId: v ? Number(v) : null })}
          allLabel="Not linked"
          ariaLabel="Asset"
          searchPlaceholder="Search the equipment register…"
        />
      </div>
      {layers.length > 0 && <LayerFields item={item} layers={layers} onPatch={onPatch} />}
      <div className="grid grid-cols-2 gap-2">
        <CommitField
          label="From west"
          value={String(item.x)}
          suffix="in"
          disabled={locked}
          onCommit={(raw) => num(raw) !== null && onPatch({ x: num(raw)! })}
        />
        <CommitField
          label="From north"
          value={String(item.y)}
          suffix="in"
          disabled={locked}
          onCommit={(raw) => num(raw) !== null && onPatch({ y: num(raw)! })}
        />
        <CommitField
          label="Width"
          value={String(item.w)}
          suffix="in"
          disabled={locked || !canResize}
          onCommit={(raw) => num(raw) !== null && setSize(num(raw)!, item.d)}
        />
        <CommitField
          label="Depth"
          value={String(item.d)}
          suffix="in"
          disabled={locked || !canResize}
          onCommit={(raw) => num(raw) !== null && setSize(item.w, num(raw)!)}
        />
      </div>
      {limits && (
        <p className="-mt-1 text-[11px] text-fg-muted">
          {canResize
            ? `Size ${feetLabel(limits.minW)}–${feetLabel(limits.maxW)} wide, ${feetLabel(limits.minD)}–${feetLabel(limits.maxD)} deep.`
            : "This symbol's size is fixed."}
        </p>
      )}
      <div className="flex items-end gap-2">
        <div className="w-24">
          <CommitField
            label="Rotation"
            value={String(item.rot)}
            suffix="°"
            disabled={locked || !canRotate}
            onCommit={(raw) => num(raw) !== null && onPatch({ rot: normaliseRotation(num(raw)!) })}
          />
        </div>
        <IconButton label="Turn left 90°" disabled={locked || !canRotate} onClick={() => onPatch({ rot: normaliseRotation(item.rot - 90) })}>
          <RotateCcw className="h-4 w-4" />
        </IconButton>
        <IconButton label="Turn right 90°" disabled={locked || !canRotate} onClick={() => onPatch({ rot: normaliseRotation(item.rot + 90) })}>
          <RotateCw className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => onPatch({ locked: !locked })}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm text-fg hover:bg-surface-2"
        >
          {locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          {locked ? "Unlock" : "Lock"}
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm text-fg hover:bg-surface-2"
        >
          <Copy className="h-4 w-4" />
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm text-cooper-red hover:bg-cooper-red/10"
        >
          <Trash2 className="h-4 w-4" />
          Remove
        </button>
      </div>
    </section>
  );
}

/**
 * Which layer (and group) the item is on. The base plan is "no layer"; a
 * group is only offered when its layer has some. Changing the layer drops a
 * group the new layer doesn't have.
 */
function LayerFields({
  item,
  layers,
  onPatch,
}: {
  item: PlantLayoutItem;
  layers: readonly PlantLayer[];
  onPatch: (patch: ItemPatch) => void;
}) {
  const layer = layers.find((l) => l.key === item.layer);
  const groups = layer?.groups ?? [];
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Layer</span>
        <SingleSelect
          options={layers.map((l) => ({ value: l.key, label: l.title }))}
          selected={item.layer ?? null}
          onChange={(v) => {
            const next = layers.find((l) => l.key === v);
            const keepGroup = item.group && next?.groups.some((g) => g.key === item.group) ? item.group : null;
            onPatch({ layer: v ?? null, group: keepGroup });
          }}
          allLabel="Base plan"
          ariaLabel="Layer"
        />
      </div>
      {groups.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Group</span>
          <SingleSelect
            options={groups.map((g) => ({ value: g.key, label: g.title }))}
            selected={item.group ?? null}
            onChange={(v) => onPatch({ layer: item.layer, group: v ?? null })}
            allLabel="No group"
            ariaLabel="Group"
          />
        </div>
      )}
    </div>
  );
}

/** The selected aisle or no-go area: its label, kind, position, size and turn. */
export function PlantAreaInspector({
  area,
  onPatch,
  onDuplicate,
  onDelete,
}: {
  area: PlantLayoutArea;
  onPatch: (patch: ItemPatch) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const locked = area.locked;
  const num = (raw: string) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return (
    <section aria-label="Selected area" className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Selected area</h2>
        <span className="text-xs text-fg-muted">Keeps machines out</span>
      </div>
      <CommitField label="Label" type="text" value={area.label} onCommit={(raw) => onPatch({ label: raw.trim() })} />
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Kind</span>
        <div role="radiogroup" aria-label="Kind" className="flex gap-1">
          {PLANT_AREA_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={area.kind === k}
              onClick={() => onPatch({ kind: k })}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                area.kind === k ? "border-accent bg-accent/10 text-fg" : "border-border text-fg-muted hover:text-fg",
              )}
            >
              {PLANT_AREA_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <CommitField
          label="From west"
          value={String(area.x)}
          suffix="in"
          disabled={locked}
          onCommit={(raw) => num(raw) !== null && onPatch({ x: num(raw)! })}
        />
        <CommitField
          label="From north"
          value={String(area.y)}
          suffix="in"
          disabled={locked}
          onCommit={(raw) => num(raw) !== null && onPatch({ y: num(raw)! })}
        />
        <CommitField
          label="Width"
          value={String(area.w)}
          suffix="in"
          disabled={locked}
          onCommit={(raw) => num(raw) !== null && onPatch(clampAreaSize(num(raw)!, area.d))}
        />
        <CommitField
          label="Depth"
          value={String(area.d)}
          suffix="in"
          disabled={locked}
          onCommit={(raw) => num(raw) !== null && onPatch(clampAreaSize(area.w, num(raw)!))}
        />
      </div>
      <p className="-mt-1 text-[11px] text-fg-muted">
        {feetLabel(area.w)} × {feetLabel(area.d)}
      </p>
      <div className="flex items-end gap-2">
        <div className="w-24">
          <CommitField
            label="Rotation"
            value={String(area.rot)}
            suffix="°"
            disabled={locked}
            onCommit={(raw) => num(raw) !== null && onPatch({ rot: normaliseRotation(num(raw)!) })}
          />
        </div>
        <IconButton label="Turn left 90°" disabled={locked} onClick={() => onPatch({ rot: normaliseRotation(area.rot - 90) })}>
          <RotateCcw className="h-4 w-4" />
        </IconButton>
        <IconButton label="Turn right 90°" disabled={locked} onClick={() => onPatch({ rot: normaliseRotation(area.rot + 90) })}>
          <RotateCw className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => onPatch({ locked: !locked })}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm text-fg hover:bg-surface-2"
        >
          {locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          {locked ? "Unlock" : "Lock"}
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm text-fg hover:bg-surface-2"
        >
          <Copy className="h-4 w-4" />
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm text-cooper-red hover:bg-cooper-red/10"
        >
          <Trash2 className="h-4 w-4" />
          Remove
        </button>
      </div>
    </section>
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
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
