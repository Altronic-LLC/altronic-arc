import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateField } from "./DateField";

// The point of this component: a date can ONLY come from clicking a day, so
// the half-typed year that used to reach SharePoint ("0002-05-01" → Graph 404)
// is unreachable rather than merely filtered.

function open() {
  return userEvent.setup();
}

describe("DateField", () => {
  it("shows the date in readable form, not as a raw ISO string", () => {
    render(<DateField value="2026-05-01" onChange={() => {}} aria-label="Due Date" />);
    const trigger = screen.getByRole("button", { name: "Due Date" });
    expect(trigger.textContent).toMatch(/May/);
    expect(trigger.textContent).not.toMatch(/2026-05-01/);
  });

  it("shows the placeholder when no date is set", () => {
    render(<DateField value="" onChange={() => {}} aria-label="Due Date" />);
    expect(screen.getByRole("button", { name: "Due Date" }).textContent).toMatch(/not set/i);
  });

  it("has no typable field — the whole reason it exists", async () => {
    const user = open();
    const { container } = render(
      <DateField value="2026-05-01" onChange={() => {}} aria-label="Due Date" />,
    );
    await user.click(screen.getByRole("button", { name: "Due Date" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // Not one text-entry element anywhere, open or closed.
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("reports the picked day as yyyy-mm-dd", async () => {
    const user = open();
    const onChange = vi.fn();
    render(<DateField value="2026-05-15" onChange={onChange} aria-label="Due Date" />);
    await user.click(screen.getByRole("button", { name: "Due Date" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /May 1, 2026/ }));

    expect(onChange).toHaveBeenCalledWith("2026-05-01");
  });

  it("closes once a day is picked", async () => {
    const user = open();
    render(<DateField value="2026-05-15" onChange={() => {}} aria-label="Due Date" />);
    await user.click(screen.getByRole("button", { name: "Due Date" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /May 4, 2026/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on the month of the current value, not today", async () => {
    const user = open();
    render(<DateField value="1999-03-10" onChange={() => {}} aria-label="Due Date" />);
    await user.click(screen.getByRole("button", { name: "Due Date" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/March 1999/)).toBeInTheDocument();
  });

  it("pages between months", async () => {
    const user = open();
    render(<DateField value="2026-05-01" onChange={() => {}} aria-label="Due Date" />);
    await user.click(screen.getByRole("button", { name: "Due Date" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Next month" }));
    expect(within(dialog).getByText(/June 2026/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Previous month" }));
    await user.click(within(dialog).getByRole("button", { name: "Previous month" }));
    expect(within(dialog).getByText(/April 2026/)).toBeInTheDocument();
  });

  it("clears to an empty string, which callers map to null", async () => {
    const user = open();
    const onChange = vi.fn();
    render(<DateField value="2026-05-01" onChange={onChange} aria-label="Due Date" />);
    await user.click(screen.getByRole("button", { name: "Clear date" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("can't be opened when disabled", async () => {
    const user = open();
    render(<DateField value="2026-05-01" onChange={() => {}} disabled aria-label="Due Date" />);
    const trigger = screen.getByRole("button", { name: "Due Date" });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = open();
    render(<DateField value="2026-05-01" onChange={() => {}} aria-label="Due Date" />);
    await user.click(screen.getByRole("button", { name: "Due Date" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Round-trips a local date without the UTC shift that turns the 1st into the
  // 30th of the previous month in every US timezone.
  it("picks the day the user actually clicked, in local time", async () => {
    const user = open();
    const onChange = vi.fn();
    render(<DateField value="2026-01-15" onChange={onChange} aria-label="Due Date" />);
    await user.click(screen.getByRole("button", { name: "Due Date" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /January 1, 2026/ }));
    expect(onChange).toHaveBeenCalledWith("2026-01-01");
  });
});
