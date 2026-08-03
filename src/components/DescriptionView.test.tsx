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

  it("checking is instant — calls onToggle immediately, no modal", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <DescriptionView text={"- [ ] one\n- [ ] two"} onToggle={onToggle} />,
    );
    const boxes = screen.getAllByRole("checkbox");
    await user.click(boxes[1]);

    expect(onToggle).toHaveBeenCalledWith(1);
    expect(screen.queryByText(/are you sure/i)).not.toBeInTheDocument();
  });

  it("asks for confirmation before unchecking, then calls onToggle on Yes", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <DescriptionView
        text="- [x] done thing ✓[Ray White · 7/17/2026, 10:15 AM]"
        onToggle={onToggle}
      />,
    );
    await user.click(screen.getByRole("checkbox"));

    // Nothing toggles until the user confirms.
    expect(onToggle).not.toHaveBeenCalled();
    expect(
      screen.getByText(/are you sure you want to uncheck this box/i),
    ).toBeInTheDocument();
    // Names who had checked it, and warns the uncheck is recorded too.
    expect(screen.getByText(/it was checked by Ray White/i)).toBeInTheDocument();
    expect(screen.getByText(/recorded as unchecking it/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^yes$/i }));
    expect(onToggle).toHaveBeenCalledWith(0);
  });

  it("does not uncheck when the user answers No", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<DescriptionView text="- [x] one" onToggle={onToggle} />);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /^no$/i }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.queryByText(/are you sure/i)).not.toBeInTheDocument();
  });

  it("shows the who/when stamp as small detail next to a checked item", () => {
    render(<DescriptionView text="- [x] Buy the part ✓[Ray White · 7/17/2026, 10:15 AM]" />);
    expect(screen.getByText("Buy the part")).toBeInTheDocument();
    expect(screen.getByText(/✓ Ray White · 7\/17\/2026, 10:15 AM/)).toBeInTheDocument();
  });

  it("shows the unchecked-by ✗ stamp next to an unchecked item", () => {
    render(<DescriptionView text="- [ ] Buy the part ✗[Ray White · 7/17/2026, 10:15 AM]" />);
    expect(screen.getByText("Buy the part")).toBeInTheDocument();
    expect(screen.getByText(/✗ Ray White · 7\/17\/2026, 10:15 AM/)).toBeInTheDocument();
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

describe("DescriptionView — sub-tasks (indented checklist lines)", () => {
  const NESTED = "- [ ] Fit the sensor\n\t- [x] Order the bracket\n\t- [ ] Update the drawing";

  it("renders an indented line as its own checkbox, indented under the parent", () => {
    const { container } = render(<DescriptionView text={NESTED} />);
    const labels = Array.from(container.querySelectorAll("label"));
    expect(labels).toHaveLength(3);
    // The parent sits flush; both sub-tasks are stepped in.
    expect(labels[0].className).not.toContain("pl-6");
    expect(labels[1].className).toContain("pl-6");
    expect(labels[2].className).toContain("pl-6");
    expect(screen.getByText("Order the bracket")).toBeInTheDocument();
  });

  it("indents with a leading-space indent as well as a tab", () => {
    const { container } = render(<DescriptionView text={"- [ ] parent\n  - [ ] child"} />);
    const labels = Array.from(container.querySelectorAll("label"));
    expect(labels[1].className).toContain("pl-6");
  });

  it("does not show the raw indent characters as part of the item text", () => {
    render(<DescriptionView text={"- [ ] parent\n\t- [ ] child"} />);
    // The text node is the item text alone — the tab lives in the stored
    // string, not in what the user reads.
    expect(screen.getByText("child").textContent).toBe("child");
  });

  it("shows a sub-task count on the parent, and none on a childless item", () => {
    render(<DescriptionView text={NESTED} />);
    const count = screen.getByText("1/2");
    expect(count).toBeInTheDocument();
    expect(count).toHaveAttribute("title", "1 of 2 sub-tasks done");
  });

  it("counts every sub-task done once they all are (without ticking the parent)", () => {
    render(<DescriptionView text={"- [ ] parent\n\t- [x] a\n\t- [x] b"} />);
    expect(screen.getByText("2/2")).toBeInTheDocument();
    // The parent's own box stays unchecked — nothing auto-ticks it.
    expect(screen.getAllByRole("checkbox")[0]).not.toBeChecked();
  });

  it("shows no count when an item has no sub-tasks", () => {
    render(<DescriptionView text={"- [ ] alone\n- [ ] also alone"} />);
    expect(screen.queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument();
  });

  it("ticking a sub-task reports only that line, leaving the parent's box alone", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<DescriptionView text={NESTED} onToggle={onToggle} />);
    const boxes = screen.getAllByRole("checkbox");
    await user.click(boxes[2]);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(2);
    // The parent box is untouched in the DOM too.
    expect(boxes[0]).not.toBeChecked();
  });

  it("ticking the parent reports only the parent's line", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<DescriptionView text={"- [ ] parent\n\t- [ ] child"} onToggle={onToggle} />);
    await user.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(0);
  });

  it("unchecking a sub-task still asks for confirmation first", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<DescriptionView text={NESTED} onToggle={onToggle} />);
    await user.click(screen.getAllByRole("checkbox")[1]);
    expect(onToggle).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^yes$/i }));
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  it("shows a sub-task's own stamp, and counts it on the parent", () => {
    render(
      <DescriptionView
        text={"- [ ] parent\n\t- [x] child ✓[Ray White · 7/17/2026, 10:15 AM]"}
      />,
    );
    expect(screen.getByText(/✓ Ray White · 7\/17\/2026, 10:15 AM/)).toBeInTheDocument();
    expect(screen.getByText("1/1")).toBeInTheDocument();
  });
});
