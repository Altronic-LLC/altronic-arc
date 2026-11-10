import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MOCK_LAYOUT_COMPONENTS } from "@/data/plantMockData";
import type { PlantLayoutItem } from "@/types/plant";
import { snap } from "@/lib/plantEditor";
import { PlantCanvas } from "./PlantCanvas";

// The canvas in jsdom: there is no layout, so the box measures 0 and the
// canvas keeps its default 800 × 500 window — which makes the screen → inches
// scale a known number the drags below can be checked against.

const EXTENT = { w: 2880, h: 1680 };
const SCALE = Math.min(800 / EXTENT.w, 500 / EXTENT.h) * 0.95;
const components = new Map(MOCK_LAYOUT_COMPONENTS.map((c) => [c.id, c]));
const mill = MOCK_LAYOUT_COMPONENTS.find((c) => c.key === "cnc-vmc-120x96")!;
const rack = MOCK_LAYOUT_COMPONENTS.find((c) => c.key === "pallet-rack-96x42")!;

const item = (uid: string, extra: Partial<PlantLayoutItem> = {}): PlantLayoutItem => ({
  uid,
  componentId: mill.id,
  componentVersion: 1,
  x: 450,
  y: 770,
  w: 120,
  d: 96,
  rot: 0,
  label: uid,
  equipmentId: null,
  locked: false,
  ...extra,
});

function setup(items: PlantLayoutItem[], opts: { editing?: boolean; selected?: string | null } = {}) {
  const onCommit = vi.fn();
  const onSelect = vi.fn();
  const onPreview = vi.fn();
  const utils = render(
    <PlantCanvas
      title="Test plan"
      extent={EXTENT}
      wallsSvg={null}
      items={items}
      components={components}
      selectedUid={opts.selected ?? null}
      onSelect={onSelect}
      editing={opts.editing ? { grid: 6, onCommit, onPreview } : undefined}
    />,
  );
  const g = (uid: string) => utils.container.querySelector(`[data-uid="${uid}"]`)!;
  return { ...utils, onCommit, onSelect, onPreview, g };
}

