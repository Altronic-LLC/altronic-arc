import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { LayoutComponent, PlantAreaKind, PlantLayoutArea, PlantLayoutItem } from "@/types/plant";
import { sanitiseSvg, svgDataUrl } from "@/lib/plantSvg";
import type { Obstacle } from "@/lib/plantGeometry";
import { clampAreaSize, clampSize, normaliseRotation, snap, type ItemPatch } from "@/lib/plantEditor";
import { ALIGN_SNAP_PX, alignToNeighbours, type AlignGuide } from "@/lib/plantAlign";
import { cn } from "@/lib/cn";

// =============================================================================
// The plant canvas — one layout drawn to scale, for viewing AND editing.
//
// One `<svg>` whose viewBox is a WINDOW onto the building, in inches: zooming
// and panning move the window, so the drawing stays sharp and a screen point
// maps to the plan exactly (`px per inch` is one number). The walls drawing
// and every symbol are drawn as `<image>`s of their SANITISED SVG
// (lib/plantSvg.ts) — never injected into the page.
//
//   * Click and drag empty floor to pan (or drag with the middle button
//     anywhere). The scroll wheel zooms where the pointer is (Tim, 2026-11-06),
//     as does a trackpad pinch. The page itself never scrolls
//     sideways.
//   * Labels, handles and outlines are sized in SCREEN pixels, so they read
//     the same at any zoom.
//   * Editing (`editable`): drag an item to move it (snapped to the grid; Alt
//     to place freely). Lining up with another item or area — edge or centre,
//     across or down — snaps onto that line and draws a dotted guide
//     (lib/plantAlign.ts); Alt turns that off too. drag the round handle to turn it (15° steps; Shift for
//     single degrees), drag a corner to resize it within its symbol's limits.
//     The in-between positions are a PREVIEW; one change is committed on
//     release, so one drag is one undo step.
//   * Areas (aisles, no-go areas) are drawn UNDER the items and move, turn
//     and resize the same way. With an area tool picked (`editing.tool`), a
//     drag on the plan draws one instead, and items and areas let the pointer
//     through to the floor.
// =============================================================================

export interface PlantCanvasHandle {
  /** A screen point → inches on the plan, or null when it's not over the canvas. */
  clientToPlan(clientX: number, clientY: number): { x: number; y: number } | null;
  /** The middle of what's on screen, in inches. */
  centre(): { x: number; y: number };
  /** Screen pixels per inch right now. */
  scale(): number;
}

export interface PlantCanvasEditing {
  /** Grid in inches; 0 = snap off. */
  grid: number;
  /** One finished drag. */
  onCommit: (uid: string, patch: ItemPatch) => void;
  /** The drag in progress (null when it ends), so the placement check can follow it live. */
  onPreview?: (preview: { uid: string; patch: ItemPatch } | null) => void;
  /** An item being dragged in from the palette. */
  ghost?: PlantLayoutItem | null;
  ghostProblem?: boolean;
  /** The alignment guides for the ghost, worked out by whoever placed it. */
  ghostGuides?: readonly AlignGuide[];
  /** "select", or the kind of area a drag on the plan draws. */
  tool?: "select" | PlantAreaKind;
  /** A finished area drag — two opposite corners, in inches. */
  onDrawArea?: (a: { x: number; y: number }, b: { x: number; y: number }) => void;
}

export interface PlantCanvasProps {
  extent: { w: number; h: number };
  wallsSvg: string | null;
  items: readonly PlantLayoutItem[];
  /** Aisles and no-go areas drawn on the layout. */
  areas?: readonly PlantLayoutArea[];
  components: ReadonlyMap<number, LayoutComponent>;
  problemUids?: ReadonlySet<string>;
  selectedUid?: string | null;
  onSelect?: (uid: string | null) => void;
  showLabels?: boolean;
  title: string;
  editing?: PlantCanvasEditing;
  /** CSS height of the drawing area. */
  height?: string;
  /**
   * Shapes to highlight over the drawing — what ARC found in it, for the New
   * layout review: walls and columns in amber, keep-outs dashed grey.
   */
  found?: readonly Obstacle[];
  /**
   * The scroll wheel zooms (default). Off where the canvas sits inside
   * something that scrolls — the New layout review — so the wheel scrolls that
   * instead; the zoom buttons still work.
   */
  wheelZoom?: boolean;
}

