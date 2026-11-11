import { sanitiseSvg } from "./plantSvg";

// =============================================================================
// Importing a symbol into the Plant Map library (Tim, 2026-11-06: "take a
// drawing in another format, fill out an info form, and ARC converts to SVG and
// adds the metadata when saving").
//
// Every source becomes ART — a piece of SVG in its own coordinates, plus its
// real size when the source knows it — and `buildSymbolSvg` places the art in
// a symbol of the library's shape: `viewBox="0 0 <width> <depth>"` in inches,
// `data-component` / `data-units="in"`, a `<title>`, a faint footprint, and the
// front-edge notch the starter symbols carry (so a turn is visible).
//
//   * SVG — taken as drawn, sanitised. Its size is known only when it says
//     it's in inches (`data-units="in"`, or width/height in "in").
//   * DXF — the CAD exchange format, read here: lines, polylines (bulges
//     too), circles, arcs, ellipses, splines (through their points) and block
//     inserts, all turned into straight segments. Its units come from
//     $INSUNITS, so its real size is known; a DXF that doesn't say is read as
//     inches, and the form says so. Text, dimensions and hatching are left out.
//   * Pictures (PNG, JPG…) — TRACED to a black-and-white silhouette at a
//     threshold the person chooses. Rough, but a symbol is a plan-view
//     outline; a photo of a machine's side is the wrong picture anyway.
//
// ARC never embeds a picture as a picture: `sanitiseSvg` refuses <image>, so a
// symbol is always vectors, and every symbol is sanitised again when drawn.
// =============================================================================

/**
 * The column holds far more (tested to 1,000,000 on LayoutJson, 2026-11-10);
 * this is kept because a symbol is drawn once per placement, and one this
 * detailed already draws slowly.
 */
export const MAX_SYMBOL_MARKUP_CHARS = 60_000;
/** A picture is traced at most this many pixels on its long side. */
export const TRACE_MAX_PIXELS = 160;

const INK = "#374151";
const PAPER = "#f3f4f6";

export interface SymbolArt {
  /** The drawing's markup, children of an <svg> — no outer element. */
  body: string;
  viewBox: { x: number; y: number; w: number; h: number };
  /** Real size in inches, when the source says. */
  sizeInches: { w: number; d: number } | null;
  /** Things the person should know — read as inches, parts left out… */
  notes: string[];
}

export type ArtResult = { ok: true; art: SymbolArt } | { ok: false; problem: string };

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const fmt = (n: number) => String(round(n));

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

/** A length in inches from an SVG width/height ("36in", "3ft"), or null. */
function inches(v: string | null): number | null {
  if (!v) return null;
  const m = /^\s*([\d.]+)\s*(in|ft|mm|cm|m)\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const per: Record<string, number> = { in: 1, ft: 12, mm: 1 / 25.4, cm: 1 / 2.54, m: 39.3701 };
  return Number.isFinite(n) && n > 0 ? n * per[m[2].toLowerCase()] : null;
}