describe("PlantCanvas", () => {
  it("turns an item's label with it, along its long side, never upside down", () => {
    // Selected items always show their label, whatever the zoom.
    const { container, rerender } = setup([item("a", { rot: 270 })], { selected: "a" });
    const label = () => container.querySelector('[data-label-for="a"]')!;
    expect(label().getAttribute("transform")).toBe("rotate(-90 450 770)");
    rerender(
      <PlantCanvas
        title="Test plan"
        extent={EXTENT}
        wallsSvg={null}
        items={[item("a", { rot: 180 })]}
        components={components}
        selectedUid="a"
        onSelect={vi.fn()}
      />,
    );
    expect(label().getAttribute("transform")).toBe("rotate(0 450 770)");
  });

  it("selects an item on press, and has no handles when only viewing", () => {
    const { g, onSelect, onCommit, container } = setup([item("a")], { selected: "a" });
    fireEvent.pointerDown(g("a"), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(screen.getByRole("img", { name: "Test plan" }), { clientX: 300, clientY: 100 });
    fireEvent.pointerUp(screen.getByRole("img", { name: "Test plan" }), { clientX: 300, clientY: 100 });
    expect(onSelect).toHaveBeenCalledWith("a");
    expect(onCommit).not.toHaveBeenCalled();
    expect(container.querySelector("[data-handle]")).toBeNull();
  });

  it("moves an item by a drag — snapped, committed ONCE on release", () => {
    const { g, onCommit, onPreview } = setup([item("a")], { editing: true, selected: "a" });
    const svg = screen.getByRole("img", { name: "Test plan" });
    fireEvent.pointerDown(g("a"), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 150, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 200, clientY: 120 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenLastCalledWith({
      uid: "a",
      patch: { x: snap(450 + 100 / SCALE, 6), y: snap(770 + 20 / SCALE, 6) },
    });
    fireEvent.pointerUp(svg, { clientX: 200, clientY: 120 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("a", { x: snap(450 + 100 / SCALE, 6), y: snap(770 + 20 / SCALE, 6) });
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it("lines a dragged item up with its neighbour, draws dotted guides, and clears them on release", () => {
    // a's row is y = 770. Drag b down to about 780 — within 8 screen px (~30 in) of it.
    const { g, onPreview, onCommit, container } = setup([item("a"), item("b", { x: 900, y: 500 })], { editing: true, selected: "b" });
    const svg = screen.getByRole("img", { name: "Test plan" });
    fireEvent.pointerDown(g("b"), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 100, clientY: 100 + 280 * SCALE });
    expect(onPreview).toHaveBeenLastCalledWith({ uid: "b", patch: { x: 900, y: 770 } });
    // Same depth, so top, centre and bottom all line up — three horizontal guides, no vertical one.
    const guides = [...container.querySelectorAll('[data-layer="guides"] line')];
    expect(guides.map((l) => l.getAttribute("data-guide-axis"))).toEqual(["y", "y", "y"]);
    expect(guides.map((l) => Number(l.getAttribute("y1")))).toEqual([722, 770, 818]);
    expect(guides[0].getAttribute("stroke-dasharray")).toBeTruthy();

    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 + 280 * SCALE });
    expect(onCommit).toHaveBeenCalledWith("b", { x: 900, y: 770 });
    expect(container.querySelector('[data-layer="guides"]')).toBeNull();
  });

  it("doesn't line up while Alt is held", () => {
    const { g, onPreview, container } = setup([item("a"), item("b", { x: 900, y: 500 })], { editing: true, selected: "b" });
    const svg = screen.getByRole("img", { name: "Test plan" });
    fireEvent.pointerDown(g("b"), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 100, clientY: 100 + 280 * SCALE, altKey: true });
    expect(onPreview).toHaveBeenLastCalledWith({ uid: "b", patch: { x: 900, y: Math.round(500 + 280) } });
    expect(container.querySelector('[data-layer="guides"]')).toBeNull();
  });

  it("places freely while Alt is held", () => {
    const { g, onCommit } = setup([item("a")], { editing: true });
    const svg = screen.getByRole("img", { name: "Test plan" });
    fireEvent.pointerDown(g("a"), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 137, clientY: 100, altKey: true });
    fireEvent.pointerUp(svg, { clientX: 137, clientY: 100 });
    // Off the grid, but still to the whole inch.
    expect(onCommit).toHaveBeenCalledWith("a", { x: Math.round(450 + 37 / SCALE), y: 770 });
    expect(Math.round(450 + 37 / SCALE) % 6).not.toBe(0);
  });

  it("treats a press that barely moves as a click, not a move", () => {
    const { g, onCommit } = setup([item("a")], { editing: true });
    const svg = screen.getByRole("img", { name: "Test plan" });
    fireEvent.pointerDown(g("a"), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 101, clientY: 101 });
    fireEvent.pointerUp(svg, { clientX: 101, clientY: 101 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("won't move a locked item, and gives it no handles", () => {
    const { g, onCommit, container } = setup([item("a", { locked: true })], { editing: true, selected: "a" });
    const svg = screen.getByRole("img", { name: "Test plan" });
    fireEvent.pointerDown(g("a"), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 100 });
    fireEvent.pointerUp(svg, { clientX: 300, clientY: 100 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(container.querySelector("[data-handle]")).toBeNull();
  });

  it("turns an item in 15° steps with the round handle", () => {
    const { container, onCommit } = setup([item("a")], { editing: true, selected: "a" });
    const svg = screen.getByRole("img", { name: "Test plan" });
    // The plan point straight to the item's right, as a screen point (the view starts fitted).
    const view = svg.getAttribute("viewBox")!.split(" ").map(Number);
    const toClient = (x: number, y: number) => ({ clientX: (x - view[0]) * SCALE, clientY: (y - view[1]) * SCALE });
    fireEvent.pointerDown(container.querySelector('[data-handle="rotate"]')!, { button: 0, ...toClient(450, 600) });
    fireEvent.pointerMove(svg, toClient(450 + 300, 770 + 10));
    fireEvent.pointerUp(svg, toClient(450 + 300, 770 + 10));
    expect(onCommit).toHaveBeenCalledWith("a", { rot: 90 });
  });

  it("offers resize corners only on a symbol that may be resized", () => {
    expect(setup([item("a")], { editing: true, selected: "a" }).container.querySelectorAll('[data-handle="resize"]')).toHaveLength(0);
    const rackItem = item("r", { componentId: rack.id, w: 96, d: 42 });
    expect(setup([rackItem], { editing: true, selected: "r" }).container.querySelectorAll('[data-handle="resize"]')).toHaveLength(4);
  });

  it("pans the view when empty floor is dragged, and deselects", () => {
    const { onSelect } = setup([item("a")], { editing: true });
    const svg = screen.getByRole("img", { name: "Test plan" });
    const before = svg.getAttribute("viewBox");
    fireEvent.pointerDown(svg, { button: 0, clientX: 400, clientY: 250 });
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 250 });
    fireEvent.pointerUp(svg, { clientX: 300, clientY: 250 });
    expect(onSelect).toHaveBeenCalledWith(null);
    const [x0] = before!.split(" ").map(Number);
    const [x1] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(x1 - x0).toBeCloseTo(100 / SCALE);
  });

  it("zooms with a plain mouse wheel, keeping the point under the pointer still", () => {
    setup([item("a")]);
    const svg = screen.getByRole("img", { name: "Test plan" });
    const box = () => svg.getAttribute("viewBox")!.split(" ").map(Number);
    const [x0, y0, w0] = box();
    // The plan point under (200, 100) before…
    const before = { x: x0 + 200 * (w0 / 800), y: y0 + 100 * (w0 / 800) };
    fireEvent.wheel(svg, { deltaY: -100, clientX: 200, clientY: 100 });
    const [x1, y1, w1] = box();
    expect(w1).toBeLessThan(w0);
    // …is still under it after.
    expect(x1 + 200 * (w1 / 800)).toBeCloseTo(before.x);
    expect(y1 + 100 * (w1 / 800)).toBeCloseTo(before.y);
    fireEvent.wheel(svg, { deltaY: 300, clientX: 200, clientY: 100 });
    expect(box()[2]).toBeGreaterThan(w1);
  });

  it("leaves the wheel to the page when wheelZoom is off — the New layout review scrolls instead", () => {
    render(
      <PlantCanvas title="Preview" extent={EXTENT} wallsSvg={null} items={[]} components={components} wheelZoom={false} />,
    );
    const svg = screen.getByRole("img", { name: "Preview" });
    const before = svg.getAttribute("viewBox");
    // Not cancelled, so the dialog behind it scrolls.
    expect(fireEvent.wheel(svg, { deltaY: -100, clientX: 200, clientY: 100 })).toBe(true);
    expect(svg.getAttribute("viewBox")).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(svg.getAttribute("viewBox")).not.toBe(before);
  });

  it("pans with a middle-button drag, even starting on an item, and never moves it", () => {
    const { g, onCommit, onSelect } = setup([item("a")], { editing: true });
    const svg = screen.getByRole("img", { name: "Test plan" });
    const [x0] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    fireEvent.pointerDown(g("a"), { button: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { clientX: 40, clientY: 100 });
    fireEvent.pointerUp(svg, { clientX: 40, clientY: 100 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    const [x1] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(x1 - x0).toBeCloseTo(60 / SCALE);
  });

  it("zooms in and back to fit from the buttons", () => {
    setup([item("a")]);
    const svg = screen.getByRole("img", { name: "Test plan" });
    const width = () => Number(svg.getAttribute("viewBox")!.split(" ")[2]);
    const fitted = width();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(width()).toBeCloseTo(fitted / 1.25);
    fireEvent.click(screen.getByRole("button", { name: "Fit to window" }));
    expect(width()).toBeCloseTo(fitted);
  });
});
