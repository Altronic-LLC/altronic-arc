import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

// Dropping a file onto the Attachments card did nothing at all — the card
// accepted a paste but had no drop handler, so users fell back to the "Add
// file" button ("Had to attach files because dragging and dropping did not
// work", Jerrod Waldron, 2026-08-18).

const uploaded = vi.hoisted(() => ({ files: [] as File[] }));

vi.mock("@/hooks/useAttachments", () => ({
  useAttachments: () => ({ data: [], isLoading: false, error: null }),
  useUploadAttachment: () => ({
    mutate: (file: File) => uploaded.files.push(file),
    isPending: false,
    error: null,
  }),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AttachmentsSection } from "./AttachmentsSection";

/** A DataTransfer stand-in — jsdom has no constructor for one. */
function fileTransfer(files: File[]) {
  return { files, types: ["Files"], dropEffect: "none", getData: () => "" };
}

function textTransfer() {
  return { files: [], types: ["text/plain"], dropEffect: "none", getData: () => "hello" };
}

function card(): HTMLElement {
  return screen.getByText("Attachments").closest("div")!.parentElement!;
}

beforeEach(() => {
  uploaded.files = [];
});

describe("AttachmentsSection — drag and drop", () => {
  it("uploads a dropped file", async () => {
    renderWithProviders(<AttachmentsSection parent="eir" itemId={1} />);
    const file = new File(["data"], "drawing.pdf", { type: "application/pdf" });

    fireEvent.drop(card(), { dataTransfer: fileTransfer([file]) });

    await waitFor(() => expect(uploaded.files).toHaveLength(1));
    expect(uploaded.files[0].name).toBe("drawing.pdf");
  });

  it("uploads every file in one drop", async () => {
    renderWithProviders(<AttachmentsSection parent="eir" itemId={1} />);
    const files = [
      new File(["a"], "one.pdf", { type: "application/pdf" }),
      new File(["b"], "two.pdf", { type: "application/pdf" }),
    ];

    fireEvent.drop(card(), { dataTransfer: fileTransfer(files) });

    await waitFor(() => expect(uploaded.files).toHaveLength(2));
    expect(uploaded.files.map((f) => f.name)).toEqual(["one.pdf", "two.pdf"]);
  });

  it("says so while a file is over the card", () => {
    renderWithProviders(<AttachmentsSection parent="eir" itemId={1} />);

    fireEvent.dragEnter(card(), { dataTransfer: fileTransfer([]) });
    expect(screen.getByText("Drop to attach")).toBeInTheDocument();

    fireEvent.dragLeave(card(), { dataTransfer: fileTransfer([]) });
    expect(screen.queryByText("Drop to attach")).toBeNull();
  });

  // Without preventDefault on dragover the browser navigates away from the
  // app to the dropped file — the drop handler alone is not enough.
  it("claims the drag so the browser doesn't open the file instead", () => {
    renderWithProviders(<AttachmentsSection parent="eir" itemId={1} />);

    const event = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: fileTransfer([]) });
    fireEvent(card(), event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores a dragged text selection", () => {
    renderWithProviders(<AttachmentsSection parent="eir" itemId={1} />);

    fireEvent.dragEnter(card(), { dataTransfer: textTransfer() });

    expect(screen.queryByText("Drop to attach")).toBeNull();
  });

  it("tells the user drag-and-drop is available when the card is empty", () => {
    renderWithProviders(<AttachmentsSection parent="eir" itemId={1} />);
    expect(screen.getByText(/drag files here/i)).toBeInTheDocument();
  });
});
