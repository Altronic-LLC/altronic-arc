import { describe, expect, it } from "vitest";
import {
  TAG_CSV_COLUMNS,
  buildCompositeSvg,
  buildTagsCsv,
  publishedFileNames,
  tagIdFor,
  type PublishAsset,
} from "./plantPublishFiles";
import type { LayoutComponent, PlantLayout, PlantLayoutItem } from "@/types/plant";

const BENCH: LayoutComponent = {
  id: 7,
  title: "Bench, 6 ft",
  key: "bench-72x30",
  category: "Bench",
  svgMarkup:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 30"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>' +
    '<rect id="top" width="72" height="30" fill="url(#g)"/><script>alert(1)</script></svg>',
  footprintW: 72,
  footprintD: 30,
  allowResize: true,
  allowRotate: true,
  minScale: 0.5,
  maxScale: 2,
  collides: true,
  clearance: 0,
  collisionPolygon: null,
  version: 1,
  active: true,
};

function item(over: Partial<PlantLayoutItem>): PlantLayoutItem {
  return {
    uid: "i_1",
    componentId: 7,
    componentVersion: 1,
    x: 100,
    y: 50,
    w: 72,
    d: 30,
    rot: 0,
    label: "Bench 1",
    equipmentId: null,
    locked: false,
    ...over,
  };
}

const WALLS =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g id="walls"><rect id="w1" x="0" y="0" width="400" height="4"/></g></svg>';

const LAYOUT: PlantLayout = {
  id: 12,
  building: "Main Plant",
  title: "Machining",
  area: "",
  layoutKey: "machining-abc",
  status: "Published",
  version: 3,
  wallsFileId: "F1",
  doc: {
    schema: 1,
    units: "in",
    extent: { w: 400, h: 200 },
    items: [
      item({ uid: "i_1", label: "Bench 1", equipmentId: 214 }),
      item({ uid: "i_2", label: 'Bench "2", spare', x: 200.123 }),
      item({ uid: "item-9", label: "Extinguisher", layer: "safety", group: "fire", componentId: 99 }),
    ],
    areas: [{ uid: "a_1", kind: "aisle", x: 50, y: 150, w: 300, d: 40, rot: 0, label: "Main walkway", locked: false }],
    layers: [{ key: "safety", title: "Safety", hiddenByDefault: true, groups: [{ key: "fire", title: "Fire" }] }],
  },
  docCorrupt: false,
  supersedesId: 11,
  modifiedAt: null,
  modifiedBy: "",
};

const COMPONENTS = new Map([[7, BENCH]]);
const ASSETS = new Map<number, PublishAsset>([[214, { name: "Haas VF-2", assetTag: "EQ-0214" }]]);

function composite() {
  const svg = buildCompositeSvg({
    layout: LAYOUT,
    wallsSvg: WALLS,
    extent: { w: 400, h: 200 },
    components: COMPONENTS,
    assets: ASSETS,
    publishedAt: new Date("2026-11-13T15:00:00Z"),
  });
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  return { svg, doc, root: doc.documentElement };
}

describe("publishedFileNames", () => {
  it("names a version's files and the current copies from the layout key", () => {
    expect(publishedFileNames(LAYOUT)).toEqual({
      svg: "machining-abc-v3.svg",
      csv: "machining-abc-v3-tags.csv",
      currentSvg: "machining-abc.svg",
      currentCsv: "machining-abc-tags.csv",
    });
  });

  it("falls back to the row id when there is no key, and never lets a stray character through", () => {
    expect(publishedFileNames({ id: 4, layoutKey: "", version: 1 }).svg).toBe("layout-4-v1.svg");
    expect(publishedFileNames({ id: 4, layoutKey: "Main/Plant:1", version: 2 }).currentCsv).toBe("main-plant-1-tags.csv");
  });
});

describe("tagIdFor", () => {
  it("keeps ARC's and the CAD extract's uids as they are", () => {
    expect(tagIdFor("i_7f3a")).toBe("i_7f3a");
    expect(tagIdFor("item-12")).toBe("item-12");
  });

  it("makes anything else a valid XML id the same way every time", () => {
    expect(tagIdFor("12 a/b")).toBe("t-12-a-b");
    expect(tagIdFor("12 a/b")).toBe(tagIdFor("12 a/b"));
  });
});

