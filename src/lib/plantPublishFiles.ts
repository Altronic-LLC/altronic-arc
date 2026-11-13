import { sanitiseSvg } from "./plantSvg";
import { layoutLayers } from "./plantLayers";
import { labelAngle } from "./plantGeometry";
import { PLANT_AREA_KIND_LABELS, type LayoutComponent, type PlantLayout, type PlantLayoutItem } from "@/types/plant";

// =============================================================================
// The files a published layout leaves in the Plant Layout Files library, for
// Power BI and anything else that reads the plant (Phase 3). Pure.
//
//   published/<layoutKey>-v<n>.svg        the composite: walls + areas + every
//                                         item, each symbol INLINED
//   published/<layoutKey>-v<n>-tags.csv   one row per item and area
//   published/<layoutKey>.svg / -tags.csv the CURRENT published version —
//                                         overwritten on each publish, so a
//                                         Power BI report keeps one address
//
// Five things that are load-bearing:
//
//   * Every symbol is INLINED as a nested <svg>, never <defs> + <use>: ARC's
//     own sanitiser strips <use>, and a Power BI visual colouring an element
//     by id needs the shapes inside it. Main Plant comes to about 1.2 MB.
//   * The element id of an item or area IS its TagId in the CSV (`tagIdFor`),
//     so the two join. Ids inside the walls drawing and inside each symbol
//     are PREFIXED (and their url(#…) references rewritten) so nothing in the
//     file clashes with a tag.
//   * The file freezes what the layout looked like when it was published: a
//     symbol replaced later is a new row, and the items keep the row they
//     were drawn with.
//   * Layers are <g id="layer-…"> groups, and a layer that starts hidden in
//     ARC is display="none" here too — same picture, one attribute to change.
//   * Numbers are inches, rounded to 2 decimals; the CSV is UTF-8 with a BOM
//     (Excel), RFC 4180 quoting and CRLF lines.
// =============================================================================

const SVG_NS = "http://www.w3.org/2000/svg";

/** What the CSV needs from the CMMS Equipment List, by item id. */
export interface PublishAsset {
  name: string;
  assetTag: string;
}

/** The file names for one version of a layout, all under `published/`. */
export interface PublishedFileNames {
  svg: string;
  csv: string;
  currentSvg: string;
  currentCsv: string;
}

export function publishedFileNames(layout: Pick<PlantLayout, "id" | "layoutKey" | "version">): PublishedFileNames {
  const base =
    layout.layoutKey
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || `layout-${layout.id}`;
  return {
    svg: `${base}-v${layout.version}.svg`,
    csv: `${base}-v${layout.version}-tags.csv`,
    currentSvg: `${base}.svg`,
    currentCsv: `${base}-tags.csv`,
  };
}

/**
 * A layout uid as an XML id and a TagId. ARC's own uids ("i_7f3a", "a_d001")
 * and the CAD extract's ("item-12") are already valid; anything else is made
 * valid the same way every time, so the SVG and the CSV always agree.
 */
export function tagIdFor(uid: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(uid)) return uid;
  return `t-${uid.replace(/[^A-Za-z0-9_.-]+/g, "-")}`;
}

function idPart(key: string): string {
  return key.replace(/[^A-Za-z0-9_.-]+/g, "-") || "x";
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function parse(clean: string): Element | null {
  if (!clean) return null;
  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length > 0) return null;
  return root;
}

/**
 * Give every id under `root` a prefix, and point every `url(#…)` at the new
 * name — so two copies of one symbol, or a symbol and the walls drawing, can
 * sit in one file. (href is stripped by the sanitiser, so url() is the only
 * kind of reference left.)
 */
function prefixIds(root: Element, prefix: string): void {
  const all = [root, ...Array.from(root.getElementsByTagName("*"))];
  const renamed = new Map<string, string>();
  for (const el of all) {
    const id = el.getAttribute("id");
    if (!id) continue;
    const next = `${prefix}${id}`;
    renamed.set(id, next);
    el.setAttribute("id", next);
  }
  if (renamed.size === 0) return;
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (!attr.value.includes("url(#")) continue;
      el.setAttribute(
        attr.name,
        attr.value.replace(/url\(#([^)]+)\)/g, (whole, id: string) => {
          const to = renamed.get(id);
          return to ? `url(#${to})` : whole;
        }),
      );
    }
  }
}

const AREA_STYLE = {
  aisle: { fill: "#3b82f6", stroke: "#2563eb", opacity: "0.14" },
  "no-go": { fill: "#ef4444", stroke: "#dc2626", opacity: "0.18" },
} as const;