export function svgToArt(raw: string): ArtResult {
  const clean = sanitiseSvg(raw);
  if (!clean) return { ok: false, problem: "That file isn't an SVG drawing ARC can read." };
  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length > 0) {
    return { ok: false, problem: "That file isn't an SVG drawing ARC can read." };
  }
  let box: SymbolArt["viewBox"] | null = null;
  const vb = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
    box = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
  } else {
    const w = parseFloat(root.getAttribute("width") ?? "");
    const h = parseFloat(root.getAttribute("height") ?? "");
    if (w > 0 && h > 0) box = { x: 0, y: 0, w, h };
  }
  if (!box) return { ok: false, problem: "The drawing has no viewBox or size, so ARC can't tell how big it is." };

  const notes: string[] = [];
  let sizeInches: SymbolArt["sizeInches"] = null;
  const units = (root.getAttribute("data-units") ?? "").trim().toLowerCase();
  const wIn = inches(root.getAttribute("width"));
  const hIn = inches(root.getAttribute("height"));
  if (units === "in") sizeInches = { w: round(box.w, 1), d: round(box.h, 1) };
  else if (wIn && hIn) sizeInches = { w: round(wIn, 1), d: round(hIn, 1) };
  else notes.push("The drawing doesn't say how big it is in real life — enter its real width and depth.");

  const serializer = new XMLSerializer();
  const body = Array.from(root.childNodes)
    .filter((n) => !(n.nodeType === 1 && ["title", "desc"].includes((n as Element).nodeName.toLowerCase())))
    .map((n) => serializer.serializeToString(n))
    .join("")
    // Serialised from an SVG document, each child repeats the namespace.
    .replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "")
    .trim();
  if (!body) return { ok: false, problem: "That drawing is empty." };
  return { ok: true, art: { body, viewBox: box, sizeInches, notes } };
}

// ---------------------------------------------------------------------------
// DXF
// ---------------------------------------------------------------------------

type Pt = [number, number];
interface Polyline {
  pts: Pt[];
  closed: boolean;
}
interface DxfEntity {
  type: string;
  codes: [number, string][];
  /** POLYLINE's vertices. */
  vertices?: DxfEntity[];
}
interface DxfBlock {
  base: Pt;
  entities: DxfEntity[];
}

/** $INSUNITS → inches per drawing unit. 0 / missing = unitless. */
const DXF_UNITS: Record<number, { perUnit: number; name: string }> = {
  1: { perUnit: 1, name: "inches" },
  2: { perUnit: 12, name: "feet" },
  4: { perUnit: 1 / 25.4, name: "millimetres" },
  5: { perUnit: 1 / 2.54, name: "centimetres" },
  6: { perUnit: 39.3701, name: "metres" },
};

const CIRCLE_SEGMENTS = 48;

function readPairs(text: string): [number, string][] {
  const lines = text.split(/\r?\n/);
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) return [];
    out.push([code, lines[i + 1].trim()]);
  }
  return out;
}

function first(e: DxfEntity, code: number, fallback = 0): number {
  const hit = e.codes.find(([c]) => c === code);
  const n = hit ? Number(hit[1]) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function firstText(e: DxfEntity, code: number): string {
  return e.codes.find(([c]) => c === code)?.[1] ?? "";
}

/** Split a run of pairs into entities (each starts at a code-0 pair), gathering POLYLINE vertices. */
function readEntities(pairs: [number, string][]): DxfEntity[] {
  const raw: DxfEntity[] = [];
  for (const [code, value] of pairs) {
    if (code === 0) raw.push({ type: value.toUpperCase(), codes: [] });
    else raw[raw.length - 1]?.codes.push([code, value]);
  }
  const out: DxfEntity[] = [];
  let poly: DxfEntity | null = null;
  for (const e of raw) {
    if (e.type === "POLYLINE") {
      poly = { ...e, vertices: [] };
      out.push(poly);
    } else if (e.type === "VERTEX" && poly) poly.vertices!.push(e);
    else if (e.type === "SEQEND") poly = null;
    else out.push(e);
  }
  return out;
}

function arcPoints(cx: number, cy: number, r: number, a0: number, sweep: number): Pt[] {
  const n = Math.max(2, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * CIRCLE_SEGMENTS));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + (sweep * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt;
  });
}

/** The points of a polyline segment with a bulge (a circular arc), excluding the start. */
function bulgeSegment(p1: Pt, p2: Pt, bulge: number): Pt[] {
  if (Math.abs(bulge) < 1e-9) return [p2];
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const c = Math.hypot(x2 - x1, y2 - y1);
  if (c === 0) return [p2];
  const theta = 4 * Math.atan(bulge);
  const r = c / (2 * Math.sin(theta / 2));
  const h = r * Math.cos(theta / 2);
  const cx = (x1 + x2) / 2 + (-(y2 - y1) / c) * h;
  const cy = (y1 + y2) / 2 + ((x2 - x1) / c) * h;
  const pts = arcPoints(cx, cy, Math.abs(r), Math.atan2(y1 - cy, x1 - cx), theta);
  pts[pts.length - 1] = p2;
  return pts.slice(1);
}

