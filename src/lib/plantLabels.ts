import type { LayoutComponent, PlantLayoutItem, SymbolTextBox } from "@/types/plant";

// =============================================================================
// LABEL symbols — pure (2026-11-18). A symbol marked IsLabel (the CAD
// extract's area-label pill) has the item's own label written INSIDE it,
// fitted to its TextBox, as part of the drawing: it scales with the plan like
// the pill does, rather than being the fixed-size name ARC puts on other items.
// The canvas and the Power BI SVG both draw it from labelTextLayout, so the two
// can't place it differently.
// =============================================================================

/** The text area when a label symbol doesn't give one: its footprint, inset 8% each side. */
export function defaultTextBox(c: Pick<LayoutComponent, "footprintW" | "footprintD">): SymbolTextBox {
  return { x: c.footprintW * 0.08, y: c.footprintD * 0.08, w: c.footprintW * 0.84, h: c.footprintD * 0.84 };
}

/** A TextBox column's value — JSON `{x, y, w, h}`, or an object. Anything else (or no area) is null. */
export function parseTextBox(raw: unknown): SymbolTextBox | null {
  let v = raw;
  if (typeof v === "string") {
    if (!v.trim()) return null;
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : null);
  const [x, y, w, h] = [n("x"), n("y"), n("w"), n("h")];
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

export interface LabelText {
  text: string;
  /** The text's centre, in the ITEM's frame (its centre at 0,0, before its turn). */
  x: number;
  y: number;
  fontSize: number;
  /** 180 when the item is turned so the text would read upside down, else 0 — about (x, y). */
  flip: 0 | 180;
}

/** Roughly how wide a character of Arial is, as a share of the font size. */
const CHAR_WIDTH = 0.58;

/**
 * Where and how big an item's label is written inside its label symbol, or
 * null — not a label symbol, or no label. The text box is stretched with the
 * item (a resized pill keeps its text inside), and the font is the largest that
 * fits both its height and its width.
 */
export function labelTextLayout(
  item: Pick<PlantLayoutItem, "label" | "w" | "d" | "rot">,
  component: Pick<LayoutComponent, "isLabel" | "textBox" | "footprintW" | "footprintD"> | undefined,
): LabelText | null {
  const text = item.label.trim();
  if (!component?.isLabel || !text || !(component.footprintW > 0 && component.footprintD > 0)) return null;
  const box = component.textBox ?? defaultTextBox(component);
  const sx = item.w / component.footprintW;
  const sy = item.d / component.footprintD;
  const w = box.w * sx;
  const h = box.h * sy;
  const fontSize = Math.max(0.5, Math.min(h * 0.75, w / (CHAR_WIDTH * text.length)));
  const r = ((Math.round(item.rot) % 360) + 360) % 360;
  return {
    text,
    x: (box.x + box.w / 2) * sx - item.w / 2,
    y: (box.y + box.h / 2) * sy - item.d / 2,
    fontSize: Math.round(fontSize * 100) / 100,
    flip: r >= 90 && r < 270 ? 180 : 0,
  };
}
