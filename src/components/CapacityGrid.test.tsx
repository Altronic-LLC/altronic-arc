import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { Person } from "@/types/task";
import type { CapacityChange, CapacityWorkItem } from "@/lib/capacity";
import { CapacityGrid } from "./CapacityGrid";

// The shared grid's hover card and PLANNING: drags are staged and only Save
// hands them over. jsdom has no layout, so each day header is given a
// 100px-wide box (Mon 2 Nov at x 0–100, Tue at 100–200, …), and which
// person's row is under the pointer is answered by a stubbed
// document.elementFromPoint.

const ANA: Person = { displayName: "Ana Engineer", email: "ana@example.com", lookupId: 1 };
const BOB: Person = { displayName: "Bob Builder", email: "bob@example.com", lookupId: 2 };
const d = (k: string) => new Date(`${k}T12:00:00Z`);

const ITEM: CapacityWorkItem = {
  id: "x:1",
  title: "Screw master script",
  href: "/x/1",
  assignees: [ANA],
  startDate: d("2026-11-03"), // Tue
  dueDate: d("2026-11-05"), // Thu
  estimatedHours: 16,
  done: false,
  context: "00. Execution",
  statusLabel: "In Process",
};
const BACKLOG: CapacityWorkItem = {
  id: "x:2",
  title: "Drawing creation",
  href: "/x/2",
  assignees: [],
  startDate: null,
  dueDate: null,
  estimatedHours: 12,
  done: false,
};

const COLUMN_X: Record<string, number> = {};
for (let i = 0; i < 14; i++) {
  const day = new Date(Date.UTC(2026, 10, 2 + i, 12)).toISOString().slice(0, 10);
  COLUMN_X[day] = i * 100;
}

type OnSave = (changes: Array<{ item: CapacityWorkItem; change: CapacityChange }>) => Promise<{ failed: string[] }>;

let rectSpy: ReturnType<typeof vi.spyOn>;
let rowUnderPointer: string | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T15:00:00"));
  rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    const key = (this as HTMLElement).dataset.dayKey;
    const left = key !== undefined && key in COLUMN_X ? COLUMN_X[key] : -1000;
    return { left, right: left + 100, top: 0, bottom: 20, width: 100, height: 20, x: left, y: 0, toJSON() {} } as DOMRect;
  });
  rowUnderPointer = null;
  document.elementFromPoint = () =>
    rowUnderPointer ? document.querySelector(`tr[data-person-id="${rowUnderPointer}"]`) : null;
});
afterEach(() => {
  rectSpy.mockRestore();
  vi.useRealTimers();
  // @ts-expect-error — jsdom has none; restore that
  delete document.elementFromPoint;
});

async function renderGrid(onSave?: OnSave) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  renderWithProviders(
    <CapacityGrid items={[ITEM, BACKLOG]} timeOff={[]} people={[BOB]} emptyHint="none" onSave={onSave} />,
    { route: "/panels/capacity" },
  );
  await user.click(screen.getByRole("button", { name: /Ana Engineer/, expanded: false }));
  return user;
}

function move(x: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: 5 }));
  });
}
function release() {
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerup"));
  });
}
const saveOk = () => vi.fn<OnSave>(async () => ({ failed: [] }));

