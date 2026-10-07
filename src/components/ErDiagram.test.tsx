import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErDiagram } from "./ErDiagram";
import type { ErConnection, ErGroup, ErTable } from "@/lib/erLayout";

const col = (name: string, kind: "pk" | "fk" | "field" = "field") => ({ name, type: "int", kind });

const TABLES: ErTable[] = [
  { name: "Person", source: "people", palette: "shared", group: "core", width: 200, columns: [col("id", "pk")] },
  { name: "Task", source: "tasks", palette: "entity", group: "eng", width: 220, columns: [col("id", "pk"), col("projectId", "fk"), col("assigned", "fk")] },
  { name: "Project", source: "projects", palette: "entity", group: "eng", width: 200, columns: [col("id", "pk")] },
  { name: "Lonely", source: "nothing", palette: "entity", group: "eng", width: 200, columns: [col("id", "pk")] },
];
const GROUPS: ErGroup[] = [
  { id: "eng", label: "Engineering" },
  { id: "core", label: "Shared" },
];
const CONNECTIONS: ErConnection[] = [
  { fromTable: "Task", fromColumn: "projectId", toTable: "Project", toColumn: "id", fromCard: "many", toCard: "one" },
  { fromTable: "Task", fromColumn: "assigned", toTable: "Person", toColumn: "id", fromCard: "many", toCard: "many" },
];

function setup() {
  const user = userEvent.setup();
  render(<ErDiagram tables={TABLES} groups={GROUPS} connections={CONNECTIONS} hubTables={["Person"]} />);
  const viewport = screen.getByRole("group", { name: /data model diagram/i });
  const svg = screen.getByRole("img", { name: /entity-relationship diagram/i });
  const paths = () => svg.querySelectorAll("path[marker-end]");
  const zoomLabel = () => screen.getByRole("button", { name: "Actual size" }).textContent;
  const tableEl = (name: string) => svg.querySelector(`[data-er-table="${name}"]`)!;
  return { user, viewport, svg, paths, zoomLabel, tableEl };
}

describe("ErDiagram", () => {
  it("draws every table and group", () => {
    const { tableEl } = setup();
    for (const t of TABLES) expect(tableEl(t.name)).toBeTruthy();
    expect(screen.getByText("ENGINEERING")).toBeInTheDocument();
    expect(screen.getByText("SHARED")).toBeInTheDocument();
  });

  it("zooms in and out with the buttons", async () => {
    const { user, zoomLabel } = setup();
    const before = parseInt(zoomLabel()!, 10);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(parseInt(zoomLabel()!, 10)).toBeGreaterThan(before);
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(parseInt(zoomLabel()!, 10)).toBeLessThan(before);
    await user.click(screen.getByRole("button", { name: "Actual size" }));
    expect(zoomLabel()).toBe("100%");
  });

  it("zooms from the keyboard", () => {
    const { viewport, zoomLabel } = setup();
    fireEvent.keyDown(viewport, { key: "0" });
    const fitted = parseInt(zoomLabel()!, 10);
    fireEvent.keyDown(viewport, { key: "+" });
    expect(parseInt(zoomLabel()!, 10)).toBeGreaterThan(fitted);
  });

  it("hides links to a hub table until they're switched on", async () => {
    const { user, paths } = setup();
    expect(paths()).toHaveLength(1); // Task → Project only
    await user.click(screen.getByRole("checkbox", { name: /show every link to person/i }));
    expect(paths()).toHaveLength(2);
  });

  it("tapping a table traces its links (hub ones included) and fades the rest", () => {
    const { viewport, tableEl, paths } = setup();
    const tap = (target: Element) => {
      fireEvent.pointerDown(target, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 10, clientY: 10 });
    };

    tap(tableEl("Task"));
    expect(paths()).toHaveLength(2);
    expect(tableEl("Lonely").getAttribute("opacity")).toBe("0.3");
    expect(tableEl("Project").getAttribute("opacity")).toBe("1");
    expect(screen.getByRole("button", { name: /showing task/i })).toBeInTheDocument();

    // Tapping the background clears it.
    tap(viewport);
    expect(paths()).toHaveLength(1);
    expect(tableEl("Lonely").getAttribute("opacity")).toBe("1");
  });

  it("a drag pans instead of selecting", () => {
    const { viewport, svg, tableEl } = setup();
    const g = () => svg.querySelector("g[transform]")!.getAttribute("transform");
    const before = g();
    fireEvent.pointerDown(tableEl("Task"), { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 80, clientY: 60 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 80, clientY: 60 });
    expect(g()).not.toBe(before);
    expect(screen.queryByRole("button", { name: /showing task/i })).not.toBeInTheDocument();
  });

  it("Ctrl + scroll zooms, a plain scroll is left to the page", () => {
    const { viewport, zoomLabel } = setup();
    const before = zoomLabel();
    const plain = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    act(() => {
      viewport.dispatchEvent(plain);
    });
    expect(plain.defaultPrevented).toBe(false);
    expect(zoomLabel()).toBe(before);

    const ctrl = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      viewport.dispatchEvent(ctrl);
    });
    expect(ctrl.defaultPrevented).toBe(true);
    expect(zoomLabel()).not.toBe(before);
  });

  it("opens full screen, and Escape closes only that", async () => {
    const { user, viewport } = setup();
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();

    let reachedParent = false;
    document.addEventListener("keydown", () => (reachedParent = true), { once: true });
    fireEvent.keyDown(viewport, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Full screen" })).toBeInTheDocument();
    expect(reachedParent).toBe(false);
  });
});
