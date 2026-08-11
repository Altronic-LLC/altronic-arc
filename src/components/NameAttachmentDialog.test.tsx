import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NameAttachmentDialog, needsAttachmentName } from "./NameAttachmentDialog";

// Stub object-URL creation so the preview thumbnail's src is deterministic
// (jsdom's own implementation, when present, returns a fresh random URL).
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

const screenshot = (name = "screenshot-2026-08-11-134502.png") =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

function setup(file = screenshot(), onConfirm = vi.fn(), onCancel = vi.fn()) {
  const user = userEvent.setup();
  render(<NameAttachmentDialog file={file} onConfirm={onConfirm} onCancel={onCancel} />);
  return { user, onConfirm, onCancel };
}

describe("needsAttachmentName", () => {
  it("recognises the timestamped name filesFromClipboard generates", () => {
    expect(needsAttachmentName(screenshot("screenshot-2026-08-11-134502.png"))).toBe(true);
  });

  it("does not flag a real filename", () => {
    expect(needsAttachmentName(screenshot("pump-curve.png"))).toBe(false);
  });
});

describe("NameAttachmentDialog", () => {
  it("is an accessible dialog with a real label for the input", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const input = within(dialog).getByLabelText(/file name/i);
    expect(input.tagName).toBe("INPUT");
  });

  it("pre-fills the input with the generated name minus its extension, focused", () => {
    setup(screenshot("screenshot-2026-08-11-134502.png"));
    const input = screen.getByLabelText(/file name/i) as HTMLInputElement;
    expect(input.value).toBe("screenshot-2026-08-11-134502");
    expect(input).toHaveFocus();
  });

  it("shows the fixed extension next to the input", () => {
    setup(screenshot("screenshot-2026-08-11-134502.png"));
    expect(screen.getByText(".png")).toBeInTheDocument();
  });

  it("shows a preview thumbnail of the pasted image", () => {
    setup();
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "blob:mock");
  });

  it("disables Attach when the field is emptied", async () => {
    const { user } = setup();
    const input = screen.getByLabelText(/file name/i);
    await user.clear(input);
    expect(screen.getByRole("button", { name: /^attach$/i })).toBeDisabled();
  });

  it("confirms with a renamed File carrying the typed name and the original extension", async () => {
    const file = screenshot("screenshot-2026-08-11-134502.png");
    const onConfirm = vi.fn();
    const { user } = setup(file, onConfirm);
    const input = screen.getByLabelText(/file name/i);
    await user.clear(input);
    await user.type(input, "pump curve");
    await user.click(screen.getByRole("button", { name: /^attach$/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const renamed = onConfirm.mock.calls[0][0] as File;
    expect(renamed.name).toBe("pump curve.png");
    expect(renamed.type).toBe("image/png");
  });

  it("runs the typed name through sanitiseFilename before confirming", async () => {
    const onConfirm = vi.fn();
    const { user } = setup(screenshot(), onConfirm);
    const input = screen.getByLabelText(/file name/i);
    await user.clear(input);
    await user.type(input, 'pump: curve / rev "2"');
    await user.click(screen.getByRole("button", { name: /^attach$/i }));

    const renamed = onConfirm.mock.calls[0][0] as File;
    // Illegal SharePoint characters become "-"; the extension is untouched.
    expect(renamed.name).toBe("pump- curve - rev -2-.png");
  });

  it("confirms on Enter in the input", async () => {
    const onConfirm = vi.fn();
    const { user } = setup(screenshot(), onConfirm);
    const input = screen.getByLabelText(/file name/i);
    await user.clear(input);
    await user.type(input, "pump curve");
    await user.keyboard("{Enter}");

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm.mock.calls[0][0] as File).name).toBe("pump curve.png");
  });

  it("cancels on Escape without confirming", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    setup(screenshot(), onConfirm, onCancel);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels via the Cancel button", async () => {
    const onCancel = vi.fn();
    const { user } = setup(screenshot(), vi.fn(), onCancel);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on a clean click on the backdrop", () => {
    const onCancel = vi.fn();
    setup(screenshot(), vi.fn(), onCancel);
    const backdrop = screen.getByRole("dialog");
    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not cancel when a selection drag ends on the backdrop", () => {
    const onCancel = vi.fn();
    setup(screenshot(), vi.fn(), onCancel);
    const backdrop = screen.getByRole("dialog");
    const input = screen.getByLabelText(/file name/i);
    fireEvent.mouseDown(input);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