function verticesWithBulge(list: { pt: Pt; bulge: number }[], closed: boolean): Pt[] {
  if (list.length === 0) return [];
  const pts: Pt[] = [list[0].pt];
  const n = closed ? list.length : list.length - 1;
  for (let i = 0; i < n; i++) {
    const a = list[i];
    const b = list[(i + 1) % list.length];
    pts.push(...bulgeSegment(a.pt, b.pt, a.bulge));
  }
  // A closed one came back to its start; the path's Z draws that side.
  if (closed && pts.length > 2) pts.pop();
  return pts;
}

/** One entity as polylines, in drawing units (before any block transform). */
function entityPolylines(e: DxfEntity): Polyline[] | null {
  switch (e.type) {
    case "LINE":
      return [{ pts: [[first(e, 10), first(e, 20)], [first(e, 11), first(e, 21)]], closed: false }];
    case "LWPOLYLINE": {
      const list: { pt: Pt; bulge: number }[] = [];
      for (const [code, value] of e.codes) {
        if (code === 10) list.push({ pt: [Number(value), 0], bulge: 0 });
        else if (code === 20 && list.length) list[list.length - 1].pt[1] = Number(value);
        else if (code === 42 && list.length) list[list.length - 1].bulge = Number(value);
      }
      const closed = (first(e, 70) & 1) === 1;
      return [{ pts: verticesWithBulge(list, closed), closed }];
    }
    case "POLYLINE": {
      const list = (e.vertices ?? []).map((v) => ({ pt: [first(v, 10), first(v, 20)] as Pt, bulge: first(v, 42) }));
      const closed = (first(e, 70) & 1) === 1;
      return [{ pts: verticesWithBulge(list, closed), closed }];
    }
    case "CIRCLE": {
      const pts = arcPoints(first(e, 10), first(e, 20), first(e, 40), 0, 2 * Math.PI);
      return [{ pts: pts.slice(0, -1), closed: true }];
    }
    case "ARC": {
      const a0 = (first(e, 50) * Math.PI) / 180;
      let a1 = (first(e, 51) * Math.PI) / 180;
      if (a1 <= a0) a1 += 2 * Math.PI;
      return [{ pts: arcPoints(first(e, 10), first(e, 20), first(e, 40), a0, a1 - a0), closed: false }];
    }
    case "ELLIPSE": {
      const cx = first(e, 10);
      const cy = first(e, 20);
      const mx = first(e, 11);
      const my = first(e, 21);
      const ratio = first(e, 40, 1);
      const t0 = first(e, 41, 0);
      let t1 = first(e, 42, 2 * Math.PI);
      if (t1 <= t0) t1 += 2 * Math.PI;
      const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6;
      const n = Math.max(8, Math.ceil(((t1 - t0) / (2 * Math.PI)) * CIRCLE_SEGMENTS));
      const pts: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n;
        // major axis (mx, my), minor = major turned 90° × ratio
        pts.push([cx + mx * Math.cos(t) - my * ratio * Math.sin(t), cy + my * Math.cos(t) + mx * ratio * Math.sin(t)]);
      }
      return [{ pts: full ? pts.slice(0, -1) : pts, closed: full }];
    }
    case "SPLINE": {
      // Through its fit points if it has them, else its control points — close enough for a plan symbol.
      const fit: Pt[] = [];
      const ctrl: Pt[] = [];
      for (const [code, value] of e.codes) {
        if (code === 11) fit.push([Number(value), 0]);
        else if (code === 21 && fit.length) fit[fit.length - 1][1] = Number(value);
        else if (code === 10) ctrl.push([Number(value), 0]);
        else if (code === 20 && ctrl.length) ctrl[ctrl.length - 1][1] = Number(value);
      }
      const pts = fit.length >= 2 ? fit : ctrl;
      return pts.length >= 2 ? [{ pts, closed: (first(e, 70) & 1) === 1 }] : [];
    }
    default:
      return null;
  }
}

