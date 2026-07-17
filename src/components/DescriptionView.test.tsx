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

  it("asks for confirmation, then calls onToggle with the line index on Yes", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <DescriptionView text={"- [ ] one\n- [ ] two"} onToggle={onToggle} />,
    );
    const boxes = screen.getAllByRole("checkbox");
    await user.click(boxes[1]);

    // Nothing toggles until the user confirms.
    expect(onToggle).not.toHaveBeenCalled();
    expect(
      screen.getByText(/are you sure you want to check this box/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^yes$/i }));
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  it("does not toggle when the user answers No", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<DescriptionView text="- [ ] one" onToggle={onToggle} />);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /^no$/i }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.queryByText(/are you sure/i)).not.toBeInTheDocument();
  });

  it("asks the uncheck variant when the box is already checked", async () => {
    const user = userEvent.setup();
    render(
      <DescriptionView
        text="- [x] done thing ✓[Ray White · 7/17/2026, 10:15 AM]"
        onToggle={() => {}}
      />,
    );
    await user.click(screen.getByRole("checkbox"));
    expect(
      screen.getByText(/are you sure you want to uncheck this box/i),
    ).toBeInTheDocument();
    // Warns that unchecking clears the recorded stamp.
    expect(screen.getByText(/this clears the record/i)).toBeInTheDocument();
  });

  it("shows the who/when stamp as small detail next to a checked item", () => {
    render(<DescriptionView text="- [x] Buy the part ✓[Ray White · 7/17/2026, 10:15 AM]" />);
    expect(screen.getByText("Buy the part")).toBeInTheDocument();
    expect(screen.getByText(/✓ Ray White · 7\/17\/2026, 10:15 AM/)).toBeInTheDocument();
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
