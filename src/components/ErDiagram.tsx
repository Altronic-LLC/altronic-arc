import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Maximize, Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import {
  HEADER_HEIGHT,
  ROW_HEIGHT,
  layoutEr,
  routeConnection,
  rowCenterY,
  type ErConnection,
  type ErGroup,
  type ErTable,
  type PlacedTable,
} from "@/lib/erLayout";
import { cn } from "@/lib/cn";

// =============================================================================
// The About page's Data model — an ER diagram you can zoom and pan.
//
// Layout is computed (lib/erLayout.ts); this file draws it and handles the
// viewport. Three things that keep it readable at 60+ tables:
//
//   - Hovering (or tapping) a table highlights its connectors and fades every
//     table it isn't connected to. Tapping pins that; tapping the background
//     clears it.
//   - Links to the HUB tables (Person, Comment, Attachment — each pointed at
//     from half the diagram) are hidden unless switched on, but always show
//     for the highlighted table.
//   - Plain scrolling still scrolls the PAGE. Zoom is Ctrl/⌘ + scroll (which
//     is also what a trackpad pinch sends), a pinch on touch, or the buttons —
//     a diagram that swallows the scroll wheel traps people half way down the
//     About page. In full-screen mode there is no page to scroll, so the
//     wheel pans.
//
// Panning re-renders only the transform: the drawing itself is a memoised
// element, which React skips when it is the same object.
// =============================================================================

const MIN_SCALE = 0.1;
const MAX_SCALE = 3;
const ZOOM_STEP = 1.25;
const FIT_PAD = 16;
/** Movement under this many pixels is a tap, not a drag. */
const TAP_SLOP = 5;

const LINE = "rgb(var(--fg-muted))";
const HIGHLIGHT = "rgb(var(--accent))";

