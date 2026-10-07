import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { renderWithProviders } from "@/test/render";
import type { TaskColumn } from "@/api/taskColumns";
import { PCB_CHECKLIST_ITEMS } from "@/lib/pcbChecklist";
import type { Task } from "@/types/task";
import { PcbChecklistCard } from "./PcbChecklistCard";

// The three task hooks are stubbed: the card's job is to resolve items and
// send the right write, and useUpdateTaskFields brings the current user,
// toasts and the mock store with it. The raw-fields stub is a REAL query on
// the card's own key, so the card's optimistic setQueryData shows on screen.
const mutate = vi.fn();
let columns: TaskColumn[] = [];
let raw: Record<string, unknown> = {};

vi.mock("@/hooks/useTasks", () => ({
  useTaskColumns: () => ({ data: columns, isLoading: false }),
  useTaskRawFields: (id: number) =>
    useQuery({ queryKey: ["task-raw-fields", id], queryFn: () => raw }),
  useUpdateTaskFields: () => ({ mutate }),
}));

const FIDUCIALS = "Fiducials on top and bottom of actual PCB";
const DRC = "Design Rule Checks Completed and Resolved";

function spColumn(displayName: string, kind: TaskColumn["kind"]): TaskColumn {
  return {
    name: `col_${displayName.replace(/\W+/g, "_").slice(0, 24)}`,
    displayName,
    kind,
    choices: kind === "choice" ? ["Option A", "Option B"] : [],
    allowTextEntry: false,
  };
}

const ALL_COLUMNS = PCB_CHECKLIST_ITEMS.map((i) => spColumn(i.displayName, i.kind));
const nameOf = (displayName: string) =>
  ALL_COLUMNS.find((c) => c.displayName === displayName)!.name;

const task = { id: 7 } as Task;

beforeEach(() => {
  mutate.mockReset();
  columns = ALL_COLUMNS;
  raw = {};
});

describe("PcbChecklistCard — Fiducials and DRC", () => {
  it("shows both as checkboxes, directly after the schematic part number", async () => {
    renderWithProviders(<PcbChecklistCard task={task} />);
    const boxes = await screen.findAllByRole("checkbox");
    const labels = boxes.map((b) => b.closest("label")?.textContent);
    const at = labels.indexOf("Schematic Part Number Pulled If new");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(labels.slice(at, at + 3)).toEqual([
      "Schematic Part Number Pulled If new",
      FIDUCIALS,
      DRC,
    ]);
  });

  it("counts all 19 items in the progress badge", async () => {
    renderWithProviders(<PcbChecklistCard task={task} />);
    expect(await screen.findByText("0/19")).toBeInTheDocument();
  });

  it("counts a ticked Fiducials as done", async () => {
    raw = { [nameOf(FIDUCIALS)]: true };
    renderWithProviders(<PcbChecklistCard task={task} />);
    expect(await screen.findByText("1/19")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: FIDUCIALS })).toBeChecked();
  });

  it("writes the resolved column when Design Rule Checks is ticked, and ticks it at once", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PcbChecklistCard task={task} />);
    const box = await screen.findByRole("checkbox", { name: DRC });

    await user.click(box);

    expect(mutate).toHaveBeenCalledWith(
      { id: 7, fields: { [nameOf(DRC)]: true } },
      expect.anything(),
    );
    await waitFor(() => expect(box).toBeChecked());
  });

  it("says a column is missing when SharePoint hasn't got it yet, and leaves it out of the count", async () => {
    columns = ALL_COLUMNS.filter((c) => c.displayName !== FIDUCIALS);
    renderWithProviders(<PcbChecklistCard task={task} />);
    // The badge renders before the task's fields load; wait for the ROW.
    expect(await screen.findByText("0/18")).toBeInTheDocument();
    expect((await screen.findByText(FIDUCIALS)).closest("div")).toHaveTextContent(
      /column missing on the SharePoint Task list/,
    );
    expect(screen.queryByRole("checkbox", { name: FIDUCIALS })).not.toBeInTheDocument();
  });
});