interface View {
  x: number;
  y: number;
  /** Screen pixels per inch. */
  scale: number;
}

/** What a move / turn / resize needs of an item or an area. */
interface Shape {
  uid: string;
  x: number;
  y: number;
  w: number;
  d: number;
  rot: number;
  locked: boolean;
}

type Gesture =
  | { kind: "pan"; startX: number; startY: number; view: View }
  | { kind: "draw"; start: { x: number; y: number } }
  | { kind: "move"; uid: string; startX: number; startY: number; item: Shape; moved: boolean }
  | { kind: "rotate"; uid: string; item: Shape }
  /** `component` for an item; an area (no component) resizes freely, at least a foot. */
  | { kind: "resize"; uid: string; item: Shape; component: LayoutComponent | undefined; isArea: boolean };

const AREA_STYLE: Record<PlantAreaKind, { fill: string; stroke: string; text: string }> = {
  aisle: { fill: "#3b82f6", stroke: "#2563eb", text: "#1e40af" },
  "no-go": { fill: "#ef4444", stroke: "#dc2626", text: "#991b1b" },
};

const PROBLEM = "#dc2626";
const SELECTED = "#2563eb";
/** Alignment guides — magenta, so they don't read as a selection, an aisle or a problem. */
const GUIDE = "#db2777";
const MAX_SCALE = 6;
const DEFAULT_SIZE = { w: 800, h: 500 };

function fitView(extent: { w: number; h: number }, size: { w: number; h: number }): View {
  const scale = Math.min(size.w / extent.w, size.h / extent.h) * 0.95 || 1;
  return { scale, x: (extent.w - size.w / scale) / 2, y: (extent.h - size.h / scale) / 2 };
}

