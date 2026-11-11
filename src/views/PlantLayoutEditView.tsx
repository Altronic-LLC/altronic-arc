import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Ban, CheckCircle2, MousePointer2, Redo2, RefreshCw, Rows3, Save, Undo2 } from "lucide-react";
import { useEquipment } from "@/hooks/useEquipment";
import {
  useLayoutComponentMap,
  useLayoutComponents,
  usePlantLayout,
  useSavePlantLayoutDraft,
  useWallsDrawing,
} from "@/hooks/usePlantLayouts";
import { useMyPlantMapAccess } from "@/hooks/usePlantMapRoles";
import type { LayoutComponent, PlantAreaKind, PlantLayout, PlantLayoutItem } from "@/types/plant";
import { editLayoutGate } from "@/lib/plantMapRoles";
import { ALIGN_SNAP_PX, alignToNeighbours, type AlignGuide } from "@/lib/plantAlign";
import {
  DEFAULT_GRID_INCHES,
  editorReducer,
  initialEditorState,
  newItemUid,
  placeComponent,
  areaFromCorners,
  sameDoc,
  type EditorDoc,
  type ItemPatch,
} from "@/lib/plantEditor";
import {
  areaObstacles,
  describeLayoutProblem,
  findLayoutProblems,
  itemsWithProblems,
  shapeOfComponent,
  type CheckableItem,
  type Obstacle,
} from "@/lib/plantGeometry";
import { SingleSelect } from "@/components/SearchableSelect";
import { DetailTopBar } from "@/components/DetailTopBar";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PlantCanvas, type PlantCanvasHandle } from "@/components/PlantCanvas";
import { PlantAreaInspector, PlantInspector, PlantPalette } from "@/components/PlantEditorPanels";
import { PlantLayoutStatusChip, PlantMapAccessGate } from "@/components/plantMapAtoms";
import { cn } from "@/lib/cn";
import { useFitToWindow } from "@/hooks/useFitToWindow";
import { layoutLayers, placementLayerFor } from "@/lib/plantLayers";
import { usePlantLayerVisibility } from "@/hooks/usePlantLayerVisibility";
import { latestSymbols, outdatedItems, symbolVersionIds } from "@/lib/plantSymbolVersions";
import { PlantLayersPanel } from "@/components/PlantLayersPanel";

// =============================================================================
// The plant layout editor (/operations/plant-map/:id/edit) — a DRAFT only.
//
// Symbols are dragged in from the palette (a ghost follows the pointer and
// turns red where the item won't fit), moved, turned and resized on the plan,
// and fine-tuned in the inspector. The placement check runs live, the drag in
// progress included. Nothing is written until Save draft; leaving with unsaved
// changes asks first.
//
// The palette offers each symbol's LATEST version. An item still on an older
// version (lib/plantSymbolVersions.ts) is updated here — one at a time from the
// inspector, or all at once from the notice above the plan — as an ordinary,
// undoable edit that is saved with the draft.
// =============================================================================

const GRID_CHOICES = [
  { value: 0, label: "Off" },
  { value: 1, label: "1 in" },
  { value: 3, label: "3 in" },
  { value: 6, label: "6 in" },
  { value: 12, label: "1 ft" },
];

export function PlantLayoutEditView() {
  return (
    <PlantMapAccessGate>
      <EditorPage />
    </PlantMapAccessGate>
  );
}

function EditorPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const { data: layout, isLoading, error } = usePlantLayout(valid ? id : null);
  const walls = useWallsDrawing(layout?.wallsFileId);
  const components = useLayoutComponents();
  const gate = editLayoutGate(useMyPlantMapAccess());

  const back = valid ? `/operations/plant-map/${id}` : "/operations/plant-map";
  const notice = (text: string) => (
    <Shell>
      <p className="rounded-xl border border-border bg-surface p-6 text-sm text-fg-muted">
        {text}{" "}
        <Link to={back} className="text-accent hover:underline">
          Back to the layout
        </Link>
      </p>
    </Shell>
  );

  if (!valid) return notice("That layout doesn't exist.");
  if ((isLoading && !layout) || gate.resolving) return <LoadingTasks noun="the layout editor" />;
  if (error && !layout) return notice(`Couldn't load the layout: ${error instanceof Error ? error.message : "unknown error"}.`);
  if (!layout) return notice("That layout doesn't exist.");
  if (!gate.allowed) return notice(gate.hint);
  if (layout.status !== "Draft") {
    return notice(`This layout is ${layout.status}, so it can't be changed here. Open it and choose Edit to start a new draft.`);
  }
  if (layout.docCorrupt) return notice("This layout's saved data couldn't be read, so ARC won't edit it.");
  if (walls.isLoading || components.isLoading) return <LoadingTasks noun="the layout editor" />;

  const drawing = walls.data?.ok ? walls.data.drawing : null;
  return (
    <Editor
      // A fresh editor per layout version, so its undo history never crosses layouts.
      key={layout.id}
      layout={layout}
      components={components.data ?? []}
      wallsSvg={drawing?.svg ?? null}
      extent={drawing?.extent ?? layout.doc.extent}
      obstacles={drawing?.obstacles ?? []}
      wallsProblem={walls.data && !walls.data.ok ? walls.data.problem : walls.error ? "the walls drawing couldn't be loaded" : null}
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-3 px-4 py-4 sm:px-6">
      <DetailTopBar category="Plant Map" listTo="/operations/plant-map" />
      {children}
    </div>
  );
}

