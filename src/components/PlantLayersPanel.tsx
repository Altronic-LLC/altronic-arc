import { Layers } from "lucide-react";
import { layerCounts, layerKey } from "@/lib/plantLayers";
import type { PlantLayer, PlantLayoutItem } from "@/types/plant";
import { cn } from "@/lib/cn";

/**
 * Show and hide a layout's layers, and each layer's groups. The base plan is
 * always shown, so it has no box. Nothing renders for a layout without layers.
 * Hiding is display only — the placement check still reads every item.
 */
export function PlantLayersPanel({
  layers,
  items,
  hidden,
  onLayer,
  onGroup,
}: {
  layers: readonly PlantLayer[];
  items: readonly PlantLayoutItem[];
  hidden: ReadonlySet<string>;
  onLayer: (layer: string, shown: boolean) => void;
  onGroup: (layer: string, group: string, shown: boolean) => void;
}) {
  if (layers.length === 0) return null;
  const counts = layerCounts(items);
  return (
    <section aria-label="Layers" className="rounded-xl border border-border bg-surface p-4">
      <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">
        <Layers className="h-4 w-4" />
        Layers
      </h2>
      <ul className="mt-2 space-y-2 text-sm">
        {layers.map((layer) => {
          const layerShown = !hidden.has(layer.key);
          return (
            <li key={layer.key}>
              <label className="inline-flex items-center gap-2 font-medium text-fg">
                <input
                  type="checkbox"
                  checked={layerShown}
                  onChange={(e) => onLayer(layer.key, e.target.checked)}
                  className="h-3.5 w-3.5 accent-cooper-red"
                />
                {layer.title}
                <span className="text-xs font-normal tabular-nums text-fg-muted">{counts.get(layer.key) ?? 0}</span>
              </label>
              {layer.groups.length > 0 && (
                <ul className={cn("mt-1 space-y-1 pl-5", !layerShown && "opacity-50")}>
                  {layer.groups.map((g) => (
                    <li key={g.key}>
                      <label className="inline-flex items-center gap-2 text-fg">
                        <input
                          type="checkbox"
                          checked={layerShown && !hidden.has(layerKey(layer.key, g.key))}
                          onChange={(e) => onGroup(layer.key, g.key, e.target.checked)}
                          className="h-3.5 w-3.5 accent-cooper-red"
                        />
                        {g.title}
                        <span className="text-xs tabular-nums text-fg-muted">
                          {counts.get(layerKey(layer.key, g.key)) ?? 0}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-fg-muted">Hidden items are still checked for problems.</p>
    </section>
  );
}