describe("buildCompositeSvg", () => {
  it("is a well-formed SVG in inches that names the layout", () => {
    const { doc, root } = composite();
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(root.getAttribute("viewBox")).toBe("0 0 400 200");
    expect(root.getAttribute("data-units")).toBe("in");
    expect(root.getAttribute("data-version")).toBe("3");
    expect(root.getAttribute("data-layout-key")).toBe("machining-abc");
  });

  it("gives every item and area an element whose id is its TagId", () => {
    const { doc } = composite();
    for (const id of ["i_1", "i_2", "item-9", "a_1"]) expect(doc.getElementById(id)).not.toBeNull();
    const bench = doc.getElementById("i_1")!;
    expect(bench.getAttribute("transform")).toBe("translate(100 50) rotate(0)");
    expect(bench.getAttribute("data-equipment-id")).toBe("214");
    expect(bench.getAttribute("data-asset-tag")).toBe("EQ-0214");
  });

  it("inlines each symbol as a nested svg sized to the item, sanitised", () => {
    const { svg, doc } = composite();
    const nested = doc.getElementById("i_1")!.getElementsByTagName("svg")[0];
    expect(nested.getAttribute("width")).toBe("72");
    expect(nested.getAttribute("x")).toBe("-36");
    expect(nested.getAttribute("preserveAspectRatio")).toBe("none");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("<use");
  });

  it("prefixes the ids inside each copy of a symbol, and rewrites its url() references to match", () => {
    const { doc } = composite();
    expect(doc.getElementById("g")).toBeNull();
    const one = doc.getElementById("i_1--top")!;
    const two = doc.getElementById("i_2--top")!;
    expect(one.getAttribute("fill")).toBe("url(#i_1--g)");
    expect(two.getAttribute("fill")).toBe("url(#i_2--g)");
    expect(doc.getElementById("i_1--g")).not.toBeNull();
  });

  it("keeps the walls drawing, its ids prefixed so none can clash with a tag", () => {
    const { doc } = composite();
    expect(doc.getElementById("walls")).toBeNull();
    expect(doc.getElementById("walls--walls")).not.toBeNull();
    expect(doc.getElementById("walls--w1")).not.toBeNull();
  });

  it("puts layered items in their layer and group, hidden if the layer starts hidden", () => {
    const { doc } = composite();
    const layer = doc.getElementById("layer-safety")!;
    expect(layer.getAttribute("display")).toBe("none");
    expect(doc.getElementById("layer-safety--fire")!.contains(doc.getElementById("item-9"))).toBe(true);
    expect(doc.getElementById("layer-base")!.contains(doc.getElementById("i_1"))).toBe(true);
  });

  it("draws an outline for an item whose symbol isn't in the library", () => {
    const { doc } = composite();
    const missing = doc.getElementById("item-9")!;
    expect(missing.getElementsByTagName("svg")).toHaveLength(0);
    expect(missing.getElementsByTagName("rect")).toHaveLength(1);
  });

  it("labels the areas", () => {
    const { doc } = composite();
    expect(doc.getElementById("labels")!.textContent).toContain("Main walkway");
  });

  it("draws a blank plan when there's no walls drawing", () => {
    const svg = buildCompositeSvg({
      layout: LAYOUT,
      wallsSvg: null,
      extent: { w: 400, h: 200 },
      components: COMPONENTS,
      assets: ASSETS,
      publishedAt: new Date(),
    });
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.getElementById("building")!.children).toHaveLength(0);
  });
});

describe("buildTagsCsv", () => {
  const csv = buildTagsCsv({ layout: LAYOUT, components: COMPONENTS, assets: ASSETS });
  const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");

  it("starts with a BOM and a header, and ends every line with CRLF", () => {
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe(TAG_CSV_COLUMNS.join(","));
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("has one row per item and per area, keyed by the same TagId as the SVG", () => {
    expect(lines).toHaveLength(1 + 3 + 1);
    expect(lines.slice(1).map((l) => l.split(",")[0])).toEqual(["i_1", "i_2", "item-9", "a_1"]);
  });

  it("joins an item to its asset and its symbol", () => {
    expect(lines[1]).toBe(
      "i_1,Item,Main Plant,Machining,machining-abc,3,12,,,Bench 1,\"Bench, 6 ft\",bench-72x30,Bench,214,EQ-0214,Haas VF-2,100,50,72,30,0,in",
    );
  });

  it("quotes a label with commas or quotes, and rounds positions to 2 decimals", () => {
    expect(lines[2]).toContain('"Bench ""2"", spare"');
    expect(lines[2]).toContain(",200.12,");
  });

  it("names an item's layer and group by their titles", () => {
    expect(lines[3]).toContain(",Safety,Fire,Extinguisher,");
  });

  it("writes an area as an Area row with its kind as the category", () => {
    expect(lines[4]).toBe("a_1,Area,Main Plant,Machining,machining-abc,3,12,,,Main walkway,,,Aisle,,,,50,150,300,40,0,in");
  });
});