/**
 * A DXF as art. The drawing is flipped (CAD's y runs up), moved to start at
 * 0 0, and converted to inches by its $INSUNITS.
 */
export function dxfToArt(text: string): ArtResult {
  const pairs = readPairs(text);
  if (pairs.length === 0 || !pairs.some(([c, v]) => c === 0 && v.toUpperCase() === "SECTION")) {
    return {
      ok: false,
      problem: "That file isn't a DXF ARC can read. Save it from CAD as an ASCII DXF (not binary, not DWG).",
    };
  }

  // Sections by name.
  const sections = new Map<string, [number, string][]>();
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1].toUpperCase() === "SECTION" && pairs[i + 1]?.[0] === 2) {
      const name = pairs[i + 1][1].toUpperCase();
      let j = i + 2;
      while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1].toUpperCase() === "ENDSEC")) j++;
      sections.set(name, pairs.slice(i + 2, j));
      i = j;
    }
  }

  const header = sections.get("HEADER") ?? [];
  const unitsAt = header.findIndex(([c, v]) => c === 9 && v.toUpperCase() === "$INSUNITS");
  const unitsCode = unitsAt >= 0 ? Number(header[unitsAt + 1]?.[1]) : 0;
  const notes: string[] = [];
  const units = DXF_UNITS[unitsCode];
  if (!units) notes.push("The DXF doesn't say what units it's in, so ARC read it as inches. Check the size below.");

  // Blocks, for INSERTs.
  const blocks = new Map<string, DxfBlock>();
  let current: DxfBlock | null = null;
  let currentName = "";
  for (const e of readEntities(sections.get("BLOCKS") ?? [])) {
    if (e.type === "BLOCK") {
      currentName = firstText(e, 2);
      current = { base: [first(e, 10), first(e, 20)], entities: [] };
      blocks.set(currentName, current);
    } else if (e.type === "ENDBLK") current = null;
    else current?.entities.push(e);
  }

  const lines: Polyline[] = [];
  const skipped = new Set<string>();
  const IGNORED = new Set(["TEXT", "MTEXT", "DIMENSION", "HATCH", "POINT", "ATTDEF", "ATTRIB", "VIEWPORT", "LEADER", "MLEADER"]);

  function walk(entities: DxfEntity[], transform: (p: Pt) => Pt, depth: number) {
    for (const e of entities) {
      if (e.type === "INSERT") {
        const block = blocks.get(firstText(e, 2));
        if (!block || depth > 8) continue;
        const ix = first(e, 10);
        const iy = first(e, 20);
        const sx = first(e, 41, 1);
        const sy = first(e, 42, 1);
        const rot = (first(e, 50) * Math.PI) / 180;
        const [bx, by] = block.base;
        walk(
          block.entities,
          ([x, y]) => {
            const lx = (x - bx) * sx;
            const ly = (y - by) * sy;
            return transform([ix + lx * Math.cos(rot) - ly * Math.sin(rot), iy + lx * Math.sin(rot) + ly * Math.cos(rot)]);
          },
          depth + 1,
        );
        continue;
      }
      const polys = entityPolylines(e);
      if (polys === null) {
        if (!IGNORED.has(e.type)) skipped.add(e.type);
        continue;
      }
      for (const p of polys) if (p.pts.length >= 2) lines.push({ pts: p.pts.map(transform), closed: p.closed });
    }
  }
  walk(readEntities(sections.get("ENTITIES") ?? []), (p) => p, 0);

  if (lines.length === 0) {
    return { ok: false, problem: "ARC found no lines, arcs or circles in that DXF to draw." };
  }
  if (skipped.size > 0) notes.push(`Left out what ARC can't draw: ${[...skipped].sort().join(", ")}.`);
  notes.push("Text, dimensions and hatching in the DXF are left out.");

  const k = units?.perUnit ?? 1;
  const xs = lines.flatMap((l) => l.pts.map((p) => p[0]));
  const ys = lines.flatMap((l) => l.pts.map((p) => p[1]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = (maxX - minX) * k;
  const h = (maxY - minY) * k;
  // One side may be zero — a drawing of a single straight line — but not both.
  if (Math.max(w, h) < 0.5) {
    return {
      ok: false,
      problem: `That drawing is only ${fmt(w)} × ${fmt(h)} inches — it's probably in other units. Check $INSUNITS in CAD.`,
    };
  }
  const d = lines
    .map(
      (l) =>
        "M" +
        l.pts.map(([x, y]) => `${fmt((x - minX) * k)} ${fmt((maxY - y) * k)}`).join("L") +
        (l.closed ? "Z" : ""),
    )
    .join("");
  const stroke = round(Math.min(2, Math.max(0.25, Math.max(w, h) / 100)), 2);
  return {
    ok: true,
    art: {
      body: `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>`,
      viewBox: { x: 0, y: 0, w: Math.max(0.01, round(w)), h: Math.max(0.01, round(h)) },
      sizeInches: { w: round(w, 1), d: round(h, 1) },
      notes,
    },
  };
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

/**
 * Which pixels are INK: darker than `threshold` (0–255) and not transparent.
 * When most of the picture's border reads as ink, the picture is light-on-dark
 * and is inverted, so the drawing — not the background — is what's kept.
 */
export function inkFromRgba(rgba: ArrayLike<number>, w: number, h: number, threshold: number): Uint8Array {
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3];
    ink[i] = a >= 128 && 0.299 * r + 0.587 * g + 0.114 * b < threshold ? 1 : 0;
  }
  let border = 0;
  let inked = 0;
  for (let x = 0; x < w; x++) {
    border += 2;
    inked += ink[x] + ink[(h - 1) * w + x];
  }
  for (let y = 1; y < h - 1; y++) {
    border += 2;
    inked += ink[y * w] + ink[y * w + w - 1];
  }
  if (border > 0 && inked / border > 0.5) {
    // Transparent pixels stay blank either way.
    for (let i = 0; i < w * h; i++) ink[i] = rgba[i * 4 + 3] >= 128 ? 1 - ink[i] : 0;
  }
  return ink;
}