interface View {
  scale: number;
  x: number;
  y: number;
}

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function ErDiagram({
  tables,
  groups,
  connections,
  hubTables,
}: {
  tables: ErTable[];
  groups: ErGroup[];
  connections: ErConnection[];
  /** Tables whose incoming links are hidden until switched on. */
  hubTables: string[];
}) {
  const layout = useMemo(() => layoutEr(tables, groups), [tables, groups]);
  const byName = useMemo(
    () => Object.fromEntries(layout.tables.map((t) => [t.name, t])) as Record<string, PlacedTable>,
    [layout],
  );

  const [showHubLinks, setShowHubLinks] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);

  const active = pinned ?? hovered;

  // --- viewport maths -------------------------------------------------------

  const viewportSize = useCallback(() => {
    const el = viewportRef.current;
    // jsdom (and a not-yet-laid-out element) reports 0 — fall back to
    // something sensible rather than dividing by zero.
    return { w: el?.clientWidth || 1000, h: el?.clientHeight || 600 };
  }, []);

  const fitWidth = useCallback(() => {
    const { w } = viewportSize();
    const scale = clampScale((w - FIT_PAD * 2) / layout.width);
    setView({ scale, x: (w - layout.width * scale) / 2, y: FIT_PAD });
  }, [layout, viewportSize]);

  const fitAll = useCallback(() => {
    const { w, h } = viewportSize();
    const scale = clampScale(
      Math.min((w - FIT_PAD * 2) / layout.width, (h - FIT_PAD * 2) / layout.height),
    );
    setView({
      scale,
      x: (w - layout.width * scale) / 2,
      y: (h - layout.height * scale) / 2,
    });
  }, [layout, viewportSize]);

  /** Zoom by `factor`, keeping the point (cx, cy) in the viewport still. */
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const el = viewportRef.current;
      const px = cx ?? (el?.clientWidth || 1000) / 2;
      const py = cy ?? (el?.clientHeight || 600) / 2;
      const scale = clampScale(v.scale * factor);
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  const actualSize = useCallback(() => {
    const { w } = viewportSize();
    setView((v) => {
      // Keep whatever is at the centre of the viewport at the centre.
      const centreX = (w / 2 - v.x) / v.scale;
      return { scale: 1, x: w / 2 - centreX, y: v.y };
    });
  }, [viewportSize]);

  // Fit the width on first paint and whenever the frame changes size class.
  useLayoutEffect(() => {
    fitWidth();
  }, [fitWidth, expanded]);

  // Wheel: needs a NON-passive listener to be allowed to preventDefault.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - rect.left, e.clientY - rect.top);
      } else if (expanded) {
        e.preventDefault();
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, expanded]);

  // --- pointer: drag to pan, pinch to zoom, tap to pin ------------------------

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: number; table: string | null; pinchDist: number }>({
    moved: 0,
    table: null,
    pinchDist: 0,
  });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("[data-er-control]")) return;
    viewportRef.current?.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      const tableEl = (e.target as Element).closest("[data-er-table]");
      gesture.current = { moved: 0, table: tableEl?.getAttribute("data-er-table") ?? null, pinchDist: 0 };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.moved = TAP_SLOP; // a pinch is never a tap
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);

    if (pointers.current.size === 1) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      gesture.current.moved += Math.abs(dx) + Math.abs(dy);
      if (gesture.current.moved >= TAP_SLOP) {
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = viewportRef.current?.getBoundingClientRect();
      if (gesture.current.pinchDist > 0 && rect) {
        zoomAt(
          dist / gesture.current.pinchDist,
          (a.x + b.x) / 2 - rect.left,
          (a.y + b.y) / 2 - rect.top,
        );
      }
      gesture.current.pinchDist = dist;
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0 && gesture.current.moved < TAP_SLOP) {
      const t = gesture.current.table;
      setPinned((p) => (t && p !== t ? t : null));
    }
    if (pointers.current.size < 2) gesture.current.pinchDist = 0;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const PAN = 80;
    switch (e.key) {
      case "+":
      case "=":
        zoomAt(ZOOM_STEP);
        break;
      case "-":
      case "_":
        zoomAt(1 / ZOOM_STEP);
        break;
      case "0":
        fitWidth();
        break;
      case "ArrowLeft":
        setView((v) => ({ ...v, x: v.x + PAN }));
        break;
      case "ArrowRight":
        setView((v) => ({ ...v, x: v.x - PAN }));
        break;
      case "ArrowUp":
        setView((v) => ({ ...v, y: v.y + PAN }));
        break;
      case "ArrowDown":
        setView((v) => ({ ...v, y: v.y - PAN }));
        break;
      case "Escape":
        // Handled HERE and stopped, so closing full screen doesn't also
        // close whatever sits behind it (CLAUDE.md: Escape closes ONE thing).
        if (expanded) setExpanded(false);
        else if (pinned) setPinned(null);
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  // --- the drawing (memoised: panning must not rebuild it) -------------------

  const drawing = useMemo(() => {
    const isHub = (name: string) => hubTables.includes(name);
    const involves = (c: ErConnection, name: string | null) =>
      name !== null && (c.fromTable === name || c.toTable === name);

    const neighbours = new Set<string>();
    if (active) {
      neighbours.add(active);
      for (const c of connections) {
        if (c.fromTable === active) neighbours.add(c.toTable);
        if (c.toTable === active) neighbours.add(c.fromTable);
      }
    }

    const paths = connections
      .map((c, i) => {
        const from = byName[c.fromTable];
        const to = byName[c.toTable];
        if (!from || !to || from === to) return null;
        const hub = isHub(c.fromTable) || isHub(c.toTable);
        const lit = involves(c, active);
        if (hub && !showHubLinks && !lit) return null;
        return {
          key: i,
          lit,
          d: routeConnection(
            from,
            rowCenterY(from, c.fromColumn),
            to,
            rowCenterY(to, c.toColumn),
            i,
            layout.tables,
          ),
          fromCard: c.fromCard,
          toCard: c.toCard,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const line = (p: (typeof paths)[number], lit: boolean) => (
      <path
        key={p.key}
        d={p.d}
        stroke={lit ? HIGHLIGHT : LINE}
        strokeWidth={lit ? 2 : 1.2}
        strokeOpacity={active && !lit ? 0.25 : 1}
        fill="none"
        markerStart={`url(#er-${p.fromCard}${lit ? "-lit" : ""})`}
        markerEnd={`url(#er-${p.toCard}${lit ? "-lit" : ""})`}
      />
    );

    return (
      <>
        {layout.groups.map((g) => (
          <g key={g.id}>
            <rect
              x={g.x}
              y={g.y}
              width={g.width}
              height={g.height}
              rx="12"
              fill="rgb(var(--surface-2))"
              fillOpacity="0.55"
              stroke="rgb(var(--border))"
              strokeDasharray="6 4"
            />
            <text
              x={g.x + 20}
              y={g.y + 30}
              fontSize="18"
              fontWeight="700"
              fill="rgb(var(--fg-muted))"
              letterSpacing="0.06em"
            >
              {g.label.toUpperCase()}
            </text>
          </g>
        ))}

        {/* Ordinary connectors sit behind the cards… */}
        {paths.filter((p) => !p.lit).map((p) => line(p, false))}

        {layout.tables.map((t) => (
          <SchemaTableSvg
            key={t.name}
            table={t}
            dimmed={active !== null && !neighbours.has(t.name)}
            selected={t.name === active}
            onEnter={setHovered}
            onLeave={() => setHovered(null)}
          />
        ))}

        {/* …a highlighted one is drawn on top, so it can be traced end to end. */}
        {paths.filter((p) => p.lit).map((p) => line(p, true))}
      </>
    );
  }, [layout, byName, connections, hubTables, showHubLinks, active]);

  const hubList =
    hubTables.length > 1
      ? `${hubTables.slice(0, -1).join(", ")} and ${hubTables[hubTables.length - 1]}`
      : hubTables[0] ?? "";

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        expanded && "fixed inset-0 z-50 bg-bg p-3 sm:p-4",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="inline-flex items-center rounded-md border border-border bg-surface">
          <ToolButton label="Zoom out" onClick={() => zoomAt(1 / ZOOM_STEP)}>
            <ZoomOut className="h-4 w-4" />
          </ToolButton>
          <button
            type="button"
            onClick={actualSize}
            title="Actual size (100%)"
            aria-label="Actual size"
            className="min-w-[3.25rem] border-x border-border px-2 py-1.5 tabular-nums text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            {Math.round(view.scale * 100)}%
          </button>
          <ToolButton label="Zoom in" onClick={() => zoomAt(ZOOM_STEP)}>
            <ZoomIn className="h-4 w-4" />
          </ToolButton>
        </div>
        <ToolButton label="Fit the whole diagram" onClick={fitAll} bordered>
          <Maximize className="h-4 w-4" />
          <span className="hidden sm:inline">Fit</span>
        </ToolButton>
        <ToolButton
          label={expanded ? "Exit full screen" : "Full screen"}
          onClick={() => setExpanded((x) => !x)}
          bordered
        >
          {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          <span className="hidden sm:inline">{expanded ? "Exit full screen" : "Full screen"}</span>
        </ToolButton>
        <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5 text-fg-muted">
          <input
            type="checkbox"
            checked={showHubLinks}
            onChange={(e) => setShowHubLinks(e.target.checked)}
            className="h-3.5 w-3.5 accent-[rgb(var(--accent))]"
          />
          Show every link to {hubList}
        </label>
        {pinned && (
          <button
            type="button"
            onClick={() => setPinned(null)}
            className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-accent hover:bg-accent/20"
          >
            Showing {pinned} — clear
          </button>
        )}
      </div>

      <div
        ref={viewportRef}
        tabIndex={0}
        role="group"
        aria-label="Data model diagram. Drag to move, Ctrl and scroll or pinch to zoom, plus and minus keys to zoom, arrow keys to move."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className={cn(
          "relative cursor-grab touch-none select-none overflow-hidden rounded-md border border-border bg-bg outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:cursor-grabbing",
          expanded ? "min-h-0 flex-1" : "h-[min(70vh,760px)] min-h-[420px]",
        )}
      >
        <svg
          width="100%"
          height="100%"
          role="img"
          aria-label="Entity-relationship diagram for ARC (Altronic Resource Center)"
          className="block"
        >
          <ErMarkers />
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>{drawing}</g>
        </svg>
      </div>

      <p className="text-[11px] text-fg-muted">
        Drag to move · Ctrl/⌘ + scroll or pinch to zoom · hover or tap a table to trace its
        links, tap again to clear.
      </p>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  bordered,
  children,
}: {
  label: string;
  onClick: () => void;
  bordered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
        bordered && "rounded-md border border-border bg-surface",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Crow's-foot markers. Drawn so the FAN touches the table edge, and with
 * `auto-start-reverse` so a marker at the start of a line faces its table
 * too — with plain `auto` the start marker pointed INTO the card and was
 * hidden under it.
 */
function ErMarkers() {
  const marker = (id: string, color: string, kind: "one" | "many") => (
    <marker
      key={id}
      id={id}
      markerWidth="14"
      markerHeight="14"
      refX="13"
      refY="7"
      orient="auto-start-reverse"
      markerUnits="userSpaceOnUse"
    >
      {kind === "many" ? (
        <path d="M 2,7 L 13,1 M 2,7 L 13,7 M 2,7 L 13,13" stroke={color} strokeWidth="1.4" fill="none" />
      ) : (
        <>
          <circle cx="6" cy="7" r="3" stroke={color} strokeWidth="1.4" fill="rgb(var(--bg))" />
          <line x1="9" y1="7" x2="13" y2="7" stroke={color} strokeWidth="1.4" />
        </>
      )}
    </marker>
  );
  return (
    <defs>
      {marker("er-many", LINE, "many")}
      {marker("er-one", LINE, "one")}
      {marker("er-many-lit", HIGHLIGHT, "many")}
      {marker("er-one-lit", HIGHLIGHT, "one")}
    </defs>
  );
}

function SchemaTableSvg({
  table,
  dimmed,
  selected,
  onEnter,
  onLeave,
}: {
  table: PlacedTable;
  dimmed: boolean;
  selected: boolean;
  onEnter: (name: string) => void;
  onLeave: () => void;
}) {
  const { x, y, width, height } = table;
  const headerFill = table.palette === "entity" ? "#CB2C30" : "#1C60AC";
  // Index of the last PK row so we can draw the dashed separator after it.
  const lastPkIdx = table.columns.findIndex((c) => c.kind !== "pk") - 1;
  const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

  return (
    <g
      data-er-table={table.name}
      opacity={dimmed ? 0.3 : 1}
      onPointerEnter={(e) => e.pointerType === "mouse" && onEnter(table.name)}
      onPointerLeave={(e) => e.pointerType === "mouse" && onLeave()}
      style={{ cursor: "pointer" }}
    >
      <title>{`${table.name} — ${table.source}`}</title>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="6"
        fill="rgb(var(--surface))"
        stroke={selected ? HIGHLIGHT : "rgb(var(--border))"}
        strokeWidth={selected ? 2.5 : 1}
      />
      <path
        d={`M ${x} ${y + HEADER_HEIGHT} L ${x} ${y + 6} Q ${x} ${y} ${x + 6} ${y}
            L ${x + width - 6} ${y} Q ${x + width} ${y} ${x + width} ${y + 6}
            L ${x + width} ${y + HEADER_HEIGHT} Z`}
        fill={headerFill}
      />
      <text x={x + width / 2} y={y + 22} fontSize="14" fontWeight="700" fill="#fff" textAnchor="middle">
        {table.name}
      </text>
      <text x={x + width / 2} y={y + 40} fontSize="10" fill="rgba(255,255,255,0.85)" textAnchor="middle">
        {table.source}
      </text>

      {table.columns.map((col, i) => {
        const rowY = y + HEADER_HEIGHT + i * ROW_HEIGHT;
        return (
          <g key={col.name}>
            {col.kind !== "field" && (
              <>
                <rect
                  x={x + 8}
                  y={rowY + 4}
                  width={26}
                  height={14}
                  rx="3"
                  fill={col.kind === "pk" ? "#CB2C30" : "#1C60AC"}
                />
                <text
                  x={x + 21}
                  y={rowY + 14}
                  fontSize="9"
                  fontWeight="700"
                  fill="#fff"
                  textAnchor="middle"
                >
                  {col.kind === "pk" ? "PK" : "FK"}
                </text>
              </>
            )}
            <text x={x + 42} y={rowY + 15} fontSize="11" fill="rgb(var(--fg))" fontFamily={mono}>
              {col.name}
            </text>
            <text
              x={x + width - 8}
              y={rowY + 15}
              fontSize="10"
              fill="rgb(var(--fg-muted))"
              textAnchor="end"
              fontFamily={mono}
            >
              {col.type}
            </text>
          </g>
        );
      })}

      {/* Dashed separator under the PK rows (Visio convention). */}
      {lastPkIdx >= 0 && (
        <line
          x1={x + 8}
          y1={y + HEADER_HEIGHT + (lastPkIdx + 1) * ROW_HEIGHT - 1}
          x2={x + width - 8}
          y2={y + HEADER_HEIGHT + (lastPkIdx + 1) * ROW_HEIGHT - 1}
          stroke="rgb(var(--border))"
          strokeDasharray="2 3"
        />
      )}
    </g>
  );
}
