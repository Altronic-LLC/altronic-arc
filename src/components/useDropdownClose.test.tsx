import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChoiceSelect, MultiSelect } from "./SearchableSelect";
import { SuggestInput } from "./SuggestInput";
import { resetOpenDropdown } from "./useDropdownClose";

// =============================================================================
// When a dropdown closes.
//
// Before this, a panel closed on an outside click or Escape and nothing else —
// so after picking in a multi-select the only way out was clicking some empty
// part of the page, and tabbing onward left the panel open behind you (Ray,
// 2026-08-19). These pin the four rules in useDropdownClose.
// =============================================================================

beforeEach(() => {
  // The open-panel claim is module-level and app-wide; a leftover claim from a
  // previous test would close this test's dropdown out from under it.
  resetOpenDropdown();
});

function panelIsOpen(): boolean {
  return screen.queryByRole("listbox") !== null;
}

function Harness() {
  const [choice, setChoice] = useState("");
  const [many, setMany] = useState<string[]>([]);
  return (
    <div>
      <ChoiceSelect
        value={choice}
        onChange={setChoice}
        options={["Alpha", "Beta"]}
        emptyLabel="Any"
        ariaLabel="Status"
      />
      <MultiSelect
        options={[
          { value: "a", label: "Ann" },
          { value: "b", label: "Ben" },
        ]}
        selected={many}
        onChange={setMany}
        allLabel="Anyone"
      />
      <button type="button">Somewhere else</button>
    </div>
  );
}

describe("closing when focus leaves", () => {
  // Focus leaving, with no click anywhere — the outside-mousedown rule can't
  // see this one, so it's the focusout rule or nothing.
  //
  // Dispatched rather than driven with .focus(): jsdom doesn't populate
  // relatedTarget on a programmatic focus change, and relatedTarget is
  // precisely what the rule reads.
  it("closes when focus moves to another control", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    expect(panelIsOpen()).toBe(true);

    fireEvent.focusOut(screen.getByRole("button", { name: "Status" }), {
      relatedTarget: screen.getByRole("button", { name: "Somewhere else" }),
    });
    expect(panelIsOpen()).toBe(false);
  });

  it("closes on Tab out", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    expect(panelIsOpen()).toBe(true);

    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(panelIsOpen()).toBe(false);
  });

  // A blur with no relatedTarget is what you get clicking the panel's own
  // padding or a scrollbar. Closing on those would shut the panel mid-use.
  it("stays open when focus goes nowhere in particular", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Status" });
    await userEvent.click(trigger);
    expect(panelIsOpen()).toBe(true);

    fireEvent.focusOut(trigger, { relatedTarget: null });
    expect(panelIsOpen()).toBe(true);
  });

  it("stays open when focus moves within the control", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Status" });
    await userEvent.click(trigger);
    const search = screen.getByRole("listbox").querySelector("input") as HTMLInputElement;

    fireEvent.focusOut(trigger, { relatedTarget: search });
    expect(panelIsOpen()).toBe(true);
  });

  it("stays open while moving between the trigger and the search box", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    const search = screen.getByRole("listbox").querySelector("input") as HTMLInputElement;

    await userEvent.click(search);
    await userEvent.type(search, "Al");
    expect(panelIsOpen()).toBe(true);
  });
});

describe("only one dropdown open at a time", () => {
  it("closes the first when the second opens", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    expect(screen.getAllByRole("listbox")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: /Anyone/ }));
    // Still exactly one panel — the second replaced the first rather than
    // stacking on top of it.
    expect(screen.getAllByRole("listbox")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Ann" })).toBeInTheDocument();
  });
});

describe("multi-select", () => {
  it("stays open while ticking several", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /Anyone/ }));
    await userEvent.click(screen.getByRole("option", { name: "Ann" }));
    expect(panelIsOpen()).toBe(true);
    await userEvent.click(screen.getByRole("option", { name: "Ben" }));
    expect(panelIsOpen()).toBe(true);
  });

  it("has a Done button that closes it", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /Anyone/ }));
    await userEvent.click(screen.getByRole("option", { name: "Ann" }));

    await userEvent.click(within(screen.getByRole("listbox")).getByRole("button", { name: "Done" }));
    expect(panelIsOpen()).toBe(false);
  });

  it("closes on a second click of the trigger", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /Anyone/ });
    await userEvent.click(trigger);
    expect(panelIsOpen()).toBe(true);
    await userEvent.click(trigger);
    expect(panelIsOpen()).toBe(false);
  });
});

describe("single select", () => {
  it("still closes as soon as you pick", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    await userEvent.click(screen.getByRole("option", { name: "Alpha" }));
    expect(panelIsOpen()).toBe(false);
  });

  it("closes on Escape", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    await userEvent.keyboard("{Escape}");
    expect(panelIsOpen()).toBe(false);
  });
});

describe("SuggestInput follows the same rules", () => {
  function SuggestHarness() {
    const [value, setValue] = useState("");
    return (
      <div>
        <SuggestInput
          value={value}
          onChange={setValue}
          options={["Engineering - Do NOT modify stock"]}
          ariaLabel="In House Stock"
        />
        <button type="button">Somewhere else</button>
      </div>
    );
  }

  it("closes when focus moves away", async () => {
    render(<SuggestHarness />);
    await userEvent.click(screen.getByRole("textbox", { name: "In House Stock" }));
    expect(screen.getByText("Engineering - Do NOT modify stock")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Somewhere else" }));
    expect(screen.queryByText("Engineering - Do NOT modify stock")).not.toBeInTheDocument();
  });

  it("closes when a different dropdown opens", async () => {
    render(
      <div>
        <SuggestHarness />
        <ChoiceSelect
          value=""
          onChange={vi.fn()}
          options={["Alpha"]}
          emptyLabel="Any"
          ariaLabel="Status"
        />
      </div>,
    );
    await userEvent.click(screen.getByRole("textbox", { name: "In House Stock" }));
    expect(screen.getByText("Engineering - Do NOT modify stock")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Status" }));
    expect(screen.queryByText("Engineering - Do NOT modify stock")).not.toBeInTheDocument();
  });
});
