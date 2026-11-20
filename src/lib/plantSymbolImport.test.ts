import { describe, expect, it } from "vitest";
import { MOCK_LAYOUT_COMPONENTS } from "@/data/plantMockData";
import {
  buildSymbolSvg,
  dxfToArt,
  inkFromRgba,
  proportionsDiffer,
  svgToArt,
  symbolKeyFor,
  traceInk,
  tracedArt,
  type SymbolArt,
} from "./plantSymbolImport";
import { sanitiseSvg } from "./plantSvg";

/** A DXF from pairs, the way CAD writes it: code line, value line. */
function dxf(header: [number, string | number][], entities: [number, string | number][], blocks: [number, string | number][] = []) {
  const section = (name: string, body: [number, string | number][]) => [[0, "SECTION"], [2, name], ...body, [0, "ENDSEC"]];
  return [...section("HEADER", header), ...section("BLOCKS", blocks), ...section("ENTITIES", entities), [0, "EOF"]]
    .map(([c, v]) => `  ${c}\n${v}`)
    .join("\n");
}

const art = (r: ReturnType<typeof svgToArt>): SymbolArt => {
  if (!r.ok) throw new Error(r.problem);
  return r.art;
};

describe("svgToArt", () => {
  it("takes a drawing in inches as it is, its size known", () => {
    const a = art(svgToArt(MOCK_LAYOUT_COMPONENTS[0].svgMarkup));
    expect(a.viewBox).toEqual({ x: 0, y: 0, w: 60, h: 30 });
    expect(a.sizeInches).toEqual({ w: 60, d: 30 });
    expect(a.body).toContain("<g id=\"body\">");
    expect(a.body).not.toContain("<title>");
    expect(a.body).not.toContain("xmlns");
  });

  it("reads a real size from width/height units, and asks for it when there are none", () => {
    expect(art(svgToArt('<svg width="4ft" height="24in" viewBox="0 0 400 200"><rect width="9" height="9"/></svg>')).sizeInches).toEqual({
      w: 48,
      d: 24,
    });
    const px = art(svgToArt('<svg width="400" height="200"><rect width="9" height="9"/></svg>'));
    expect(px.viewBox).toEqual({ x: 0, y: 0, w: 400, h: 200 });
    expect(px.sizeInches).toBeNull();
    expect(px.notes[0]).toMatch(/enter its real width and depth/);
  });

  it("sanitises — no script survives — and refuses what isn't a drawing", () => {
    const a = art(svgToArt('<svg viewBox="0 0 10 10"><script>alert(1)</script><rect width="9" height="9" onload="x()"/></svg>'));
    expect(a.body).not.toMatch(/script|onload/);
    expect(svgToArt("hello")).toMatchObject({ ok: false });
    expect(svgToArt('<svg><rect width="1" height="1"/></svg>')).toMatchObject({ ok: false, problem: expect.stringMatching(/no viewBox/) });
    expect(svgToArt('<svg viewBox="0 0 10 10"></svg>')).toMatchObject({ ok: false, problem: "That drawing is empty." });
  });
});

