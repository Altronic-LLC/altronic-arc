import { useCallback, useRef, useState } from "react";

// =============================================================================
// Drag a file onto a card to attach it.
//
// The comment composer has had this since it shipped; the Attachments cards
// never did, so dropping a file on the one place that says "Attachments" did
// nothing at all — you had to find the "Add file" button ("Had to attach files
// because dragging and dropping did not work", Jerrod Waldron, 2026-08-18).
//
// One shared hook rather than a copy per card, because the two fiddly parts
// are easy to get subtly wrong in one copy and not the other:
//
//   - **dragover MUST preventDefault.** Without it the browser treats the drop
//     as navigation and REPLACES the app with the dropped file. The drop
//     handler alone isn't enough — the page has to declare itself a drop
//     target while the drag is over it.
//   - **dragenter/dragleave fire for every child element.** Toggling the
//     highlight straight off `dragleave` makes it flicker as the pointer
//     crosses each row of the attachment list, so entries are counted and the
//     highlight only clears when the count returns to zero.
//
// Text drags are ignored: `types` has to include "Files", otherwise selecting
// a sentence and dragging it across the card lights up a drop zone that would
// have attached nothing.
// =============================================================================

interface FileDropState {
  /** True while a file drag is over the target — for the highlight. */
  dragging: boolean;
  /** Spread onto the element that should accept the drop. */
  dropProps: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

function carriesFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export function useFileDrop(
  onFiles: (files: File[]) => void,
  disabled = false,
): FileDropState {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !carriesFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !carriesFiles(e)) return;
      // Required — see the note above.
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [disabled],
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !carriesFiles(e)) return;
      e.preventDefault();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    [disabled],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !carriesFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [disabled, onFiles],
  );

  return {
    dragging,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
