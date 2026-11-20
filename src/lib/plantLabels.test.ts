import { describe, expect, it } from "vitest";
import { defaultTextBox, labelTextLayout, parseTextBox } from "./plantLabels";

const PILL = { isLabel: true, textBox: { x: 8, y: 4, w: 80, h: 16 }, footprintW: 96, footprintD: 24 };
const item = (extra: Partial<{ label: string; w: number; d: number; rot: number }> = {}) => ({
  label: "Lab",
  w: 96,
  d: 24,
  rot: 0,
  ...extra,
});

describe("label symbols", () => {
  it("reads a TextBox from JSON or an object, and nothing else", () => {
    expect(parseTextBox('{"x":8,"y":4,"w":80,"h":16}')).toEqual({ x: 8, y: 4, w: 80, h: 16 });
    expect(parseTextBox({ x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(parseTextBox("")).toBeNull();
    expect(parseTextBox("{oops")).toBeNull();
    expect(parseTextBox({ x: 0, y: 0, w: 0, h: 1 })).toBeNull();
    expect(parseTextBox({ x: "1", y: 0, w: 1, h: 1 })).toBeNull();
  });

  it("insets the footprint when a label symbol gives no text box", () => {
    expect(defaultTextBox({ footprintW: 100, footprintD: 50 })).toEqual({ x: 8, y: 4, w: 84, h: 42 });
  });

  it("centres the text in the text box, as big as fits its height", () => {
    const t = labelTextLayout(item(), PILL)!;
    expect(t).toMatchObject({ text: "Lab", x: 0, y: 0, flip: 0 });
    expect(t.fontSize).toBe(12); // 16 tall × 0.75
  });

  it("shrinks a long name to fit the width", () => {
    const t = labelTextLayout(item({ label: "Engineering open office" }), PILL)!;
    expect(t.fontSize).toBeCloseTo(80 / (0.58 * 23), 1);
  });

  it("stretches the text box with a resized pill, and turns the text right way up", () => {
    const t = labelTextLayout(item({ w: 192, d: 48, rot: 180 }), PILL)!;
    expect(t.fontSize).toBe(24);
    expect(t.flip).toBe(180);
    expect(labelTextLayout(item({ rot: 90 }), PILL)!.flip).toBe(180);
    expect(labelTextLayout(item({ rot: 270 }), PILL)!.flip).toBe(0);
  });

  it("writes nothing for an ordinary symbol or a blank label", () => {
    expect(labelTextLayout(item(), { ...PILL, isLabel: false })).toBeNull();
    expect(labelTextLayout(item({ label: "  " }), PILL)).toBeNull();
    expect(labelTextLayout(item(), undefined)).toBeNull();
  });
});