describe("dxfToArt", () => {
  it("draws lines, a closed polyline and a circle in inches, flipped so north is up", () => {
    const a = art(
      dxfToArt(
        dxf(
          [[9, "$INSUNITS"], [70, 1]],
          [
            [0, "LWPOLYLINE"], [90, 4], [70, 1],
            [10, 0], [20, 0], [10, 96], [20, 0], [10, 96], [20, 48], [10, 0], [20, 48],
            [0, "LINE"], [10, 0], [20, 0], [11, 96], [21, 48],
            [0, "CIRCLE"], [10, 48], [20, 24], [40, 10],
            [0, "TEXT"], [1, "label"],
          ],
        ),
      ),
    );
    expect(a.viewBox).toEqual({ x: 0, y: 0, w: 96, h: 48 });
    expect(a.sizeInches).toEqual({ w: 96, d: 48 });
    // The polyline's first corner, (0, 0) in CAD, is the BOTTOM-left on screen.
    expect(a.body).toContain('d="M0 48L96 48L96 0L0 0Z');
    expect(a.body).toMatch(/fill="none" stroke="#374151"/);
    expect(a.notes).toContain("Text, dimensions and hatching in the DXF are left out.");
  });

  it("converts millimetres and metres, and reads a DXF with no units as inches — saying so", () => {
    const box: [number, number][] = [[0, 0], [1219.2, 609.6]];
    const line = (pts: [number, number][]): [number, number | string][] => [
      [0, "LINE"], [10, pts[0][0]], [20, pts[0][1]], [11, pts[1][0]], [21, pts[1][1]],
    ];
    expect(art(dxfToArt(dxf([[9, "$INSUNITS"], [70, 4]], line(box)))).sizeInches).toEqual({ w: 48, d: 24 });
    expect(art(dxfToArt(dxf([[9, "$INSUNITS"], [70, 6]], line([[0, 0], [2, 1]])))).sizeInches).toEqual({ w: 78.7, d: 39.4 });
    const unitless = art(dxfToArt(dxf([], line([[0, 0], [30, 20]]))));
    expect(unitless.sizeInches).toEqual({ w: 30, d: 20 });
    expect(unitless.notes[0]).toMatch(/read it as inches/);
  });

  it("refuses a drawing so small it must be in other units", () => {
    expect(dxfToArt(dxf([[9, "$INSUNITS"], [70, 6]], [[0, "LINE"], [10, 0], [20, 0], [11, 0.001], [21, 0.001]]))).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/other units/),
    });
  });

  it("follows block inserts — moved, scaled and turned", () => {
    const a = art(
      dxfToArt(
        dxf(
          [[9, "$INSUNITS"], [70, 1]],
          [[0, "INSERT"], [2, "LEG"], [10, 100], [20, 0], [41, 2], [42, 2], [50, 90]],
          [[0, "BLOCK"], [2, "LEG"], [10, 0], [20, 0], [0, "LINE"], [10, 0], [20, 0], [11, 10], [21, 0], [0, "ENDBLK"]],
        ),
      ),
    );
    // A 10-long line along x, doubled and turned 90°: 20 long, running up from (100, 0).
    expect(a.sizeInches!.d).toBe(20);
    expect(a.viewBox.w).toBeLessThan(0.1);
  });

  it("draws arcs and bulged polyline corners through their curve", () => {
    const a = art(
      dxfToArt(
        dxf(
          [[9, "$INSUNITS"], [70, 1]],
          [
            // A half circle from (0,0) to (20,0) bulging DOWN (bulge 1 = 180° counter-clockwise).
            [0, "LWPOLYLINE"], [90, 2], [70, 0], [10, 0], [20, 0], [42, 1], [10, 20], [20, 0],
            [0, "ARC"], [10, 50], [20, 0], [40, 5], [50, 0], [51, 180],
          ],
        ),
      ),
    );
    // The half circle dips 10 below the chord; the arc rises 5 above.
    expect(a.sizeInches!.d).toBe(15);
  });

  it("refuses a binary DXF, a DWG, or a DXF with nothing drawable", () => {
    expect(dxfToArt("AutoCAD Binary DXF\r\n\u001a\u0000")).toMatchObject({ ok: false, problem: expect.stringMatching(/ASCII DXF/) });
    expect(dxfToArt(dxf([], [[0, "TEXT"], [1, "only words"]]))).toMatchObject({ ok: false, problem: expect.stringMatching(/no lines/) });
  });
});