export const PlantCanvas = forwardRef<PlantCanvasHandle, PlantCanvasProps>(function PlantCanvas(
  {
    extent,
    wallsSvg,
    items,
    areas = [],
    components,
    problemUids,
    selectedUid,
    onSelect,
    showLabels = true,
    title,
    editing,
    height = "70vh",
    found,
    wheelZoom = true,
  },
  ref,
) {
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [view, setView] = useState<View>(() => fitView(extent, DEFAULT_SIZE));
  const fitKey = useRef("");
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<{ uid: string; patch: ItemPatch } | null>(null);
  const [drawing, setDrawing] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [guides, setGuides] = useState<AlignGuide[]>([]);
  const tool = editing?.tool ?? "select";
  const viewRef = useRef(view);
  viewRef.current = view;

  // Measure the box, and keep measuring; fit the building the first time a real size arrives.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const r = box.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // Fit the building once a real size is measured, and again if the building
  // changes — but NOT on every later resize, which would throw away the zoom.
  useEffect(() => {
    const key = `${extent.w}x${extent.h}:${size !== DEFAULT_SIZE}`;
    if (fitKey.current === key) return;
    fitKey.current = key;
    setView(fitView(extent, size));
  }, [extent.w, extent.h, size]); // eslint-disable-line react-hooks/exhaustive-deps

  const minScale = useMemo(() => Math.min(size.w / extent.w, size.h / extent.h) * 0.3, [size, extent]);

  const toPlan = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: v.x + (clientX - (rect?.left ?? 0)) / v.scale, y: v.y + (clientY - (rect?.top ?? 0)) / v.scale };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      clientToPlan(clientX, clientY) {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return null;
        const inside =
          rect.width === 0 ||
          (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom);
        return inside ? toPlan(clientX, clientY) : null;
      },
      centre() {
        const v = viewRef.current;
        return { x: v.x + size.w / v.scale / 2, y: v.y + size.h / v.scale / 2 };
      },
      scale() {
        return viewRef.current.scale;
      },
    }),
    [toPlan, size],
  );

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      setView((v) => {
        const scale = Math.min(MAX_SCALE, Math.max(minScale, v.scale * factor));
        const rect = svgRef.current?.getBoundingClientRect();
        const sx = clientX !== undefined && rect ? clientX - rect.left : size.w / 2;
        const sy = clientY !== undefined && rect ? clientY - rect.top : size.h / 2;
        const px = v.x + sx / v.scale;
        const py = v.y + sy / v.scale;
        return { scale, x: px - sx / scale, y: py - sy / scale };
      });
    },
    [minScale, size],
  );

  // Wheel needs a NON-passive listener to stop the page scrolling under it.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !wheelZoom) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Lines and pages → pixels, so every mouse zooms at about the same pace.
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      // A trackpad pinch arrives as Ctrl + small deltas; give it a faster rate.
      const rate = e.ctrlKey ? 0.01 : 0.0015;
      zoomAt(Math.exp(-dy * rate), e.clientX, e.clientY);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt, wheelZoom]);

  // Sanitise each symbol once, not once per placed copy.
  const symbols = useMemo(() => {
    const out = new Map<number, string>();
    for (const [id, c] of components) {
      const clean = sanitiseSvg(c.svgMarkup);
      if (clean) out.set(id, svgDataUrl(clean));
    }
    return out;
  }, [components]);
  const wallsUrl = useMemo(() => (wallsSvg ? svgDataUrl(wallsSvg) : null), [wallsSvg]);

  const shown = useMemo(
    () => (preview ? items.map((i) => (i.uid === preview.uid ? { ...i, ...preview.patch } : i)) : items),
    [items, preview],
  );
  const shownAreas = useMemo(
    () =>
      preview
        ? areas.map((a) => (a.uid === preview.uid ? { ...a, ...(preview.patch as Partial<PlantLayoutArea>) } : a))
        : areas,
    [areas, preview],
  );

  function setLivePreview(next: { uid: string; patch: ItemPatch } | null) {
    setPreview(next);
    editing?.onPreview?.(next);
  }

  function capture(e: React.PointerEvent) {
    svgRef.current?.setPointerCapture?.(e.pointerId);
  }

  function startPan(e: React.PointerEvent) {
    gesture.current = { kind: "pan", startX: e.clientX, startY: e.clientY, view: viewRef.current };
    capture(e);
  }

  function onBackgroundDown(e: React.PointerEvent) {
    if (e.button === 1) {
      e.preventDefault();
      return startPan(e);
    }
    if (e.button !== 0) return;
    onSelect?.(null);
    if (editing && tool !== "select") {
      const start = toPlan(e.clientX, e.clientY);
      gesture.current = { kind: "draw", start };
      setDrawing({ a: start, b: start });
      capture(e);
      return;
    }
    startPan(e);
  }

  function onItemDown(e: React.PointerEvent, item: Shape) {
    if (e.button === 1) {
      // The middle button pans from anywhere, items included — it never moves one.
      e.preventDefault();
      e.stopPropagation();
      return startPan(e);
    }
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect?.(item.uid);
    if (editing && !item.locked) {
      gesture.current = { kind: "move", uid: item.uid, startX: e.clientX, startY: e.clientY, item, moved: false };
    } else {
      startPan(e);
      return;
    }
    capture(e);
  }

  function onHandleDown(e: React.PointerEvent, item: Shape, kind: "rotate" | "resize", component?: LayoutComponent) {
    if (e.button !== 0 || !editing) return;
    e.stopPropagation();
    gesture.current =
      kind === "rotate"
        ? { kind: "rotate", uid: item.uid, item }
        : { kind: "resize", uid: item.uid, item, component, isArea: !component };
    capture(e);
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pan") {
      setView({ ...g.view, x: g.view.x - (e.clientX - g.startX) / g.view.scale, y: g.view.y - (e.clientY - g.startY) / g.view.scale });
      return;
    }
    const grid = e.altKey ? 0 : (editing?.grid ?? 0);
    if (g.kind === "draw") {
      const b = toPlan(e.clientX, e.clientY);
      setDrawing({ a: { x: snap(g.start.x, grid), y: snap(g.start.y, grid) }, b: { x: snap(b.x, grid), y: snap(b.y, grid) } });
      return;
    }
    if (g.kind === "move") {
      if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 3) return;
      g.moved = true;
      const s = viewRef.current.scale;
      const rawX = g.item.x + (e.clientX - g.startX) / s;
      const rawY = g.item.y + (e.clientY - g.startY) / s;
      if (e.altKey) {
        // Alt places freely: no grid, no lining up.
        setGuides([]);
        setLivePreview({ uid: g.uid, patch: { x: snap(rawX, 0), y: snap(rawY, 0) } });
        return;
      }
      const others = [...items, ...areas].filter((o) => o.uid !== g.uid);
      const aligned = alignToNeighbours({ ...g.item, x: rawX, y: rawY }, others, ALIGN_SNAP_PX / s, grid);
      setGuides(aligned.guides);
      setLivePreview({ uid: g.uid, patch: { x: aligned.x, y: aligned.y } });
      return;
    }
    const p = toPlan(e.clientX, e.clientY);
    if (g.kind === "rotate") {
      const raw = (Math.atan2(p.y - g.item.y, p.x - g.item.x) * 180) / Math.PI + 90;
      const step = e.shiftKey ? 1 : 15;
      setLivePreview({ uid: g.uid, patch: { rot: normaliseRotation(Math.round(raw / step) * step) } });
      return;
    }
    // Resize about the centre: the pointer's offset in the item's own frame is half the new size.
    const a = (g.item.rot * Math.PI) / 180;
    const dx = p.x - g.item.x;
    const dy = p.y - g.item.y;
    const lx = dx * Math.cos(a) + dy * Math.sin(a);
    const ly = -dx * Math.sin(a) + dy * Math.cos(a);
    const w = Math.round(Math.abs(lx) * 2);
    const d = Math.round(Math.abs(ly) * 2);
    const next = g.isArea ? clampAreaSize(w, d) : g.component ? clampSize(g.component, w, d) : { w: g.item.w, d: g.item.d };
    setLivePreview({ uid: g.uid, patch: next });
  }

  function onPointerUp() {
    const g = gesture.current;
    gesture.current = null;
    setGuides([]);
    if (!g || g.kind === "pan") return;
    if (g.kind === "draw") {
      if (drawing) editing?.onDrawArea?.(drawing.a, drawing.b);
      setDrawing(null);
      return;
    }
    if (preview && preview.uid === g.uid) editing?.onCommit(g.uid, preview.patch);
    setLivePreview(null);
  }

  const v = view;
  const px = (n: number) => n / v.scale;
  const fontSize = px(11);
  const gridPx = editing && editing.grid > 0 ? editing.grid * v.scale : 0;

  return (
    <div className="relative">
      <div
        ref={boxRef}
        className="overflow-hidden rounded-lg border border-border bg-surface-2"
        style={{ height, minHeight: 320 }}
      >
        <svg
          ref={svgRef}
          role="img"
          aria-label={title}
          viewBox={`${v.x} ${v.y} ${size.w / v.scale} ${size.h / v.scale}`}
          data-extent={`${extent.w} ${extent.h}`}
          className="block h-full w-full touch-none select-none"
          style={{ cursor: tool !== "select" ? "crosshair" : gesture.current?.kind === "pan" ? "grabbing" : "grab" }}
          onPointerDown={onBackgroundDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <defs>
            {/* No-go areas are hatched, so they read as "keep out" without relying on colour alone. */}
            <pattern id="plant-nogo" width={px(10)} height={px(10)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={px(10)} height={px(10)} fill="#ef4444" fillOpacity={0.08} />
              <line x1={0} y1={0} x2={0} y2={px(10)} stroke="#ef4444" strokeOpacity={0.45} strokeWidth={px(2)} />
            </pattern>
          </defs>
          <rect x={0} y={0} width={extent.w} height={extent.h} fill="#ffffff" />
          {wallsUrl ? (
            <image href={wallsUrl} x={0} y={0} width={extent.w} height={extent.h} preserveAspectRatio="none" />
          ) : (
            <rect x={0} y={0} width={extent.w} height={extent.h} fill="none" stroke="#9ca3af" strokeDasharray="12 8" />
          )}
          {gridPx >= 6 && editing && (
            <>
              <defs>
                <pattern id="plant-grid" width={editing.grid} height={editing.grid} patternUnits="userSpaceOnUse">
                  <path
                    d={`M ${editing.grid} 0 L 0 0 0 ${editing.grid}`}
                    fill="none"
                    stroke="#93c5fd"
                    strokeOpacity={0.35}
                    strokeWidth={px(1)}
                  />
                </pattern>
              </defs>
              <rect data-layer="grid" x={0} y={0} width={extent.w} height={extent.h} fill="url(#plant-grid)" pointerEvents="none" />
            </>
          )}

          {found && found.length > 0 && (
            <g data-layer="found" pointerEvents="none">
              {found.map((o) => (
                <polygon
                  key={o.id}
                  data-found={o.kind}
                  points={o.quad.map(([qx, qy]) => `${qx},${qy}`).join(" ")}
                  fill={o.kind === "keepout" ? "#6b7280" : "#f59e0b"}
                  fillOpacity={o.kind === "keepout" ? 0.12 : 0.45}
                  stroke={o.kind === "keepout" ? "#6b7280" : "#d97706"}
                  strokeWidth={px(1.5)}
                  strokeDasharray={o.kind === "keepout" ? `${px(4)} ${px(3)}` : undefined}
                />
              ))}
            </g>
          )}

          <g data-layer="areas" pointerEvents={editing && tool !== "select" ? "none" : undefined}>
            {shownAreas.map((a) => {
              const style = AREA_STYLE[a.kind] ?? AREA_STYLE["no-go"];
              const selected = selectedUid === a.uid;
              const live = !!editing && selected && !a.locked;
              return (
                <g
                  key={a.uid}
                  data-area={a.uid}
                  data-kind={a.kind}
                  transform={`translate(${a.x} ${a.y}) rotate(${a.rot})`}
                  // Viewing: areas are part of the floor — a drag on one pans.
                  pointerEvents={editing ? undefined : "none"}
                  style={{ cursor: editing ? (a.locked ? "not-allowed" : "move") : undefined }}
                  onPointerDown={(e) => onItemDown(e, a)}
                >
                  <title>{a.label || (a.kind === "aisle" ? "Aisle" : "No-go area")}</title>
                  <rect
                    x={-a.w / 2}
                    y={-a.d / 2}
                    width={a.w}
                    height={a.d}
                    fill={a.kind === "no-go" ? "url(#plant-nogo)" : style.fill}
                    fillOpacity={a.kind === "no-go" ? 1 : 0.14}
                    stroke={selected ? SELECTED : style.stroke}
                    strokeWidth={px(selected ? 2.5 : 1.5)}
                    strokeDasharray={selected ? undefined : `${px(8)} ${px(5)}`}
                  />
                  {live && <Handles shape={a} rotate resize px={px} onDown={(e, kind) => onHandleDown(e, a, kind)} />}
                </g>
              );
            })}
          </g>

          <g data-layer="items" pointerEvents={editing && tool !== "select" ? "none" : undefined}>
            {shown.map((it) => {
              const href = symbols.get(it.componentId);
              const problem = problemUids?.has(it.uid) ?? false;
              const selected = selectedUid === it.uid;
              const component = components.get(it.componentId);
              const canResize = !!editing && selected && !it.locked && !!component?.allowResize;
              const canRotate = !!editing && selected && !it.locked && (component?.allowRotate ?? true);
              const hx = it.w / 2;
              const hy = it.d / 2;
              return (
                <g
                  key={it.uid}
                  data-uid={it.uid}
                  transform={`translate(${it.x} ${it.y}) rotate(${it.rot})`}
                  style={{ cursor: editing ? (it.locked ? "not-allowed" : "move") : "pointer" }}
                  onPointerDown={(e) => onItemDown(e, it)}
                >
                  <title>{it.label || "Unnamed item"}</title>
                  {href ? (
                    <image href={href} x={-hx} y={-hy} width={it.w} height={it.d} preserveAspectRatio="none" />
                  ) : (
                    <rect x={-hx} y={-hy} width={it.w} height={it.d} fill="#f3f4f6" stroke="#6b7280" strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} />
                  )}
                  {/* An invisible hit area, so the whole footprint grabs — not just the symbol's lines. */}
                  <rect x={-hx} y={-hy} width={it.w} height={it.d} fill="transparent" />
                  {(problem || selected) && (
                    <rect
                      data-outline={problem ? "problem" : "selected"}
                      x={-hx}
                      y={-hy}
                      width={it.w}
                      height={it.d}
                      fill="none"
                      stroke={problem ? PROBLEM : SELECTED}
                      strokeWidth={px(selected ? 2.5 : 2)}
                      strokeDasharray={selected && problem ? `${px(8)} ${px(4)}` : undefined}
                      pointerEvents="none"
                    />
                  )}
                  {(canRotate || canResize) && (
                    <Handles
                      shape={it}
                      rotate={canRotate}
                      resize={canResize}
                      px={px}
                      onDown={(e, kind) => onHandleDown(e, it, kind, component)}
                    />
                  )}
                </g>
              );
            })}
          </g>

          {editing?.ghost && (
            <g
              data-layer="ghost"
              transform={`translate(${editing.ghost.x} ${editing.ghost.y}) rotate(${editing.ghost.rot})`}
              opacity={0.75}
              pointerEvents="none"
            >
              {symbols.get(editing.ghost.componentId) && (
                <image
                  href={symbols.get(editing.ghost.componentId)}
                  x={-editing.ghost.w / 2}
                  y={-editing.ghost.d / 2}
                  width={editing.ghost.w}
                  height={editing.ghost.d}
                  preserveAspectRatio="none"
                />
              )}
              <rect
                x={-editing.ghost.w / 2}
                y={-editing.ghost.d / 2}
                width={editing.ghost.w}
                height={editing.ghost.d}
                fill={editing.ghostProblem ? "#dc262622" : "#2563eb11"}
                stroke={editing.ghostProblem ? PROBLEM : SELECTED}
                strokeWidth={px(2)}
                strokeDasharray={`${px(6)} ${px(4)}`}
              />
            </g>
          )}

          {drawing && (
            <rect
              data-layer="drawing"
              x={Math.min(drawing.a.x, drawing.b.x)}
              y={Math.min(drawing.a.y, drawing.b.y)}
              width={Math.abs(drawing.b.x - drawing.a.x)}
              height={Math.abs(drawing.b.y - drawing.a.y)}
              fill={AREA_STYLE[tool === "select" ? "aisle" : tool].fill}
              fillOpacity={0.15}
              stroke={AREA_STYLE[tool === "select" ? "aisle" : tool].stroke}
              strokeWidth={px(2)}
              strokeDasharray={`${px(6)} ${px(4)}`}
              pointerEvents="none"
            />
          )}

          {(guides.length > 0 || (editing?.ghostGuides?.length ?? 0) > 0) && (
            <g data-layer="guides" pointerEvents="none">
              {[...guides, ...(editing?.ghostGuides ?? [])].map((gd, i) => (
                <line
                  key={`${gd.axis}-${gd.at}-${i}`}
                  data-guide-axis={gd.axis}
                  x1={gd.axis === "x" ? gd.at : gd.from - px(12)}
                  x2={gd.axis === "x" ? gd.at : gd.to + px(12)}
                  y1={gd.axis === "x" ? gd.from - px(12) : gd.at}
                  y2={gd.axis === "x" ? gd.to + px(12) : gd.at}
                  stroke={GUIDE}
                  strokeWidth={px(1.5)}
                  strokeDasharray={`${px(4)} ${px(4)}`}
                />
              ))}
            </g>
          )}

          {showLabels && (
            // Upright whatever the item's rotation, a fixed size on screen, with a white halo.
            // A label shows when its item is wide enough on screen to hold it, or is selected.
            <g data-layer="labels" pointerEvents="none">
              {shownAreas.map((a) =>
                a.label && (a.uid === selectedUid || Math.max(a.w, a.d) * v.scale >= a.label.length * 6.5) ? (
                  <text
                    key={a.uid}
                    x={a.x}
                    y={a.y}
                    fontSize={fontSize}
                    fontFamily="Arial, sans-serif"
                    fontStyle="italic"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={(AREA_STYLE[a.kind] ?? AREA_STYLE["no-go"]).text}
                    stroke="#ffffff"
                    strokeWidth={px(3)}
                    paintOrder="stroke"
                  >
                    {a.label}
                  </text>
                ) : null,
              )}
              {shown.map((it) =>
                // Only where it fits — a crowd of overlapping names reads as noise. Zoom in for more.
                it.label && (it.uid === selectedUid || Math.max(it.w, it.d) * v.scale >= it.label.length * 6.5) ? (
                  <text
                    key={it.uid}
                    x={it.x}
                    y={it.y}
                    fontSize={fontSize}
                    fontFamily="Arial, sans-serif"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#111827"
                    stroke="#ffffff"
                    strokeWidth={px(3)}
                    paintOrder="stroke"
                  >
                    {it.label}
                  </text>
                ) : null,
              )}
            </g>
          )}
        </svg>
      </div>

      <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md border border-border bg-surface/95 p-1 shadow-xs">
        <ZoomButton label="Zoom out" onClick={() => zoomAt(1 / 1.25)}>
          <Minus className="h-4 w-4" />
        </ZoomButton>
        <span className="w-12 text-center text-xs tabular-nums text-fg-muted" aria-live="polite">
          {Math.round((v.scale / fitView(extent, size).scale) * 100)}%
        </span>
        <ZoomButton label="Zoom in" onClick={() => zoomAt(1.25)}>
          <Plus className="h-4 w-4" />
        </ZoomButton>
        <ZoomButton label="Fit to window" onClick={() => setView(fitView(extent, size))}>
          <Maximize2 className="h-4 w-4" />
        </ZoomButton>
      </div>
    </div>
  );
});

