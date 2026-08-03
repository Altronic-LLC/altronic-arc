import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskResolutionModal } from "./TaskResolutionModal";

describe("TaskResolutionModal", () => {
  it("shows the EIR label and keeps Complete disabled until text is entered", () => {
    render(
      <TaskResolutionModal eirLabel="EIR_2026-0042" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText("EIR_2026-0042")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /complete task/i })).toBeDisabled();
  });

  it("calls onConfirm with the trimmed resolution text", () => {
    const onConfirm = vi.fn();
    render(
      <TaskResolutionModal eirLabel="EIR_2026-0042" onConfirm={onConfirm} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/describe how this was resolved/i), {
      target: { value: "  Swapped the coil.  " },
    });
    const complete = screen.getByRole("button", { name: /complete task/i });
    expect(complete).not.toBeDisabled();
    fireEvent.click(complete);
    expect(onConfirm).toHaveBeenCalledWith("Swapped the coil.");
  });

  it("closes via Cancel", () => {
    const onClose = vi.fn();
    render(
      <TaskResolutionModal eirLabel="EIR_2026-0042" onConfirm={vi.fn()} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on a clean click on the backdrop", () => {
    const onClose = vi.fn();
    render(
      <TaskResolutionModal eirLabel="EIR_2026-0042" onConfirm={vi.fn()} onClose={onClose} />,
    );
    // In this modal the overlay is the element carrying role="dialog".
    const backdrop = screen.getByRole("dialog");
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when a text-selection drag ends on the backdrop", () => {
    // Highlighting the resolution text bottom-up used to close the modal and
    // bin what had been typed, because the browser dispatches the click on the
    // nearest common ancestor of mousedown and mouseup — the backdrop.
    const onClose = vi.fn();
    render(
      <TaskResolutionModal eirLabel="EIR_2026-0042" onConfirm={vi.fn()} onClose={onClose} />,
    );
    const backdrop = screen.getByRole("dialog");
    const textarea = screen.getByPlaceholderText(/describe how this was resolved/i);

    fireEvent.mouseDown(textarea);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not enable Complete for whitespace-only input", () => {
    render(
      <TaskResolutionModal eirLabel="EIR_2026-0042" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/describe how this was resolved/i), {
      target: { value: "    " },
    });
    expect(screen.getByRole("button", { name: /complete task/i })).toBeDisabled();
  });
});