describe("tracing a picture", () => {
  const rgba = (rows: string[]) => {
    const h = rows.length;
    const w = rows[0].length;
    const data = new Uint8ClampedArray(w * h * 4);
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        const v = ch === "#" ? 20 : 240;
        data.set([v, v, v, ch === " " ? 0 : 255], (y * w + x) * 4);
      }),
    );
    return { data, w, h };
  };

  it("finds the dark pixels, and inverts a light drawing on a dark background", () => {
    const dark = rgba(["....", ".##.", ".##.", "...."]);
    expect([...inkFromRgba(dark.data, 4, 4, 128)]).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    const light = rgba(["####", "#..#", "#..#", "####"]);
    expect([...inkFromRgba(light.data, 4, 4, 128)]).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    // Transparent pixels are never ink.
    expect([...inkFromRgba(rgba(["  ", "  "]).data, 2, 2, 255)]).toEqual([0, 0, 0, 0]);
  });

  it("traces ink as rectangles, stacking rows that repeat", () => {
    // An L: a 1-wide post 3 high, then a 3-wide foot.
    const ink = [1, 0, 0, 1, 0, 0, 1, 1, 1];
    expect(traceInk(ink, 3, 3)).toBe("M0 0h1v2h-1zM0 2h3v1h-3z");
    expect(traceInk([0, 0, 0, 0], 2, 2)).toBe("");
  });

  it("makes art of the trace, or says there's nothing to trace", () => {
    const a = tracedArt([1, 1, 1, 1], 2, 2);
    expect(a).toMatchObject({ ok: true, art: { viewBox: { x: 0, y: 0, w: 2, h: 2 }, sizeInches: null } });
    expect(tracedArt([0, 0], 2, 1)).toMatchObject({ ok: false, problem: expect.stringMatching(/threshold/) });
  });
});

describe("buildSymbolSvg", () => {
  const a = art(svgToArt('<svg viewBox="0 0 200 100"><rect width="200" height="100"/></svg>'));

  it("makes a library symbol: inches, the key, a title, the drawing fitted in, the front notch", () => {
    const svg = buildSymbolSvg(a, { title: "CNC Router <5ft>", key: "cnc-router-96x48", w: 96, d: 48, fit: "contain", frontMark: true });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 96 48" data-component="cnc-router-96x48" data-units="in">/);
    expect(svg).toContain("<title>CNC Router &lt;5ft&gt;</title>");
    expect(svg).toMatch(/<svg[^>]*viewBox="0 0 200 100"[^>]*preserveAspectRatio="xMidYMid meet"/);
    // The notch sits on the bottom (front) edge.
    expect(svg).toContain('<path d="M42.24 48L48 42.24L53.76 48Z"');
    // Already clean: sanitising again changes nothing that matters.
    expect(sanitiseSvg(svg)).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it("stretches to the footprint when asked, and leaves the notch off", () => {
    const svg = buildSymbolSvg(a, { title: "Zone", key: "zone-120x120", w: 120, d: 120, fit: "stretch", frontMark: false });
    expect(svg).toContain('preserveAspectRatio="none"');
    expect(svg).not.toMatch(/<path d="M\d/);
  });
});

describe("proportionsDiffer and symbolKeyFor", () => {
  it("flags a drawing whose shape doesn't match the footprint", () => {
    const a = art(svgToArt('<svg viewBox="0 0 200 100"><rect width="1" height="1"/></svg>'));
    expect(proportionsDiffer(a, 96, 48)).toBe(false);
    expect(proportionsDiffer(a, 48, 48)).toBe(true);
    expect(proportionsDiffer(a, 0, 48)).toBe(false);
  });

  it("slugs the name with the size, never twice, and avoids keys already taken", () => {
    expect(symbolKeyFor("CNC Router!", 96, 48, [])).toBe("cnc-router-96x48");
    expect(symbolKeyFor("Desk 60x30", 60, 30, [])).toBe("desk-60x30");
    expect(symbolKeyFor("Desk 60x30", 60, 30, ["desk-60x30", "DESK-60X30-2"])).toBe("desk-60x30-3");
    expect(symbolKeyFor("***", 10, 10, [])).toBe("symbol-10x10");
  });
});

describe("retitleSymbolSvg", () => {
  it("replaces the title, escaped, and treats a $ in the name as text", async () => {
    const { retitleSymbolSvg } = await import("./plantSymbolImport");
    expect(retitleSymbolSvg('<svg viewBox="0 0 1 1"><title>Old</title><g/></svg>', "Mill & $& co")).toBe(
      '<svg viewBox="0 0 1 1"><title>Mill &amp; $&amp; co</title><g/></svg>',
    );
  });

  it("adds one after the opening tag when the drawing has none", async () => {
    const { retitleSymbolSvg } = await import("./plantSymbolImport");
    expect(retitleSymbolSvg('<svg viewBox="0 0 1 1"><g/></svg>', "Desk")).toBe('<svg viewBox="0 0 1 1"><title>Desk</title><g/></svg>');
  });
});