/** The round turn handle above a shape, and its four resize corners. */
function Handles({
  shape,
  rotate,
  resize,
  px,
  onDown,
}: {
  shape: Shape;
  rotate: boolean;
  resize: boolean;
  px: (n: number) => number;
  onDown: (e: React.PointerEvent, kind: "rotate" | "resize") => void;
}) {
  const hx = shape.w / 2;
  const hy = shape.d / 2;
  return (
    <>
      {rotate && (
        <g data-handle="rotate" onPointerDown={(e) => onDown(e, "rotate")} style={{ cursor: "grab" }}>
          <line x1={0} y1={-hy} x2={0} y2={-hy - px(22)} stroke={SELECTED} strokeWidth={px(1.5)} />
          <circle cx={0} cy={-hy - px(22)} r={px(6)} fill="#ffffff" stroke={SELECTED} strokeWidth={px(2)} />
        </g>
      )}
      {resize &&
        [
          [-hx, -hy],
          [hx, -hy],
          [hx, hy],
          [-hx, hy],
        ].map(([cx, cy], i) => (
          <rect
            key={i}
            data-handle="resize"
            x={cx - px(5)}
            y={cy - px(5)}
            width={px(10)}
            height={px(10)}
            fill="#ffffff"
            stroke={SELECTED}
            strokeWidth={px(2)}
            style={{ cursor: "nwse-resize" }}
            onPointerDown={(e) => onDown(e, "resize")}
          />
        ))}
    </>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn("inline-flex h-7 w-7 items-center justify-center rounded-sm text-fg transition-colors hover:bg-surface-2")}
    >
      {children}
    </button>
  );
}
