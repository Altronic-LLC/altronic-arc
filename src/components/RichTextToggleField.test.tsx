import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { RichTextToggleField } from "./RichTextToggleField";
import { parseChecklistItems } from "@/lib/descriptionChecklist";

// =============================================================================
// Rich text on a description, and the checklist it would cost.
//
// A description's `- [ ]` lines are parsed LINE BY LINE out of the raw stored
// string. Rich text wraps everything in `<p>` and drops the newlines, so a
// rich description has no checkboxes at all.
//
// Two behaviours, split on whether work already exists (Ray, 2026-09-16):
// a description that ALREADY HAS checkboxes blocks the switch; one with none
// warns and lets you through.
// =============================================================================

/** A controlled host, so a test sees what the real form sees. */
function Host({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <RichTextToggleField
      value={value}
      onChange={setValue}
      ariaLabel="Description"
      renderPlain={() => (
        <textarea
          aria-label="Description"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
    />
  );
}

const WITH_CHECKLIST = "- [ ] wire the loom\n- [x] test continuity";

describe("a description with NO checklist", () => {
  it("offers the toggle", () => {
    render(<Host initial="Just some prose." />);
    const button = screen.getByRole("button", { name: /rich text/i });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("WARNS that checklists stop working, before switching", async () => {
    const user = userEvent.setup();
    render(<Host initial="Just some prose." />);

    await user.click(screen.getByRole("button", { name: /rich text/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/checklist/i);
  });

  it("stays plain when declined", async () => {
    const user = userEvent.setup();
    render(<Host initial="Just some prose." />);

    await user.click(screen.getByRole("button", { name: /rich text/i }));
    await user.click(await screen.findByRole("button", { name: /keep plain text/i }));

    expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /rich text/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("switches on confirm, carrying the draft across as paragraphs", async () => {
    const user = userEvent.setup();
    render(<Host initial="Line one" />);

    await user.click(screen.getByRole("button", { name: /rich text/i }));
    await user.click(await screen.findByRole("button", { name: /use rich text/i }));

    // Discarding the draft on a format switch would be its own bug.
    expect(screen.getByText("Line one")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /rich text/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("says checklists are off, at the point of use", async () => {
    const user = userEvent.setup();
    const { container } = render(<Host initial="Prose." />);

    await user.click(screen.getByRole("button", { name: /rich text/i }));
    await user.click(await screen.findByRole("button", { name: /use rich text/i }));

    // The dialog is long gone by the time somebody wants a checkbox.
    // JSX wraps the sentence across lines, so a contiguous-string matcher
    // misses it — and a custom matcher matches every ANCESTOR too, which
    // makes getByText ambiguous. Assert on the container's own text.
    expect(container.textContent).toMatch(/checklists are off in rich text/i);
  });

  it("switches BACK with no warning", async () => {
    const user = userEvent.setup();
    render(<Host initial="Prose." />);

    await user.click(screen.getByRole("button", { name: /rich text/i }));
    await user.click(await screen.findByRole("button", { name: /use rich text/i }));
    await user.click(screen.getByRole("button", { name: /rich text/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
  });
});

describe("a description that ALREADY HAS a checklist", () => {
  it("is a real checklist to begin with — the fixture isn't lying", () => {
    // If this stopped parsing, every assertion below would pass vacuously.
    expect(parseChecklistItems(WITH_CHECKLIST)).toHaveLength(2);
  });

  it("BLOCKS the switch — there is tick state to lose", async () => {
    render(<Host initial={WITH_CHECKLIST} />);
    expect(screen.getByRole("button", { name: /rich text/i })).toBeDisabled();
  });

  it("says WHY on screen, not only in a tooltip", () => {
    // A title attribute needs a hover, and a phone hasn't got one.
    render(<Host initial={WITH_CHECKLIST} />);
    expect(screen.getByText(/unavailable while this description has a checklist/i))
      .toBeInTheDocument();
  });

  it("opens no dialog when the disabled button is clicked", async () => {
    const user = userEvent.setup();
    render(<Host initial={WITH_CHECKLIST} />);

    await user.click(screen.getByRole("button", { name: /rich text/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("UNBLOCKS once the checklist lines are gone", async () => {
    const user = userEvent.setup();
    render(<Host initial={WITH_CHECKLIST} />);
    expect(screen.getByRole("button", { name: /rich text/i })).toBeDisabled();

    await user.clear(screen.getByRole("textbox", { name: "Description" }));
    await user.type(screen.getByRole("textbox", { name: "Description" }), "prose now");

    expect(screen.getByRole("button", { name: /rich text/i })).toBeEnabled();
  });
});

describe("the disabled state", () => {
  it("honours a disabled field", () => {
    render(
      <RichTextToggleField
        value="prose"
        onChange={vi.fn()}
        disabled
        renderPlain={() => <textarea aria-label="Description" />}
      />,
    );
    expect(screen.getByRole("button", { name: /rich text/i })).toBeDisabled();
  });
});