/**
 * Ink pixels as one SVG path of rectangles: runs along each row, stacked into
 * taller rectangles where rows repeat. Exact, and compact for drawn symbols.
 */
export function traceInk(ink: ArrayLike<number>, w: number, h: number): string {
  interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  const done: Rect[] = [];
  let open = new Map<string, Rect>();
  for (let y = 0; y < h; y++) {
    const next = new Map<string, Rect>();
    let x = 0;
    while (x < w) {
      if (!ink[y * w + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < w && ink[y * w + x]) x++;
      const key = `${start}:${x}`;
      const above = open.get(key);
      if (above) {
        above.h += 1;
        next.set(key, above);
        open.delete(key);
      } else next.set(key, { x: start, y, w: x - start, h: 1 });
    }
    done.push(...open.values());
    open = next;
  }
  done.push(...open.values());
  done.sort((a, b) => a.y - b.y || a.x - b.x);
  return done.map((r) => `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}z`).join("");
}

/** Traced ink as art (in pixels — the footprint comes from the form). */
export function tracedArt(ink: ArrayLike<number>, w: number, h: number): ArtResult {
  const d = traceInk(ink, w, h);
  if (!d) return { ok: false, problem: "Nothing in the picture is dark enough to trace — move the threshold." };
  return {
    ok: true,
    art: {
      body: `<path d="${d}" fill="${INK}"/>`,
      viewBox: { x: 0, y: 0, w, h },
      sizeInches: null,
      notes: ["A picture is traced to a silhouette. Enter its real width and depth."],
    },
  };
}

// ---------------------------------------------------------------------------
// The symbol
// ---------------------------------------------------------------------------

export interface SymbolSpec {
  title: string;
  key: string;
  /** Footprint, inches. */
  w: number;
  d: number;
  /** "contain" keeps the drawing's proportions, centred; "stretch" fills the footprint. */
  fit: "contain" | "stretch";
  /** The small notch on the bottom (front / operator) edge. */
  frontMark: boolean;
}

/** The library's symbol SVG — sanitised, ready for SvgMarkup. */
export function buildSymbolSvg(art: SymbolArt, spec: SymbolSpec): string {
  const { w, d } = spec;
  const edge = round(Math.min(1.5, Math.max(0.25, Math.min(w, d) / 40)), 2);
  const vb = art.viewBox;
  const notch = round(Math.min(6, Math.max(1.5, Math.min(w, d) * 0.12)), 2);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(w)} ${fmt(d)}" data-component="${escapeXml(spec.key)}" data-units="in">`,
    `<title>${escapeXml(spec.title)}</title>`,
    `<g id="body">`,
    `<rect x="${fmt(edge / 2)}" y="${fmt(edge / 2)}" width="${fmt(w - edge)}" height="${fmt(d - edge)}" fill="${PAPER}" stroke="#9ca3af" stroke-width="${fmt(edge)}"/>`,
    `<svg x="0" y="0" width="${fmt(w)}" height="${fmt(d)}" viewBox="${fmt(vb.x)} ${fmt(vb.y)} ${fmt(vb.w)} ${fmt(vb.h)}" preserveAspectRatio="${spec.fit === "stretch" ? "none" : "xMidYMid meet"}">${art.body}</svg>`,
    spec.frontMark
      ? `<path d="M${fmt(w / 2 - notch)} ${fmt(d)}L${fmt(w / 2)} ${fmt(d - notch)}L${fmt(w / 2 + notch)} ${fmt(d)}Z" fill="${INK}"/>`
      : "",
    `</g>`,
    `</svg>`,
  ];
  return sanitiseSvg(parts.join(""));
}