function Editor({
  layout,
  components,
  wallsSvg,
  extent,
  obstacles,
  wallsProblem,
}: {
  layout: PlantLayout;
  components: LayoutComponent[];
  wallsSvg: string | null;
  extent: { w: number; h: number };
  obstacles: Obstacle[];
  wallsProblem: string | null;
}) {
  const navigate = useNavigate();
  const save = useSavePlantLayoutDraft();
  const { byId } = useLayoutComponentMap();
  const { data: equipment = [] } = useEquipment();
  const canvas = useRef<PlantCanvasHandle>(null);
  // The three columns end just above the fixed footer, MEASURED (a guessed
  // calc() ran under the footer on a short window, hiding the last symbols).
  // Null on a phone, where the columns stack and the page scrolls.
  const [fitRef, fitHeight] = useFitToWindow();
  const columnHeight = fitHeight ? `${fitHeight}px` : undefined;

  const [state, dispatch] = useReducer(
    editorReducer,
    { items: layout.doc.items, areas: layout.doc.areas ?? [] },
    initialEditorState,
  );
  const [saved, setSaved] = useState<EditorDoc>({ items: layout.doc.items, areas: layout.doc.areas ?? [] });
  /** "select", or the kind of area a drag on the plan draws. */
  const [tool, setTool] = useState<"select" | PlantAreaKind>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [grid, setGrid] = useState(DEFAULT_GRID_INCHES);
  const [showLabels, setShowLabels] = useState(true);
  const [preview, setPreview] = useState<{ uid: string; patch: ItemPatch } | null>(null);
  const [palette, setPalette] = useState<{
    component: LayoutComponent;
    x: number;
    y: number;
    startX: number;
    startY: number;
    /** Alt held: place freely, without lining up. */
    alt?: boolean;
  } | null>(null);

  const items = state.items;
  const areas = state.areas;
  const dirty = !sameDoc({ items, areas }, saved);
  const componentMap = byId.size > 0 ? byId : new Map(components.map((c) => [c.id, c]));
  const paletteSymbols = useMemo(() => latestSymbols(components), [components]);
  /** Items with a newer version of their symbol waiting. */
  const outdated = useMemo(() => outdatedItems(items, components), [items, components]);

  // ---- layers: what's drawn, and what can be picked ------------------------
  // Hiding a layer is display only: hidden items aren't drawn, picked, nudged
  // or lined up with, but the placement check below still reads every item.
  const layers = useMemo(() => layoutLayers({ items, layers: layout.doc.layers }), [items, layout.doc.layers]);
  const visibility = usePlantLayerVisibility(layers);
  const { isVisible, reveal } = visibility;
  const shownItems = useMemo(() => items.filter(isVisible), [items, isVisible]);
  const pick = useCallback(
    (uid: string | null) => {
      const item = uid ? items.find((i) => i.uid === uid) : undefined;
      if (item) reveal(item);
      setSelected(uid);
    },
    [items, reveal],
  );

  // ---- placing a symbol: on the grid, or lined up with its neighbours --------
  // A symbol dropped from the palette lines up exactly as a dragged item does
  // (lib/plantAlign.ts) — the ghost shows the guides, and the drop lands where
  // the ghost was.
  const placeAt = useCallback(
    (component: LayoutComponent, point: { x: number; y: number }, align: boolean, random?: () => number) => {
      // A symbol every copy of which sits on one layer (an extinguisher) joins them there.
      // Copies on an older version of the symbol count, for the layer and the number.
      const sameSymbol = symbolVersionIds(component, components);
      const item = {
        ...placeComponent(component, point, items, grid, random, sameSymbol),
        ...placementLayerFor(sameSymbol, items),
      };
      if (!align) return { item, guides: [] as AlignGuide[] };
      const tolerance = ALIGN_SNAP_PX / (canvas.current?.scale() || 1);
      const aligned = alignToNeighbours({ ...item, x: point.x, y: point.y }, [...shownItems, ...areas], tolerance, grid);
      return { item: { ...item, x: aligned.x, y: aligned.y }, guides: aligned.guides };
    },
    [items, shownItems, areas, grid, components],
  );

  // ---- the live placement check -------------------------------------------
  const placedGhost = useMemo(() => {
    if (!palette) return null;
    const at = canvas.current?.clientToPlan(palette.x, palette.y);
    if (!at) return null;
    const placed = placeAt(palette.component, at, !palette.alt, () => 0);
    return { item: { ...placed.item, uid: "__ghost__" }, guides: placed.guides };
  }, [palette, placeAt]);
  const ghost = placedGhost?.item ?? null;

  const checkable = useCallback(
    (list: readonly PlantLayoutItem[]): CheckableItem[] =>
      list.map((it) => ({ ...it, ...shapeOfComponent(componentMap.get(it.componentId)) })),
    [componentMap],
  );
  const live = useMemo(
    () => (preview ? items.map((i) => (i.uid === preview.uid ? { ...i, ...preview.patch } : i)) : items),
    [items, preview],
  );
  const liveAreas = useMemo(
    () => (preview ? areas.map((a) => (a.uid === preview.uid ? { ...a, ...preview.patch } : a)) : areas),
    [areas, preview],
  );
  // The walls drawing's own keep-outs, plus the aisles and no-go areas drawn here.
  const allObstacles = useMemo(() => [...obstacles, ...areaObstacles(liveAreas)], [obstacles, liveAreas]);
  const problems = useMemo(
    () => findLayoutProblems(checkable(live), allObstacles, extent),
    [checkable, live, allObstacles, extent],
  );
  const problemUids = useMemo(() => itemsWithProblems(problems), [problems]);
  const ghostProblem = useMemo(() => {
    if (!ghost) return false;
    return itemsWithProblems(findLayoutProblems(checkable([...items, ghost]), allObstacles, extent)).has(ghost.uid);
  }, [ghost, items, checkable, allObstacles, extent]);
  const labelOf = useCallback((uid: string) => live.find((i) => i.uid === uid)?.label || "Unnamed item", [live]);

  // ---- actions ---------------------------------------------------------------
  const addAt = useCallback(
    (component: LayoutComponent, point: { x: number; y: number }, align = false) => {
      const { item } = placeAt(component, point, align);
      dispatch({ type: "add", item });
      reveal(item);
      setSelected(item.uid);
    },
    [placeAt, reveal],
  );
  const patchSelected = (patch: ItemPatch) => {
    if (!selected) return;
    dispatch({ type: "update", uid: selected, patch });
    // Moved onto a hidden layer: show it, rather than let the item vanish under the pointer.
    if (patch.layer) reveal({ layer: patch.layer, group: patch.group });
  };
  const duplicateSelected = useCallback(() => {
    if (!selected) return;
    const isArea = areas.some((a) => a.uid === selected);
    const newUid = isArea ? newItemUid(areas, undefined, "a") : newItemUid(items);
    dispatch({ type: "duplicate", uid: selected, newUid });
    setSelected(newUid);
  }, [selected, items, areas]);

  const drawArea = useCallback(
    (a: { x: number; y: number }, b: { x: number; y: number }) => {
      if (tool === "select") return;
      const area = areaFromCorners(a, b, tool, areas, grid);
      if (area) {
        dispatch({ type: "addArea", area });
        setSelected(area.uid);
      }
      // One area per pick of the tool — back to selecting, ready to label it.
      setTool("select");
    },
    [tool, areas, grid],
  );
  const deleteSelected = useCallback(() => {
    if (!selected) return;
    dispatch({ type: "delete", uid: selected });
    setSelected(null);
  }, [selected]);

  const saveNow = useCallback(async () => {
    if (!dirty || save.isPending) return;
    const doc = { ...layout.doc, extent, items, areas };
    const result = await save.mutateAsync({ id: layout.id, doc }).catch(() => null);
    if (result) {
      const next = { items: result.doc.items, areas: result.doc.areas ?? [] };
      setSaved(next);
      dispatch({ type: "saved", doc: next });
    }
  }, [dirty, save, layout, extent, items, areas]);

  // ---- dragging a symbol in from the palette ---------------------------------
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const dragging = palette !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => setPalette((p) => (p ? { ...p, x: e.clientX, y: e.clientY, alt: e.altKey } : p));
    const up = (e: PointerEvent) => {
      const p = paletteRef.current;
      setPalette(null);
      if (!p) return;
      const moved = Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 4;
      if (!moved) {
        // A click: drop one in the middle of what's on screen.
        addAt(p.component, canvas.current?.centre() ?? { x: extent.w / 2, y: extent.h / 2 });
      } else {
        // Dropped off the plan = cancelled.
        const at = canvas.current?.clientToPlan(e.clientX, e.clientY);
        if (at) addAt(p.component, at, !e.altKey);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, addAt, extent]);

  // ---- keyboard ----------------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Typing in a box is typing, not a shortcut. (The target can be the window itself.)
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='listbox']")) return;
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && key === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
      if (mod && key === "s") {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (!mod && key === "v") return setTool("select");
      if (!mod && key === "a") return setTool("aisle");
      if (!mod && key === "n") return setTool("no-go");
      if (key === "escape" && tool !== "select") return setTool("select");
      if (!selected) return;
      const item = items.find((i) => i.uid === selected) ?? areas.find((a) => a.uid === selected);
      if (!item) return;
      if (mod && key === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (key === "delete" || key === "backspace") {
        e.preventDefault();
        deleteSelected();
      } else if (key === "escape") {
        setSelected(null);
      } else if (key === "r" && !mod) {
        dispatch({ type: "update", uid: item.uid, patch: { rot: (item.rot + (e.shiftKey ? 270 : 90)) % 360 } });
      } else if (key.startsWith("arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : grid || 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        dispatch({ type: "update", uid: item.uid, patch: { x: item.x + dx, y: item.y + dy } });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, items, areas, tool, grid, saveNow, duplicateSelected, deleteSelected]);

  // ---- don't lose unsaved work -----------------------------------------------
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function done() {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving them?")) return;
    navigate(`/operations/plant-map/${layout.id}`);
  }

  const selectedItem = items.find((i) => i.uid === selected) ?? null;
  const selectedArea = areas.find((a) => a.uid === selected) ?? null;
  const selectedUpdate = selectedItem ? outdated.find((o) => o.item.uid === selectedItem.uid) : undefined;
  // Hiding the selected item's layer lets go of it — no nudging what you can't see.
  useEffect(() => {
    if (selectedItem && !isVisible(selectedItem)) setSelected(null);
  }, [selectedItem, isVisible]);

  return (
    <Shell>
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 flex items-center gap-2 font-display text-xl font-semibold text-fg">
          {layout.title || `Layout #${layout.id}`}
          <span className="text-base font-normal text-fg-muted">v{layout.version}</span>
          <PlantLayoutStatusChip status={layout.status} />
        </h1>
        <div className="flex items-center gap-1">
          <ToolButton label="Undo (Ctrl+Z)" disabled={state.past.length === 0} onClick={() => dispatch({ type: "undo" })}>
            <Undo2 className="h-4 w-4" />
          </ToolButton>
          <ToolButton label="Redo (Ctrl+Shift+Z)" disabled={state.future.length === 0} onClick={() => dispatch({ type: "redo" })}>
            <Redo2 className="h-4 w-4" />
          </ToolButton>
        </div>
        <div role="group" aria-label="Tool" className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          <ToolToggle label="Select and move (V)" active={tool === "select"} onClick={() => setTool("select")}>
            <MousePointer2 className="h-4 w-4" />
          </ToolToggle>
          <ToolToggle label="Draw an aisle (A)" active={tool === "aisle"} onClick={() => setTool("aisle")}>
            <Rows3 className="h-4 w-4" />
            <span className="hidden xl:inline">Aisle</span>
          </ToolToggle>
          <ToolToggle label="Draw a no-go area (N)" active={tool === "no-go"} onClick={() => setTool("no-go")}>
            <Ban className="h-4 w-4" />
            <span className="hidden xl:inline">No-go</span>
          </ToolToggle>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-fg">
          <span>Snap</span>
          <div className="w-24">
            <SingleSelect
              options={GRID_CHOICES.map((g) => ({ value: String(g.value), label: g.label }))}
              selected={String(grid)}
              onChange={(v) => v !== null && setGrid(Number(v))}
              allLabel="Snap"
              ariaLabel="Snap to grid"
              clearable={false}
            />
          </div>
        </div>
        <label className="inline-flex items-center gap-1.5 text-sm text-fg">
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} className="h-3.5 w-3.5 accent-cooper-red" />
          Labels
        </label>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
            problems.length ? "border-cooper-red/40 bg-cooper-red/10 text-cooper-red" : "border-cooper-green/40 bg-cooper-green/10 text-cooper-green",
          )}
        >
          {problems.length ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"}` : "No problems"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-fg-muted" aria-live="polite">
            {save.isPending ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <button
            type="button"
            onClick={done}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
          >
            Done
          </button>
          <button
            type="button"
            onClick={() => void saveNow()}
            disabled={!dirty || save.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            Save draft
          </button>
        </div>
      </header>

      {tool !== "select" && (
        <p role="status" className="rounded-lg border border-superior-blue/40 bg-superior-blue/10 p-2 text-sm text-fg">
          Drag on the plan to draw {tool === "aisle" ? "an aisle" : "a no-go area"}. Esc to stop.
        </p>
      )}
      {outdated.length > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-superior-blue/40 bg-superior-blue/10 p-2 text-sm text-fg"
        >
          <span className="min-w-0 flex-1">
            {outdated.length === 1 ? "1 item uses" : `${outdated.length} items use`} an older version of its symbol.
            Updating keeps where each one stands; it's saved with the draft.
          </span>
          <button
            type="button"
            onClick={() => dispatch({ type: "swapSymbols", swaps: outdated.map((o) => o.swap) })}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-sm font-medium text-fg hover:bg-surface-2"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Update symbols
          </button>
        </div>
      )}
      {wallsProblem && (
        <p role="alert" className="rounded-lg border border-ajax-yellow/50 bg-ajax-yellow/15 p-2 text-sm text-fg">
          The walls drawing can't be used ({wallsProblem}), so only the building's edge is checked.
        </p>
      )}

      <div ref={fitRef} className="grid grid-cols-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)_300px]">
        <div style={{ height: columnHeight }}>
          <PlantPalette
            components={paletteSymbols}
            onAdd={(c) => addAt(c, canvas.current?.centre() ?? { x: extent.w / 2, y: extent.h / 2 })}
            onPointerDownSymbol={(component, e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              setPalette({ component, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
            }}
          />
        </div>
        <div className="min-w-0">
          <PlantCanvas
            ref={canvas}
            title={`${layout.title} plant layout, editing`}
            extent={extent}
            wallsSvg={wallsSvg}
            items={shownItems}
            areas={areas}
            components={componentMap}
            problemUids={problemUids}
            selectedUid={selected}
            onSelect={pick}
            showLabels={showLabels}
            height={columnHeight ?? "70vh"}
            editing={{
              grid,
              onCommit: (uid, patch) => dispatch({ type: "update", uid, patch }),
              onPreview: setPreview,
              ghost,
              ghostProblem,
              ghostGuides: placedGhost?.guides,
              tool,
              onDrawArea: drawArea,
            }}
          />
        </div>
        <aside className="flex min-w-0 flex-col gap-3 lg:overflow-y-auto" style={{ height: columnHeight }}>
          {selectedArea ? (
            <PlantAreaInspector
              area={selectedArea}
              onPatch={patchSelected}
              onDuplicate={duplicateSelected}
              onDelete={deleteSelected}
            />
          ) : (
            <PlantInspector
              item={selectedItem}
              component={selectedItem ? componentMap.get(selectedItem.componentId) : undefined}
              newerVersion={selectedUpdate?.to}
              onUpdateSymbol={() => selectedUpdate && dispatch({ type: "swapSymbols", swaps: [selectedUpdate.swap] })}
              equipment={equipment}
              layers={layers}
              onPatch={patchSelected}
              onDuplicate={duplicateSelected}
              onDelete={deleteSelected}
            />
          )}
          <PlantLayersPanel
            layers={layers}
            items={items}
            hidden={visibility.hidden}
            onLayer={visibility.setLayer}
            onGroup={visibility.setGroup}
          />
          <section aria-label="Placement check" className="rounded-xl border border-border bg-surface p-4">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-fg-muted">Placement check</h2>
            {problems.length === 0 ? (
              <p className="mt-2 text-sm text-cooper-green">Nothing overlaps, and everything is inside the building.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {problems.map((p, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => pick(p.uid)} className="text-left text-fg hover:text-accent hover:underline">
                      {describeLayoutProblem(p, labelOf)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </Shell>
  );
}

function ToolToggle({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-sm px-2 text-sm transition-colors",
        active ? "bg-accent text-white" : "text-fg hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}

function ToolButton({
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
