import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DescriptionView } from "./DescriptionView";

describe("DescriptionView — no checklist syntax (fallback rendering)", () => {
  it("renders sanitised HTML for legacy HTML content", () => {
    render(<DescriptionView text="<p>hello <strong>there</strong></p>" />);
    expect(screen.getByText("there").tagName).toBe("STRONG");
  });

  it("renders plain text with preserved whitespace", () => {
    const { container } = render(<DescriptionView text={"line one\nline two"} />);
    const div = container.firstElementChild as HTMLElement;
    expect(div.className).toContain("whitespace-pre-wrap");
    expect(div.textContent).toBe("line one\nline two");
  });

  it("strips script tags out of HTML content", () => {
    render(<DescriptionView text="<p>safe</p><script>alert(1)</script>" />);
    expect(document.querySelector("script")).toBeNull();
  });
});

describe("DescriptionView — checklist rendering", () => {
  it("renders each checklist line as a checkbox with its text", () => {
    render(<DescriptionView text={"- [ ] Buy the part\n- [x] Order the box"} />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[1]).toBeChecked();
    expect(screen.getByText("Buy the part")).toBeInTheDocument();
    expect(screen.getByText("Order the box")).toBeInTheDocument();
  });

  it("renders non-checklist lines mixed in as plain text", () => {
    render(<DescriptionView text={"Some context\n- [ ] Step one"} />);
    expect(screen.getByText("Some context")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("calls onToggle with the line index when a checkbox is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <DescriptionView text={"- [ ] one\n- [ ] two"} onToggle={onToggle} />,
    );
    const boxes = screen.getAllByRole("checkbox");
    await user.click(boxes[1]);
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  it("renders read-only, disabled checkboxes when onToggle is omitted", () => {
    render(<DescriptionView text="- [ ] one" />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("shows a placeholder for an empty checklist item", () => {
    render(<DescriptionView text="- [ ] " />);
    expect(screen.getByText("(empty item)")).toBeInTheDocument();
  });

  it("uses print-safe colors when tone='print'", () => {
    const { container } = render(<DescriptionView text="- [ ] one" tone="print" />);
    const label = container.querySelector("label");
    expect(label?.className).toContain("text-black");
  });
});