export interface CompositeInput {
  layout: PlantLayout;
  /** The walls drawing, sanitised (WallsDrawing.svg) — null draws a blank plan. */
  wallsSvg: string | null;
  /** The drawing's size wins over the stored one, as on screen. */
  extent: { w: number; h: number };
  components: ReadonlyMap<number, LayoutComponent>;
  assets: ReadonlyMap<number, PublishAsset>;
  publishedAt: Date;
}

/** The composite SVG: one file drawing the whole published layout. */
export function buildCompositeSvg(input: CompositeInput): string {
  const { layout, extent, components, assets } = input;
  const doc = document.implementation.createDocument(SVG_NS, "svg", null);
  const root = doc.documentElement;
  const el = (name: string, attrs: Record<string, string | number> = {}): Element => {
    const e = doc.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  const titled = (parent: Element, text: string) => {
    if (!text) return;
    const t = el("title");
    t.textContent = text;
    parent.appendChild(t);
  };

  root.setAttribute("viewBox", `0 0 ${extent.w} ${extent.h}`);
  root.setAttribute("data-units", "in");
  root.setAttribute("data-building", layout.building);
  root.setAttribute("data-layout", layout.title);
  root.setAttribute("data-layout-key", layout.layoutKey);
  root.setAttribute("data-version", String(layout.version));
  root.setAttribute("data-published", input.publishedAt.toISOString());
  titled(root, `${layout.building === layout.title ? layout.title : `${layout.building} — ${layout.title}`} v${layout.version}`);
  root.appendChild(el("rect", { id: "background", x: 0, y: 0, width: extent.w, height: extent.h, fill: "#ffffff" }));

  // The building — the walls drawing as it was stored, ids prefixed.
  const walls = el("g", { id: "building" });
  const wallsRoot = parse(input.wallsSvg ?? "");
  if (wallsRoot) {
    prefixIds(wallsRoot, "walls--");
    const nested = doc.importNode(wallsRoot, true) as Element;
    nested.removeAttribute("id");
    for (const a of ["x", "y"]) nested.setAttribute(a, "0");
    nested.setAttribute("width", String(extent.w));
    nested.setAttribute("height", String(extent.h));
    nested.setAttribute("preserveAspectRatio", "none");
    walls.appendChild(nested);
  }
  root.appendChild(walls);

  // Aisles and no-go areas, under the items, as on screen.
  const areas = el("g", { id: "areas" });
  for (const a of layout.doc.areas ?? []) {
    const style = AREA_STYLE[a.kind] ?? AREA_STYLE["no-go"];
    const g = el("g", {
      id: tagIdFor(a.uid),
      class: "plant-area",
      "data-kind": a.kind,
      "data-label": a.label,
      transform: `translate(${round(a.x)} ${round(a.y)}) rotate(${round(a.rot)})`,
    });
    titled(g, a.label || PLANT_AREA_KIND_LABELS[a.kind] || "Area");
    g.appendChild(
      el("rect", {
        x: round(-a.w / 2),
        y: round(-a.d / 2),
        width: round(a.w),
        height: round(a.d),
        fill: style.fill,
        "fill-opacity": style.opacity,
        stroke: style.stroke,
        "stroke-width": 2,
        "stroke-dasharray": a.kind === "aisle" ? "12 8" : "none",
      }),
    );
    areas.appendChild(g);
  }
  root.appendChild(areas);

  // Every item, in its layer. Symbols parsed once, cloned per item.
  const symbolRoots = new Map<number, Element | null>();
  const symbolFor = (cid: number): Element | null => {
    if (!symbolRoots.has(cid)) symbolRoots.set(cid, parse(sanitiseSvg(components.get(cid)?.svgMarkup)));
    return symbolRoots.get(cid) ?? null;
  };
  const drawItem = (it: PlantLayoutItem): Element => {
    const component = components.get(it.componentId);
    const asset = it.equipmentId !== null ? assets.get(it.equipmentId) : undefined;
    const tagId = tagIdFor(it.uid);
    const attrs: Record<string, string | number> = {
      id: tagId,
      class: "plant-item",
      "data-label": it.label,
      "data-symbol": component?.key ?? "",
      transform: `translate(${round(it.x)} ${round(it.y)}) rotate(${round(it.rot)})`,
    };
    if (it.equipmentId !== null) attrs["data-equipment-id"] = it.equipmentId;
    if (asset?.assetTag) attrs["data-asset-tag"] = asset.assetTag;
    const g = el("g", attrs);
    titled(g, it.label || component?.title || "Item");
    const hx = round(-it.w / 2);
    const hy = round(-it.d / 2);
    const symbol = symbolFor(it.componentId);
    if (symbol) {
      const nested = doc.importNode(symbol, true) as Element;
      prefixIds(nested, `${tagId}--`);
      nested.removeAttribute("id");
      nested.setAttribute("x", String(hx));
      nested.setAttribute("y", String(hy));
      nested.setAttribute("width", String(round(it.w)));
      nested.setAttribute("height", String(round(it.d)));
      nested.setAttribute("preserveAspectRatio", "none");
      g.appendChild(nested);
    } else {
      // A symbol that's gone or unreadable: the outline ARC draws for it.
      g.appendChild(
        el("rect", {
          x: hx,
          y: hy,
          width: round(it.w),
          height: round(it.d),
          fill: "#f3f4f6",
          stroke: "#6b7280",
          "stroke-width": 1.5,
          "stroke-dasharray": "6 4",
        }),
      );
    }
    return g;
  };

  const items = layout.doc.items;
  const base = el("g", { id: "layer-base", "data-title": "Base plan" });
  for (const it of items) if (!it.layer) base.appendChild(drawItem(it));
  root.appendChild(base);
  for (const layer of layoutLayers(layout.doc)) {
    const g = el("g", { id: `layer-${idPart(layer.key)}`, "data-title": layer.title });
    if (layer.hiddenByDefault) g.setAttribute("display", "none");
    const onLayer = items.filter((it) => it.layer === layer.key);
    for (const it of onLayer.filter((i) => !i.group)) g.appendChild(drawItem(it));
    for (const group of layer.groups) {
      const inGroup = onLayer.filter((i) => i.group === group.key);
      if (inGroup.length === 0) continue;
      const gg = el("g", { id: `layer-${idPart(layer.key)}--${idPart(group.key)}`, "data-title": group.title });
      for (const it of inGroup) gg.appendChild(drawItem(it));
      g.appendChild(gg);
    }
    root.appendChild(g);
  }

  // Area labels on top, along their long side, as on screen.
  const labels = el("g", { id: "labels", "font-family": "Arial, sans-serif", "text-anchor": "middle" });
  for (const a of layout.doc.areas ?? []) {
    if (!a.label) continue;
    const t = el("text", {
      x: round(a.x),
      y: round(a.y),
      "font-size": round(Math.max(6, Math.min(24, Math.min(a.w, a.d) * 0.5))),
      "dominant-baseline": "central",
      fill: "#374151",
      transform: `rotate(${round(labelAngle(a))} ${round(a.x)} ${round(a.y)})`,
    });
    t.textContent = a.label;
    labels.appendChild(t);
  }
  root.appendChild(labels);

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(root)}`;
}

/** The columns of the tags CSV, in order. */
export const TAG_CSV_COLUMNS = [
  "TagId",
  "TagType",
  "Building",
  "Layout",
  "LayoutKey",
  "Version",
  "LayoutId",
  "Layer",
  "Group",
  "Label",
  "Symbol",
  "SymbolKey",
  "Category",
  "EquipmentId",
  "AssetTag",
  "AssetName",
  "CenterX",
  "CenterY",
  "Width",
  "Depth",
  "Rotation",
  "Units",
] as const;

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface TagsCsvInput {
  layout: PlantLayout;
  components: ReadonlyMap<number, LayoutComponent>;
  assets: ReadonlyMap<number, PublishAsset>;
}

/** One row per placed item, then one per area — the table Power BI reads. */
export function buildTagsCsv({ layout, components, assets }: TagsCsvInput): string {
  const layers = layoutLayers(layout.doc);
  const common = [layout.building, layout.title, layout.layoutKey, layout.version, layout.id];
  const rows: (string | number | null)[][] = [];
  for (const it of layout.doc.items) {
    const c = components.get(it.componentId);
    const layer = it.layer ? layers.find((l) => l.key === it.layer) : undefined;
    const group = it.group && layer ? layer.groups.find((g) => g.key === it.group) : undefined;
    const asset = it.equipmentId !== null ? assets.get(it.equipmentId) : undefined;
    rows.push([
      tagIdFor(it.uid),
      "Item",
      ...common,
      layer?.title ?? "",
      it.layer ? (group?.title ?? it.group ?? "") : "",
      it.label,
      c?.title ?? "",
      c?.key ?? "",
      c?.category ?? "",
      it.equipmentId,
      asset?.assetTag ?? "",
      asset?.name ?? "",
      round(it.x),
      round(it.y),
      round(it.w),
      round(it.d),
      round(it.rot),
      "in",
    ]);
  }
  for (const a of layout.doc.areas ?? []) {
    rows.push([
      tagIdFor(a.uid),
      "Area",
      ...common,
      "",
      "",
      a.label,
      "",
      "",
      PLANT_AREA_KIND_LABELS[a.kind] ?? a.kind,
      null,
      "",
      "",
      round(a.x),
      round(a.y),
      round(a.w),
      round(a.d),
      round(a.rot),
      "in",
    ]);
  }
  const lines = [TAG_CSV_COLUMNS.join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
