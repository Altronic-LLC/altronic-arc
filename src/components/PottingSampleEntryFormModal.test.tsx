import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { PottingSampleEntryFormModal } from "./PottingSampleEntryFormModal";

// Mocked rather than left to hit the real USE_MOCK branch in
// api/pottingSampleLog.ts — that branch depends on the environment's
// VITE_USE_MOCK setting, and this test should pass the same way whether or
// not a dev machine has real-mode config in its local .env.
vi.mock("@/api/pottingSampleLog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/pottingSampleLog")>();
  return { ...actual, createPottingSampleEntry: vi.fn() };
});

import { createPottingSampleEntry } from "@/api/pottingSampleLog";

// =============================================================================
// The entry form used to sit inline on the page, always mounted. It's now a
// modal opened by an "Add entry" button (see PottingSampleLogView), so the
// date/time default has to be recomputed on every open rather than seeded
// once. Since this component mounts fresh each time the parent shows it,
// that's exercised here by mounting it twice at different system times.
// =============================================================================

function dateInput(): HTMLInputElement {
  return screen.getByLabelText("Date") as HTMLInputElement;
}

describe("PottingSampleEntryFormModal", () => {
  it("defaults the date/time field to the current local time", () => {
    vi.setSystemTime(new Date("2026-09-18T13:12:00"));
    renderWithProviders(<PottingSampleEntryFormModal onClose={vi.fn()} />);
    expect(dateInput().value).toBe("2026-09-18T13:12");
    vi.useRealTimers();
  });

  it("recomputes the default each time it's mounted (each time it's opened)", () => {
    vi.setSystemTime(new Date("2026-09-18T13:12:00"));
    const { unmount } = renderWithProviders(<PottingSampleEntryFormModal onClose={vi.fn()} />);
    expect(dateInput().value).toBe("2026-09-18T13:12");
    unmount();

    vi.setSystemTime(new Date("2026-09-18T15:45:00"));
    renderWithProviders(<PottingSampleEntryFormModal onClose={vi.fn()} />);
    expect(dateInput().value).toBe("2026-09-18T15:45");
    vi.useRealTimers();
  });

  it("closes without saving when Cancel is clicked", async () => {
    const onClose = vi.fn();
    renderWithProviders(<PottingSampleEntryFormModal onClose={onClose} />);

    await userEvent.type(screen.getByLabelText("Weight"), "175");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderWithProviders(<PottingSampleEntryFormModal onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("saves the entry and closes on submit", async () => {
    (createPottingSampleEntry as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "1",
      date: "2026-09-18T13:12:00.000Z",
      volume: 125,
      weight: 176,
    });
    const onClose = vi.fn();
    renderWithProviders(<PottingSampleEntryFormModal onClose={onClose} />);

    await userEvent.type(screen.getByLabelText("Weight"), "176");
    await userEvent.click(screen.getByRole("button", { name: "Save entry" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createPottingSampleEntry).toHaveBeenCalledWith(
      expect.objectContaining({ volume: 125, weight: 176 }),
    );
  });

  it("refuses to submit with no weight entered", async () => {
    const onClose = vi.fn();
    renderWithProviders(<PottingSampleEntryFormModal onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "Save entry" }));

    expect(onClose).not.toHaveBeenCalled();
  });
});
