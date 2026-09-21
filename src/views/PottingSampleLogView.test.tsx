import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { PottingSampleLogView } from "./PottingSampleLogView";

// The entry form used to sit inline, always mounted, on this page. It's now
// hidden behind an "Add entry" button and opens as a modal
// (PottingSampleEntryFormModal) — this pins that wiring, not the modal's own
// behavior (see PottingSampleEntryFormModal.test.tsx for that).
vi.mock("@/api/pottingSampleLog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/pottingSampleLog")>();
  return { ...actual, createPottingSampleEntry: vi.fn() };
});

describe("PottingSampleLogView", () => {
  it("does not render the entry form until Add entry is clicked", async () => {
    renderWithProviders(<PottingSampleLogView />);

    expect(screen.queryByLabelText("Weight")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add entry" }));

    expect(screen.getByLabelText("Weight")).toBeInTheDocument();
  });

  it("closes the modal without adding an entry when Cancel is clicked", async () => {
    renderWithProviders(<PottingSampleLogView />);

    await userEvent.click(screen.getByRole("button", { name: "Add entry" }));
    expect(screen.getByLabelText("Weight")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Weight")).not.toBeInTheDocument();
  });
});
