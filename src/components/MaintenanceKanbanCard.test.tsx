import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { MaintenanceKanbanCard } from "./MaintenanceKanbanCard";
import { TECH, day, makeTask } from "@/test/maintenanceFixtures";

const NOW = new Date("2026-08-27T15:00:00Z");

function renderCard(ui: ReactNode) {
  return render(<DndContext>{ui}</DndContext>);
}

describe("MaintenanceKanbanCard", () => {
  it("shows the WO number, title, asset and assignee", () => {
    renderCard(
      <MaintenanceKanbanCard
        task={makeTask({
          id: 1,
          woNumber: "WO-2026-0003",
          title: "Spindle bearing failure",
          equipment: { lookupId: 9, title: "COIL WINDER #4" },
          assigned: TECH,
        })}
        onOpen={() => {}}
        now={NOW}
      />,
    );
    expect(screen.getByText("WO-2026-0003")).toBeInTheDocument();
    expect(screen.getByText("Spindle bearing failure")).toBeInTheDocument();
    expect(screen.getByText("COIL WINDER #4")).toBeInTheDocument();
    expect(screen.getByText("David Bulkley")).toBeInTheDocument();
  });

  it("says Unassigned rather than leaving the line blank", () => {
    renderCard(<MaintenanceKanbanCard task={makeTask({ id: 1 })} onOpen={() => {}} now={NOW} />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  // The card body is the drag handle, so opening needs its own affordance —
  // and that button must not start a drag.
  it("opens from the explicit open button", async () => {
    const onOpen = vi.fn();
    renderCard(<MaintenanceKanbanCard task={makeTask({ id: 12 })} onOpen={onOpen} now={NOW} />);
    await userEvent.click(screen.getByRole("button", { name: /open work order/i }));
    expect(onOpen).toHaveBeenCalledWith(12);
  });

  it("marks an overdue card in red", () => {
    const { container } = renderCard(
      <MaintenanceKanbanCard
        task={makeTask({ id: 1, dueDate: day(-2, NOW) })}
        onOpen={() => {}}
        now={NOW}
      />,
    );
    expect(screen.getByText("2 days late")).toBeInTheDocument();
    expect(container.innerHTML).toContain("border-cooper-red/40");
  });

  it("does not mark a completed card overdue", () => {
    const { container } = renderCard(
      <MaintenanceKanbanCard
        task={makeTask({ id: 1, status: "Complete", dueDate: day(-30, NOW) })}
        onOpen={() => {}}
        now={NOW}
      />,
    );
    expect(container.innerHTML).not.toContain("border-cooper-red/40");
  });

  // The drag-overlay / phone rendering: a plain button, no drag handle, and
  // therefore no second "open" button competing with it.
  it("renders as one tappable button when dragging is disabled", async () => {
    const onOpen = vi.fn();
    renderCard(
      <MaintenanceKanbanCard task={makeTask({ id: 5 })} onOpen={onOpen} dragDisabled now={NOW} />,
    );
    expect(screen.queryByRole("button", { name: /open work order/i })).toBeNull();
    await userEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith(5);
  });
});
