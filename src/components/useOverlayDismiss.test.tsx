import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useOverlayDismiss } from "./useOverlayDismiss";

// A stand-in for the shape every modal in the app uses: an overlay with the
// dialog nested inside it, the dialog swallowing clicks.
function Harness({
  onClose,
  busy = false,
}: {
  onClose: () => void;
  busy?: boolean;
}) {
  const overlayDismiss = useOverlayDismiss(onClose, busy);
  return (
    <div data-testid="overlay" {...overlayDismiss}>
      <div data-testid="dialog" onClick={(e) => e.stopPropagation()}>
        <textarea data-testid="field" defaultValue="some text the user typed" />
      </div>
    </div>
  );
}

// Same, minus the dialog's stopPropagation — so clicks from inside really do
// reach the overlay handler.
function BareHarness({ onClose }: { onClose: () => void }) {
  const handlers = useOverlayDismiss(onClose);
  return (
    <div data-testid="bare-overlay" {...handlers}>
      <button data-testid="inner">inside</button>
    </div>
  );
}

const overlay = () => screen.getByTestId("overlay");
const field = () => screen.getByTestId("field");

describe("useOverlayDismiss", () => {
  it("dismisses on a clean click on the backdrop", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.mouseDown(overlay());
    fireEvent.mouseUp(overlay());
    fireEvent.click(overlay());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT dismiss when a selection drag starts in the dialog and ends on the backdrop", () => {
    // The reported bug: highlighting a field bottom-up / right-to-left ends the
    // drag past the dialog's edge, so the browser dispatches the click on the
    // overlay (the nearest common ancestor) and the modal used to close,
    // throwing away whatever had been typed.
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.mouseDown(field());
    fireEvent.mouseUp(overlay());
    fireEvent.click(overlay());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does NOT dismiss when a selection drag starts on the backdrop and ends in the dialog", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.mouseDown(overlay());
    fireEvent.mouseUp(field());
    fireEvent.click(overlay());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("recovers after a suppressed drag — the next clean backdrop click still closes", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.mouseDown(field());
    fireEvent.mouseUp(overlay());
    fireEvent.click(overlay());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(overlay());
    fireEvent.mouseUp(overlay());
    fireEvent.click(overlay());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks inside the dialog", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.mouseDown(field());
    fireEvent.mouseUp(field());
    fireEvent.click(field());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("still dismisses a click with no preceding mouse events (programmatic / assistive tech)", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.click(overlay());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss while busy", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} busy />);

    fireEvent.mouseDown(overlay());
    fireEvent.mouseUp(overlay());
    fireEvent.click(overlay());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not treat a click bubbling from a child as a backdrop click", () => {
    // Belt and braces: even if a modal forgets to stop propagation on the
    // dialog, a click whose target isn't the overlay never dismisses.
    const onClose = vi.fn();
    render(<BareHarness onClose={onClose} />);

    fireEvent.mouseDown(screen.getByTestId("inner"));
    fireEvent.mouseUp(screen.getByTestId("inner"));
    fireEvent.click(screen.getByTestId("inner"));

    expect(onClose).not.toHaveBeenCalled();
  });
});
