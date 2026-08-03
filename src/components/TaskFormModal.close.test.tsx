import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS } from "@/data/mockData";

// =============================================================================
// Saving an edit must not hold the modal open on SharePoint.
//
// Reported symptom: you could see the optimistic update land on the page BEHIND
// the modal while the modal itself sat there for seconds (Ray, 2026-08-03). The
// page was already correct; the modal was hiding it.
//
// So the writes are fired and the modal closes immediately. A failure still
// rolls that field back and toasts, from the hook — which is what makes it safe
// to stop waiting.
// =============================================================================

/** A write that never resolves, standing in for a slow SharePoint. */
const pending = vi.hoisted(() => ({
  calls: 0,
  args: [] as unknown[],
  make: () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return new Promise<never>(() => {});
  },
}));

vi.mock("@/hooks/useTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useTasks")>();
  const neverSettles = () => ({
    mutateAsync: (v: unknown) => {
      pending.calls += 1;
      pending.args.push(v);
      return pending.make();
    },
    isPending: false,
  });
  return {
    ...actual,
    useUpdateTaskFields: neverSettles,
    useSetParentProject: neverSettles,
    useSetParentTask: neverSettles,
    useSetRelatedProjects: neverSettles,
    useSetAssigned: neverSettles,
    useSetWatchers: neverSettles,
  };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

import { TaskFormModal } from "./TaskFormModal";

beforeEach(() => {
  pending.calls = 0;
  pending.args = [];
});

describe("TaskFormModal — saving an edit", () => {
  const task = MOCK_TASKS[0];

  async function openEdit() {
    const onClose = vi.fn();
    renderWithProviders(<TaskFormModal mode="edit" task={task} onClose={onClose} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument(),
    );
    return onClose;
  }

  it("closes without waiting for the write to come back", async () => {
    const onClose = await openEdit();

    const title = screen.getByDisplayValue(task.title);
    await userEvent.clear(title);
    await userEvent.type(title, "Renamed while SharePoint is slow");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    // The write is in flight and will never resolve — the modal must be gone
    // anyway, because the change is already applied optimistically behind it.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(pending.calls).toBeGreaterThan(0);
  });

  it("still validates before closing — a bad edit keeps the form open", async () => {
    // Closing early must not mean closing regardless.
    const onClose = await openEdit();

    await userEvent.clear(screen.getByDisplayValue(task.title));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    // The title input carries the native `required` attribute, so the browser
    // blocks the submit before the handler runs. Either way the point holds:
    // closing early must not mean closing regardless.
    expect(onClose).not.toHaveBeenCalled();
    expect(pending.calls).toBe(0);
  });

  it("doesn't write anything when nothing changed", async () => {
    const onClose = await openEdit();
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(pending.calls).toBe(0);
    expect(pending.args).toEqual([]);
  });
});
