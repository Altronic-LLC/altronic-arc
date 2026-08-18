import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RichTextEditor } from "./RichTextEditor";

// The editor exists because EIR text fields couldn't hold bold ("Could not
// Bold any words", Jerrod Waldron, 2026-08-18). jsdom implements neither
// execCommand nor contentEditable typing, so what's testable here is the
// wiring: which command each button fires, and that nothing reaches the
// caller unsanitised.

const exec = vi.fn(() => true);

beforeEach(() => {
  exec.mockClear();
  // jsdom has no execCommand at all — define it rather than spy on it.
  (document as unknown as { execCommand: unknown }).execCommand = exec;
});

afterEach(() => {
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

function editorBody(): HTMLElement {
  return screen.getByRole("textbox");
}

describe("RichTextEditor", () => {
  it("seeds the editor with the value it was given", () => {
    render(<RichTextEditor value="<p>Hello</p>" onChange={vi.fn()} />);
    expect(editorBody().innerHTML).toBe("<p>Hello</p>");
  });

  it("strips anything unsafe out of the seeded value", () => {
    render(
      <RichTextEditor value='<p onclick="steal()">Hi</p><script>x</script>' onChange={vi.fn()} />,
    );
    expect(editorBody().innerHTML).toBe("<p>Hi</p>");
  });

  it.each([
    ["Bold", "bold"],
    ["Italic", "italic"],
    ["Underline", "underline"],
    ["Bulleted list", "insertUnorderedList"],
    ["Numbered list", "insertOrderedList"],
  ])("runs %s", (label, command) => {
    render(<RichTextEditor value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(exec).toHaveBeenCalledWith(command);
  });

  it("reports what the user typed, sanitised", () => {
    const onChange = vi.fn();
    render(<RichTextEditor value="" onChange={onChange} />);

    const body = editorBody();
    body.innerHTML = "<p>Now <strong>bold</strong></p><script>bad()</script>";
    fireEvent.input(body);

    expect(onChange).toHaveBeenCalledWith("<p>Now <strong>bold</strong></p>");
  });

  it("keeps pasted formatting but drops the sender's colours and styles", () => {
    render(<RichTextEditor value="" onChange={vi.fn()} />);

    fireEvent.paste(editorBody(), {
      clipboardData: {
        getData: (type: string) =>
          type === "text/html"
            ? '<p style="color: rgb(0,0,0)">Pasted <b>bold</b></p>'
            : "Pasted bold",
      },
    });

    expect(exec).toHaveBeenCalledWith(
      "insertHTML",
      false,
      "<p>Pasted <b>bold</b></p>",
    );
  });

  it("turns pasted plain text into paragraphs rather than one run-on block", () => {
    render(<RichTextEditor value="" onChange={vi.fn()} />);

    fireEvent.paste(editorBody(), {
      clipboardData: {
        getData: (type: string) => (type === "text/html" ? "" : "One.\n\nTwo."),
      },
    });

    expect(exec).toHaveBeenCalledWith(
      "insertHTML",
      false,
      "<p>One.</p><p>Two.</p>",
    );
  });

  it("is not editable when disabled", () => {
    render(<RichTextEditor value="" onChange={vi.fn()} disabled />);
    expect(editorBody()).toHaveAttribute("contenteditable", "false");
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(exec).not.toHaveBeenCalled();
  });
});
