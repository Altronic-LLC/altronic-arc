import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WhereAmIEntry } from "@/types/task";
import { renderWithProviders } from "@/test/render";
import { dayLabel } from "@/lib/calendarGrid";
import { MAX_VISIBLE_PER_DAY, WhereAmIView } from "./WhereAmIView";

// A day busier than a grid cell shows (Tim, 2026-10-13). The cell used to cap
// its height and SQUASH the entries to slivers; now it shows the first
// MAX_VISIBLE_PER_DAY and says "+N more", which opens the day panel with all
// of them. Its own file because it needs its own entries — the shared mock
// store has no day this busy.

vi.mock("@/hooks/useIsPhone", () => ({
  useKanbanAvailable: () => true,
  useIsPhone: () => false,
}));

const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
const TOTAL = MAX_VISIBLE_PER_DAY + 3;
const ENTRIES: WhereAmIEntry[] = Array.from({ length: TOTAL }, (_, i) => ({
  id: i + 1,
  // Zero-padded so the day's sort (by title) matches the numbering.
  title: `Person ${String(i + 1).padStart(2, "0")} - out`,
  date: today,
  createdAt: today,
  modifiedAt: today,
}));

vi.mock("@/hooks/useWhereAmI", () => ({
  useWhereAmI: () => ({ data: ENTRIES, isLoading: false }),
  useCreateWhereAmI: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWhereAmI: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteWhereAmI: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("WhereAmIView — a busy day", () => {
  it(`shows ${MAX_VISIBLE_PER_DAY} entries in the cell and "+N more" for the rest`, () => {
    renderWithProviders(<WhereAmIView />, { route: "/engineering/where-am-i" });
    expect(screen.getByText(`Person ${String(MAX_VISIBLE_PER_DAY).padStart(2, "0")} - out`)).toBeInTheDocument();
    expect(
      screen.queryByText(`Person ${String(MAX_VISIBLE_PER_DAY + 1).padStart(2, "0")} - out`),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+3 more" })).toBeInTheDocument();
  });

  it('"+N more" opens the day panel with every entry, not the add form', async () => {
    renderWithProviders(<WhereAmIView />, { route: "/engineering/where-am-i" });
    await userEvent.click(screen.getByRole("button", { name: "+3 more" }));

    const panel = screen.getByRole("complementary", { name: `Entries for ${dayLabel(today)}` });
    expect(within(panel).getAllByRole("listitem")).toHaveLength(TOTAL);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it('"+N more" on the day already open keeps the panel open — only the date toggles', async () => {
    renderWithProviders(<WhereAmIView />, { route: "/engineering/where-am-i" });
    await userEvent.click(screen.getByRole("button", { name: "+3 more" }));
    await userEvent.click(screen.getByRole("button", { name: "+3 more" }));
    expect(
      screen.getByRole("complementary", { name: `Entries for ${dayLabel(today)}` }),
    ).toBeInTheDocument();
  });
});
