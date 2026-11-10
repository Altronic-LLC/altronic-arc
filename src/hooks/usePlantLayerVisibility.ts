import { useCallback, useEffect, useMemo, useState } from "react";
import {
  defaultHiddenLayers,
  itemVisible,
  revealItem,
  setGroupShown,
  setLayerShown,
} from "@/lib/plantLayers";
import type { PlantLayer, PlantLayoutItem } from "@/types/plant";

/**
 * Which Plant Map layers are shown — per viewer, never saved. Starts from each
 * layer's `hiddenByDefault`; a layer that turns up later (an item moved onto
 * an undeclared layer) starts the way it declares, too.
 */
export function usePlantLayerVisibility(layers: readonly PlantLayer[]) {
  const [hidden, setHidden] = useState<Set<string>>(() => defaultHiddenLayers(layers));
  const [known, setKnown] = useState<Set<string>>(() => new Set(layers.map((l) => l.key)));

  // A layer seen for the first time gets its own default; one already seen
  // keeps whatever the viewer chose.
  const layerKeys = layers.map((l) => l.key).join("|");
  useEffect(() => {
    const fresh = layers.filter((l) => !known.has(l.key));
    if (fresh.length === 0) return;
    setKnown((k) => new Set([...k, ...fresh.map((l) => l.key)]));
    const startHidden = fresh.filter((l) => l.hiddenByDefault).map((l) => l.key);
    if (startHidden.length > 0) setHidden((h) => new Set([...h, ...startHidden]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the layer list's keys
  }, [layerKeys]);

  const isVisible = useCallback((item: Pick<PlantLayoutItem, "layer" | "group">) => itemVisible(item, hidden), [hidden]);

  return useMemo(
    () => ({
      hidden: hidden as ReadonlySet<string>,
      isVisible,
      setLayer: (layer: string, shown: boolean) => setHidden((h) => setLayerShown(h, layer, shown)),
      setGroup: (layer: string, group: string, shown: boolean) => setHidden((h) => setGroupShown(h, layer, group, shown)),
      /** Show whatever hides this item — before selecting it from a list. */
      reveal: (item: Pick<PlantLayoutItem, "layer" | "group">) => setHidden((h) => revealItem(h, item)),
    }),
    [hidden, isVisible],
  );
}
