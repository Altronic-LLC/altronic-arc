import { describe, expect, it } from "vitest";
import mainPlantWalls from "@/data/plantMock/walls-main-plant.svg?raw";
import panelPlantWalls from "@/data/plantMock/walls-panel-plant.svg?raw";
import engSalesWalls from "@/data/plantMock/walls-eng-sales.svg?raw";
import { MOCK_LAYOUT_COMPONENTS } from "@/data/plantMockData";
import { readWallsSvg, removeKeepouts, sanitiseSvg, svgDataUrl } from "./plantSvg";

describe("sanitiseSvg", () => {
  it("strips scripts, handlers, foreignObject, links and external references", () => {
    const out = sanitiseSvg(
      '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><rect width="1" height="1" onclick="x()"/>' +
        '<foreignObject><div>x</div></foreignObject><a href="javascript:alert(1)"><rect/></a>' +
        '<image href="https://example.com/x.png"/><use href="#r"/><style>rect{fill:red}</style></svg>',
    );
    expect(out).not.toMatch(/script|onload|onclick|foreignObject|javascript|href|<image|<use|<style/i);
    expect(out).toContain("<rect");
  });

  it("drops <metadata> with its contents, so a C2PA blob doesn't survive as text", () => {
    const out = sanitiseSvg('<svg viewBox="0 0 1 1"><metadata><c2pa:manifest>AAAABBBB</c2pa:manifest></metadata><rect/></svg>');
    expect(out).not.toContain("AAAABBBB");
    expect(out).not.toContain("metadata");
  });

  it("keeps ids and data- attributes the overlap check reads", () => {
    const out = sanitiseSvg('<svg viewBox="0 0 1 1"><g id="body"><rect id="keepout-1" data-kind="aisle"/></g></svg>');
    expect(out).toContain('id="body"');
    expect(out).toContain('data-kind="aisle"');
  });

  it("always hands back a namespaced root, and nothing for something that isn't an SVG", () => {
    expect(sanitiseSvg('<svg viewBox="0 0 1 1"><rect/></svg>')).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(sanitiseSvg("<div>hello</div>")).toBe("");
    expect(sanitiseSvg("")).toBe("");
    expect(sanitiseSvg(null)).toBe("");
  });

  it("keeps every seeded symbol drawable", () => {
    for (const c of MOCK_LAYOUT_COMPONENTS) {
      const out = sanitiseSvg(c.svgMarkup);
      expect(out, c.key).toMatch(/^<svg/);
      expect(out, c.key).toContain(`viewBox="0 0 ${c.footprintW} ${c.footprintD}"`);
    }
  });
});

describe("svgDataUrl", () => {
  it("percent-encodes a clean SVG", () => {
    const url = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#fff"/></svg>');
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(url).not.toContain("#");
    expect(decodeURIComponent(url.split(",")[1])).toContain('fill="#fff"');
  });
});

describe("readWallsSvg", () => {
  it("reads the three made-up plans: their size in inches, name and obstacles", () => {
    const main = readWallsSvg(mainPlantWalls);
    const panel = readWallsSvg(panelPlantWalls);
    const eng = readWallsSvg(engSalesWalls);
    if (!main.ok || !panel.ok || !eng.ok) throw new Error("a test plan didn't read");
    expect(main.drawing.extent).toEqual({ w: 2880, h: 1680 });
    expect(panel.drawing.extent).toEqual({ w: 1920, h: 1200 });
    expect(eng.drawing.extent).toEqual({ w: 1440, h: 960 });
    expect(main.drawing.building).toBe("Main Plant");
    const kinds = new Set(main.drawing.obstacles.map((o) => o.kind));
    expect(kinds).toEqual(new Set(["wall", "column", "keepout"]));
    // Only the door swings are keep-outs in the drawing; aisles, docks and
    // clearances are drawn on the layouts, where they can be edited.
    expect(new Set(main.drawing.obstacles.filter((o) => o.kind === "keepout").map((o) => o.detail))).toEqual(new Set(["door-swing"]));
    // The floor isn't an obstacle — it's the whole building.
    expect(main.drawing.obstacles.some((o) => o.id === "floor-area")).toBe(false);
  });

  it("counts the shapes in the obstacle groups it can't place", () => {
    const read = readWallsSvg(
      '<svg viewBox="0 0 100 100"><g id="walls"><rect width="10" height="2"/><rect width="10" height="2" transform="rotate(5)"/><polyline points="0,0 1,1"/></g><g id="labels"><path d="M0 0"/></g></svg>',
    );
    if (!read.ok) throw new Error(read.problem);
    expect(read.drawing.obstacles).toHaveLength(1);
    // The turned rect and the polyline — not the path outside the obstacle groups.
    expect(read.drawing.skipped).toBe(2);
  });

  it("refuses a file with no viewBox, an offset viewBox, or another unit", () => {
    expect(readWallsSvg('<svg><rect width="1" height="1"/></svg>')).toMatchObject({ ok: false, problem: expect.stringMatching(/no viewBox/) });
    expect(readWallsSvg('<svg viewBox="10 0 100 100"/>')).toMatchObject({ ok: false, problem: expect.stringMatching(/0 0/) });
    expect(readWallsSvg('<svg viewBox="0 0 100 100" data-units="mm"/>')).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/"mm".*inches/),
    });
  });

  it("refuses something that isn't an SVG, and an empty file", () => {
    expect(readWallsSvg("hello")).toMatchObject({ ok: false });
    expect(readWallsSvg("   ")).toMatchObject({ ok: false, problem: "That file is empty." });
  });

  it("takes inches as the default, and a drawing with no obstacle groups", () => {
    const r = readWallsSvg('<svg viewBox="0 0 100 50"><path d="M0 0H100"/></svg>');
    expect(r).toMatchObject({ ok: true, drawing: { extent: { w: 100, h: 50 }, obstacles: [], building: "" } });
  });

  it("skips a transformed rect rather than guessing where it is", () => {
    const r = readWallsSvg(
      '<svg viewBox="0 0 100 100"><g id="walls"><rect id="a" x="0" y="0" width="10" height="10"/>' +
        '<rect id="b" x="0" y="0" width="10" height="10" transform="rotate(45)"/></g></svg>',
    );
    if (!r.ok) throw new Error(r.problem);
    expect(r.drawing.obstacles.map((o) => o.id)).toEqual(["a"]);
  });
});

describe("removeKeepouts", () => {
  const svg = sanitiseSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="walls"><rect id="w" width="10" height="2"/></g><g id="keepout"><rect id="k1" data-kind="aisle" width="5" height="5"/><rect data-kind="dock" width="6" height="6"/><rect id="k3" width="7" height="7"/></g></svg>',
  );

  it("takes out the named keep-outs — an unnamed one by its place in the group — and nothing else", () => {
    const out = removeKeepouts(svg, new Set(["k1", "keepout-2"]));
    const read = readWallsSvg(out);
    if (!read.ok) throw new Error(read.problem);
    expect(read.drawing.obstacles.map((o) => o.id)).toEqual(["w", "k3"]);
    expect(read.drawing.extent).toEqual({ w: 100, h: 100 });
  });

  it("hands the drawing back unchanged when there's nothing to take out", () => {
    expect(removeKeepouts(svg, new Set())).toBe(svg);
    expect(removeKeepouts(svg, new Set(["nope"]))).toBe(svg);
    expect(removeKeepouts("<svg/>", new Set(["k1"]))).toBe("<svg/>");
  });
});
