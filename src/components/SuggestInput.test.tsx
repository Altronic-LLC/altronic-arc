import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuggestInput, distinctValues } from "./SuggestInput";

describe("distinctValues", () => {
  it("orders by how often a value is used, not alphabetically", () => {
    // The initials of whoever draws most should be offered first.
    expect(distinctValues(["JFD", "RJW", "JFD", "MTK", "JFD", "RJW"])).toEqual([
      "JFD",
      "RJW",
      "MTK",
    ]);
  });

  it("breaks ties alphabetically, so the order is stable", () => {
    expect(distinctValues(["b", "a"])).toEqual(["a", "b"]);
  });

  it("ignores blanks and trims", () => {
    expect(distinctValues(["  JFD ", "", null, undefined, "JFD"])).toEqual(["JFD"]);
  });

  it("returns nothing for no data", () => {
    expect(distinctValues([])).toEqual([]);
  });
});

describe("SuggestInput", () => {
  const options = ["AutoCAD", "SolidWorks", "Inventor"];

  function setup(value = "") {
    const onChange = vi.fn();
    render(
      <SuggestInput value={value} onChange={onChange} options={options} ariaLabel="Software" />,
    );
    return { onChange };
  }

  it("offers the existing values when opened", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /show existing values/i }));
    for (const option of options) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }
  });

  it("picks an existing value", async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: /show existing values/i }));
    await userEvent.click(screen.getByRole("option", { name: "SolidWorks" }));
    expect(onChange).toHaveBeenCalledWith("SolidWorks");
  });

  it("filters the suggestions as you type", async () => {
    render(
      <SuggestInput value="solid" onChange={vi.fn()} options={options} ariaLabel="Software" />,
    );
    await userEvent.click(screen.getByRole("button", { name: /show existing values/i }));
    expect(screen.getByRole("option", { name: "SolidWorks" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "AutoCAD" })).not.toBeInTheDocument();
  });

  it("keeps the whole list available once the value matches one exactly", async () => {
    // Otherwise picking a value collapses the list to just itself and you can't
    // change your mind without clearing the box.
    render(
      <SuggestInput value="AutoCAD" onChange={vi.fn()} options={options} ariaLabel="Software" />,
    );
    await userEvent.click(screen.getByRole("button", { name: /show existing values/i }));
    expect(screen.getByRole("option", { name: "SolidWorks" })).toBeInTheDocument();
  });

  it("accepts a value that isn't in the list — that's the point", async () => {
    const { onChange } = setup();
    await userEvent.type(screen.getByLabelText("Software"), "Fusion");
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.map(([v]) => v).join("")).toContain("F");
  });

  it("flags a new value as new, without treating it as an error", async () => {
    render(
      <SuggestInput value="Fusion 360" onChange={vi.fn()} options={options} ariaLabel="Software" />,
    );
    expect(screen.getByText(/new value/i)).toBeInTheDocument();
  });

  it("says nothing when the value is one of the existing ones", () => {
    render(
      <SuggestInput value="AutoCAD" onChange={vi.fn()} options={options} ariaLabel="Software" />,
    );
    expect(screen.queryByText(/new value/i)).not.toBeInTheDocument();
  });

  it("disables the dropdown when there's nothing to suggest yet", () => {
    render(<SuggestInput value="" onChange={vi.fn()} options={[]} ariaLabel="Software" />);
    expect(screen.getByRole("button", { name: /show existing values/i })).toBeDisabled();
  });

  it("closes on Escape", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /show existing values/i }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
