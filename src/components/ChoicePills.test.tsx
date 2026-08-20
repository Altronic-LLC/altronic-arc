import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChoicePills, MAX_PILL_OPTIONS } from "./ChoicePills";
import { YesNoField } from "./YesNoField";

// =============================================================================
// Short choice lists are pills you click, not dropdowns you open (Ray,
// 2026-08-19: "make sure all yes no are selections throughout the apps and
// modals. Easy to toggle.").
// =============================================================================

describe("ChoicePills", () => {
  it("shows every option, with the current one selected", () => {
    render(
      <ChoicePills
        label="Testing Required"
        name="t"
        options={["In Process", "Yes", "No"]}
        value="Yes"
        onChange={vi.fn()}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Testing Required" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(within(group).getByRole("radio", { name: "Yes" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "No" })).not.toBeChecked();
  });

  it("answers in one click", async () => {
    const onChange = vi.fn();
    render(
      <ChoicePills label="Result" name="r" options={["Pass", "Fail"]} value="" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Fail" }));
    expect(onChange).toHaveBeenCalledWith("Fail");
  });

  it("takes options whose value differs from their label", async () => {
    const onChange = vi.fn();
    render(
      <ChoicePills
        label="Hold"
        name="h"
        options={[
          { value: "Y", label: "On hold" },
          { value: "N", label: "Running" },
        ]}
        value="Y"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("radio", { name: "On hold" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Running" }));
    expect(onChange).toHaveBeenCalledWith("N");
  });

  it("offers no Not set option unless asked", () => {
    render(
      <ChoicePills label="Hold" name="h" options={["Yes", "No"]} value="" onChange={vi.fn()} />,
    );
    expect(screen.queryByRole("radio", { name: "Not set" })).not.toBeInTheDocument();
  });

  // Blank is its own state on most of these columns; without this, opening a
  // record and saving would answer a question nobody had answered.
  it("can return to Not set when blank is a real state", async () => {
    const onChange = vi.fn();
    render(
      <ChoicePills
        label="Hold"
        name="h"
        options={["Yes", "No"]}
        value="Yes"
        onChange={onChange}
        allowUnset
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Not set" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("selects Not set when the value is blank", () => {
    render(
      <ChoicePills
        label="Hold"
        name="h"
        options={["Yes", "No"]}
        value=""
        onChange={vi.fn()}
        allowUnset
      />,
    );
    expect(screen.getByRole("radio", { name: "Not set" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Yes" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "No" })).not.toBeChecked();
  });

  it("says where the dropdown takes over", () => {
    expect(MAX_PILL_OPTIONS).toBe(3);
  });
});

describe("YesNoField", () => {
  it("reads a boolean column's blank as No", () => {
    render(<YesNoField label="Drawings Complete?" name="d" value="" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "No" })).toBeChecked();
  });

  it("stores No as empty on a boolean column", async () => {
    const onChange = vi.fn();
    render(<YesNoField label="Drawings Complete?" name="d" value="Yes" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("stores the literal word on a text column", async () => {
    const onChange = vi.fn();
    render(
      <YesNoField label="On Hold" name="o" value="Yes" onChange={onChange} noValue="no" />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    expect(onChange).toHaveBeenCalledWith("No");
  });

  // Older rows carry "yes" / "no" in lower case.
  it("matches stored casing loosely", () => {
    render(<YesNoField label="On Hold" name="o" value="yes" onChange={vi.fn()} noValue="no" />);
    expect(screen.getByRole("radio", { name: "Yes" })).toBeChecked();
  });

  // A boolean column has no unset state, so No and Not set would share the
  // empty value and both light up. allowUnset forces the literal "No".
  it("keeps No and Not set distinct when both are offered", () => {
    render(
      <YesNoField label="On Hold" name="o" value="" onChange={vi.fn()} allowUnset />,
    );
    expect(screen.getByRole("radio", { name: "Not set" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "No" })).not.toBeChecked();
  });
});