/** Does the drawing's shape differ from the footprint's by more than 15%? */
export function proportionsDiffer(art: SymbolArt, w: number, d: number): boolean {
  if (!(w > 0 && d > 0)) return false;
  const a = art.viewBox.w / art.viewBox.h;
  const b = w / d;
  return Math.abs(a - b) / b > 0.15;
}

/** "cnc-router-96x48" — unique among `taken` (a -2, -3… on a clash). */
export function symbolKeyFor(title: string, w: number, d: number, taken: Iterable<string>): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "symbol";
  const size = `${Math.round(w)}x${Math.round(d)}`;
  // "Desk 60x30" already says its size.
  const base = slug.endsWith(size) ? slug : `${slug}-${size}`;
  const used = new Set([...taken].map((k) => k.toLowerCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * A stored symbol with a new name — its `<title>` replaced, or one added after
 * the opening tag. Used when a symbol's next version keeps its drawing but
 * changes its name, so the SVG doesn't keep announcing the old one.
 */
export function retitleSymbolSvg(svg: string, title: string): string {
  const tag = `<title>${escapeXml(title)}</title>`;
  // Function replacers: a "$" in a name is text, not a replacement pattern.
  if (/<title>[\s\S]*?<\/title>/.test(svg)) return svg.replace(/<title>[\s\S]*?<\/title>/, () => tag);
  return svg.replace(/<svg\b[^>]*>/, (open) => open + tag);
}