describe("CapacityGrid hover card", () => {
  it("shows hours a day, the total, the dates and the project — Wrike's card", async () => {
    await renderGrid();
    const bar = screen.getByTestId("bar-x:1");
    expect(bar).toHaveTextContent("5.33h/d");
    fireEvent.pointerEnter(bar, { clientX: 150, clientY: 10 });
    const card = screen.getByRole("tooltip");
    expect(card).toHaveTextContent("Screw master script");
    expect(card).toHaveTextContent("5.33h/d · 16h total over 3 days");
    expect(card).toHaveTextContent("00. Execution");
    fireEvent.pointerLeave(bar);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("CapacityGrid planning", () => {
  it("stages a moved bar — the cells follow, nothing is saved until Save", async () => {
    const onSave = saveOk();
    const user = await renderGrid(onSave);
    fireEvent.pointerDown(screen.getByTestId("bar-x:1"), { button: 0, pointerType: "mouse", clientX: 150 });
    move(750); // Mon 9 Nov
    release();
    expect(screen.getByRole("button", { name: /Ana Engineer, Tuesday, Nov 3: 0h of 8h/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Monday, Nov 9: 5\.33h of 8h/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 unsaved change");
    expect(onSave).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const [[{ item, change }]] = onSave.mock.calls[0];
    expect(item).toBe(ITEM); // the item AS SAVED
    expect(change.startDate?.toISOString()).toBe("2026-11-09T12:00:00.000Z");
    expect(change.dueDate?.toISOString()).toBe("2026-11-11T12:00:00.000Z");
    expect(change.assignees).toBeUndefined();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("drags an end: one date changes, the total stays, the hours a day change", async () => {
    await renderGrid(saveOk());
    fireEvent.pointerDown(screen.getByTestId("bar-end-x:1"), { button: 0, pointerType: "mouse", clientX: 350 });
    move(750);
    // Tue–Fri + Mon = 5 working days: 16h / 5 = 3.2h a day.
    expect(screen.getByRole("button", { name: /Tuesday, Nov 3: 3\.2h of 8h/ })).toBeInTheDocument();
    release();
    expect(screen.getByRole("status")).toHaveTextContent("1 unsaved change");
  });

  it("reassigns a bar dragged onto another person's row", async () => {
    const onSave = saveOk();
    const user = await renderGrid(onSave);
    fireEvent.pointerDown(screen.getByTestId("bar-x:1"), { button: 0, pointerType: "mouse", clientX: 150 });
    rowUnderPointer = "bob@example.com";
    move(150);
    release();
    expect(screen.getByRole("button", { name: /Bob Builder, Tuesday, Nov 3: 5\.33h of 8h/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const [[{ change }]] = onSave.mock.calls[0];
    expect(change.assignees).toEqual([BOB]);
    expect(change.startDate).toBeUndefined(); // same day: not a change
  });

  it("assigns and schedules a backlog task dropped on a person and a day", async () => {
    const onSave = saveOk();
    const user = await renderGrid(onSave);
    fireEvent.pointerDown(screen.getByTestId("backlog-grip-x:2"), { button: 0, pointerType: "mouse", clientX: 0 });
    rowUnderPointer = "bob@example.com";
    move(250); // Wed 4 Nov
    release();
    // 12h at 8h a day = 2 days, Wed–Thu, 6h each.
    expect(screen.getByRole("button", { name: /Bob Builder, Wednesday, Nov 4: 6h of 8h/ })).toBeInTheDocument();
    expect(screen.queryByTestId("backlog-grip-x:2")).not.toBeInTheDocument(); // left the backlog
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const [[{ item, change }]] = onSave.mock.calls[0];
    expect(item).toBe(BACKLOG);
    expect(change.assignees).toEqual([BOB]);
    expect(change.startDate?.toISOString()).toBe("2026-11-04T12:00:00.000Z");
    expect(change.dueDate?.toISOString()).toBe("2026-11-05T12:00:00.000Z");
  });

  it("drags a backlog task from anywhere on its row except the title, which stays a link", async () => {
    await renderGrid(saveOk());
    // The title: a press there is the link's, and carries nothing.
    fireEvent.pointerDown(screen.getByRole("link", { name: "Drawing creation" }), {
      button: 0,
      pointerType: "mouse",
      clientX: 0,
    });
    rowUnderPointer = "bob@example.com";
    move(250);
    release();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // The rest of the row (here, the hours text) carries it.
    rowUnderPointer = null;
    fireEvent.pointerDown(screen.getByText("12h"), { button: 0, pointerType: "mouse", clientX: 0 });
    rowUnderPointer = "bob@example.com";
    move(250);
    release();
    expect(screen.getByRole("status")).toHaveTextContent("1 unsaved change");
  });

  it("drops nothing when a backlog task is let go outside every row", async () => {
    await renderGrid(saveOk());
    fireEvent.pointerDown(screen.getByTestId("backlog-grip-x:2"), { button: 0, pointerType: "mouse", clientX: 0 });
    move(250);
    release();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("dragging back to where it started is not a change", async () => {
    await renderGrid(saveOk());
    const bar = () => screen.getByTestId("bar-x:1");
    fireEvent.pointerDown(bar(), { button: 0, pointerType: "mouse", clientX: 150 });
    move(750);
    release();
    fireEvent.pointerDown(bar(), { button: 0, pointerType: "mouse", clientX: 750 });
    move(150);
    release();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("Discard throws the plan away", async () => {
    const onSave = saveOk();
    const user = await renderGrid(onSave);
    fireEvent.pointerDown(screen.getByTestId("bar-x:1"), { button: 0, pointerType: "mouse", clientX: 150 });
    move(750);
    release();
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("button", { name: /Tuesday, Nov 3: 5\.33h of 8h/ })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps a change that failed to save staged, so it can be retried", async () => {
    const onSave = vi.fn<OnSave>(async () => ({ failed: ["x:1"] }));
    const user = await renderGrid(onSave);
    fireEvent.pointerDown(screen.getByTestId("bar-x:1"), { button: 0, pointerType: "mouse", clientX: 150 });
    move(750);
    release();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 unsaved change");
  });

  it("treats a press without movement as a click, and Escape cancels a drag", async () => {
    await renderGrid(saveOk());
    fireEvent.pointerDown(screen.getByTestId("bar-x:1"), { button: 0, pointerType: "mouse", clientX: 150 });
    release();
    fireEvent.pointerDown(screen.getByTestId("bar-x:1"), { button: 0, pointerType: "mouse", clientX: 150 });
    move(750);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    release();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the plan when the page is left, and says so when it comes back", async () => {
    localStorage.clear();
    const onSave = saveOk();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const grid = (
      <CapacityGrid items={[ITEM, BACKLOG]} timeOff={[]} people={[BOB]} emptyHint="none" onSave={onSave} draftKey="t" />
    );
    const first = renderWithProviders(grid, { route: "/panels/capacity" });
    await user.click(screen.getByRole("button", { name: /Ana Engineer/, expanded: false }));
    fireEvent.pointerDown(screen.getByTestId("bar-x:1"), { button: 0, pointerType: "mouse", clientX: 150 });
    move(750);
    release();
    first.unmount(); // off to the Dashboard

    renderWithProviders(grid, { route: "/panels/capacity" });
    expect(screen.getByRole("status")).toHaveTextContent("1 unsaved change — kept from your last visit");
    expect(screen.getByRole("button", { name: /Ana Engineer, Monday, Nov 9: 5\.33h of 8h/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("arc:capacity-plan:t")).toBeNull();
  });

  it("offers no drag at all without onSave (a Viewer)", async () => {
    await renderGrid(undefined);
    expect(screen.queryByTestId("bar-end-x:1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("backlog-grip-x:2")).not.toBeInTheDocument();
  });
});
