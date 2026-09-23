import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateField, YEARS_BACK, YEARS_FORWARD, buildYearOptions } from "./DateField";
import { MAX_YEAR, MIN_YEAR } from "@/lib/dateInput";

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
    // Month and year are PICKERS now, not a text label, so assert on what
    // each one is showing.
    expect(within(dialog).getByLabelText("Month")).toHaveValue("2"); // March
    expect(within(dialog).getByLabelText("Year")).toHaveValue("1999");
  });

  it("pages between months", async () => {
    const user = open();
    render(<DateField value="2026-05-01" onChange={() => {}} aria-label="Due Date" />);
    await user.click(screen.getByRole("button", { name: "Due Date" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Next month" }));
    expect(within(dialog).getByLabelText("Month")).toHaveValue("5"); // June
    expect(within(dialog).getByLabelText("Year")).toHaveValue("2026");

    await user.click(within(dialog).getByRole("button", { name: "Previous month" }));
    await user.click(within(dialog).getByRole("button", { name: "Previous month" }));
    expect(within(dialog).getByLabelText("Month")).toHaveValue("3"); // April
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

// =============================================================================
// Choosing the year without scrolling.
//
// Ray, 2026-09-22: "make the date pickers where you can choose the year easily
// instead of scrolling — especially on CSA logs". A CSA certification date can
// be twenty years old, and the only navigation was a one-month-per-click
// arrow: ~240 clicks to reach it.
// =============================================================================

describe("buildYearOptions", () => {
  it("offers a window around the current year, newest first", () => {
    const years = buildYearOptions(2026);
    expect(years[0]).toBe(2026 + YEARS_FORWARD);
    expect(years[years.length - 1]).toBe(2026 - YEARS_BACK);
    // Descending, so this year and the recent past are at the top.
    expect([...years].sort((a, b) => b - a)).toEqual(years);
  });

  it("is a CHOICE, not another scroll — nowhere near the 1,100-year range", () => {
    // MIN_YEAR..MAX_YEAR is 1900-2999. Rendering all of that as options just
    // moves the scrolling into the dropdown.
    expect(buildYearOptions(2026).length).toBeLessThan(60);
  });

  it("INCLUDES a year outside the window when the field already holds it", () => {
    // Otherwise a 1999 CSA certificate has no selectable year, and the picker
    // would silently move the date on the next save.
    const years = buildYearOptions(2026, 1999);
    expect(years).toContain(1999);
    expect(years).toContain(2026);
  });

  it("includes the year the arrows have paged to", () => {
    const years = buildYearOptions(2026, undefined, 1975);
    expect(years).toContain(1975);
  });

  it("never offers a year SharePoint can't store", () => {
    // The whole reason this component exists — a year below 1900 reached
    // Graph as a misleading 404.
    const low = buildYearOptions(MIN_YEAR, MIN_YEAR - 40);
    expect(Math.min(...low)).toBeGreaterThanOrEqual(MIN_YEAR);
    const high = buildYearOptions(MAX_YEAR, MAX_YEAR + 40);
    expect(Math.max(...high)).toBeLessThanOrEqual(MAX_YEAR);
  });

  it("does not repeat a year that is both in the window and passed in", () => {
    const years = buildYearOptions(2026, 2026, 2026);
    expect(years.filter((y) => y === 2026)).toHaveLength(1);
  });
});

describe("choosing a year from the picker", () => {
  it("jumps the calendar to that year in one go", async () => {
    const user = open();
    render(<DateField value="2026-05-10" onChange={() => {}} aria-label="Date Certified" />);
    await user.click(screen.getByRole("button", { name: "Date Certified" }));
    const dialog = await screen.findByRole("dialog");

    await user.selectOptions(within(dialog).getByLabelText("Year"), "2015");

    expect(within(dialog).getByLabelText("Year")).toHaveValue("2015");
    // The month is kept — changing the year shouldn't also move the month.
    expect(within(dialog).getByLabelText("Month")).toHaveValue("4"); // May
  });

  it("jumps to a month in one go, keeping the year", async () => {
    const user = open();
    render(<DateField value="2026-05-10" onChange={() => {}} aria-label="Date Certified" />);
    await user.click(screen.getByRole("button", { name: "Date Certified" }));
    const dialog = await screen.findByRole("dialog");

    await user.selectOptions(within(dialog).getByLabelText("Month"), "0"); // January

    expect(within(dialog).getByLabelText("Month")).toHaveValue("0");
    expect(within(dialog).getByLabelText("Year")).toHaveValue("2026");
  });

  it("offers an OLD record's own year — the CSA case", async () => {
    // The year must be OUTSIDE the default window, or this passes with the
    // fold-in deleted and proves nothing. A 2004 date sat inside the 30-year
    // window and did exactly that; computed from today so it can't rot.
    const oldYear = new Date().getFullYear() - YEARS_BACK - 5;
    const user = open();
    render(
      <DateField value={`${oldYear}-07-02`} onChange={() => {}} aria-label="Date Certified" />,
    );
    await user.click(screen.getByRole("button", { name: "Date Certified" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Year")).toHaveValue(String(oldYear));
  });

  it("still commits a real date after jumping years", async () => {
    // The picker moves the VIEW; picking a day is still what sets the value.
    const onChange = vi.fn();
    const user = open();
    render(<DateField value="2026-05-10" onChange={onChange} aria-label="Date Certified" />);
    await user.click(screen.getByRole("button", { name: "Date Certified" }));
    const dialog = await screen.findByRole("dialog");

    await user.selectOptions(within(dialog).getByLabelText("Year"), "2015");
    await user.click(within(dialog).getByRole("button", { name: /May 15, 2015/ }));

    expect(onChange).toHaveBeenCalledWith("2015-05-15");
  });
});

// =============================================================================
// The month / year pickers have to be readable in BOTH themes.
//
// Ray, 2026-09-22, with a dark-mode screenshot: the year list rendered as
// black-on-white over the dark calendar panel. Two causes, both fixed:
//
//  1. The selects carried `bg-transparent`, and a native <select>'s dropdown
//     list inherits the control's background — so the options were drawn over
//     whatever sat behind the panel.
//  2. ARC declared no `color-scheme` at all, so the browser painted every
//     native list with its LIGHT palette regardless of theme. That lives in
//     globals.css (`:root` light, `.dark` dark) and can't be asserted from
//     jsdom, which computes no UA styles — it is pinned by the CSS test below.
// =============================================================================

describe("the month / year pickers are theme-aware", () => {
  it("gives both selects a real background, never transparent", async () => {
    const user = open();
    render(<DateField value="2026-05-10" onChange={() => {}} aria-label="Date Certified" />);
    await user.click(screen.getByRole("button", { name: "Date Certified" }));
    const dialog = await screen.findByRole("dialog");

    for (const name of ["Month", "Year"]) {
      const el = within(dialog).getByLabelText(name);
      expect(el.className, name).toContain("bg-surface");
      expect(el.className, name).not.toContain("bg-transparent");
    }
  });

  it("colours their text from the theme token", async () => {
    const user = open();
    render(<DateField value="2026-05-10" onChange={() => {}} aria-label="Date Certified" />);
    await user.click(screen.getByRole("button", { name: "Date Certified" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Year").className).toContain("text-fg");
  });
});
