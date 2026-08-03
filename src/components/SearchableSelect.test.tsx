import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChoiceSelect, MultiSelect, SingleSelect, type SelectOption } from "./SearchableSelect";

const OPTIONS: SelectOption[] = [
  { value: "alice@x.com", label: "Alice" },
  { value: "bob@x.com", label: "Bob" },
  { value: "carol@x.com", label: "Carol" },
  { value: "dave@x.com", label: "Dave" },
];

describe("MultiSelect — trigger summary", () => {
  it("shows allLabel when nothing is selected", () => {
    render(
      <MultiSelect options={OPTIONS} selected={[]} onChange={() => {}} allLabel="Anyone" />,
    );
    expect(screen.getByRole("button", { name: /Anyone/i })).toBeInTheDocument();
  });

  it("shows the single label when one option is selected", () => {
    render(
      <MultiSelect
        options={OPTIONS}
        selected={["alice@x.com"]}
        onChange={() => {}}
        allLabel="Anyone"
      />,
    );
    // Use a regex anchored to a button so we don't catch <option> labels too.
    expect(screen.getByRole("button", { name: /Alice/ })).toBeInTheDocument();
  });

  it("shows '<first> +N' when multiple are selected", () => {
    render(
      <MultiSelect
        options={OPTIONS}
        selected={["alice@x.com", "bob@x.com", "carol@x.com"]}
        onChange={() => {}}
        allLabel="Anyone"
      />,
    );
    expect(screen.getByRole("button", { name: /Alice \+2/ })).toBeInTheDocument();
  });
});

describe("MultiSelect — toggling", () => {
  it("adds an option to selection on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MultiSelect options={OPTIONS} selected={[]} onChange={onChange} allLabel="Anyone" />,
    );
    await user.click(screen.getByRole("button", { name: /Anyone/ }));
    await user.click(screen.getByRole("option", { name: /Bob/ }));
    expect(onChange).toHaveBeenCalledWith(["bob@x.com"]);
  });

  it("removes an already-selected option on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MultiSelect
        options={OPTIONS}
        selected={["alice@x.com", "bob@x.com"]}
        onChange={onChange}
        allLabel="Anyone"
      />,
    );
    await user.click(screen.getByRole("button", { name: /Alice \+1/ }));
    await user.click(screen.getByRole("option", { name: /Alice/ }));
    expect(onChange).toHaveBeenCalledWith(["bob@x.com"]);
  });

  it("stays open after a click so multiple picks are easy", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelect options={OPTIONS} selected={[]} onChange={() => {}} allLabel="Anyone" />,
    );
    await user.click(screen.getByRole("button", { name: /Anyone/ }));
    await user.click(screen.getByRole("option", { name: /Alice/ }));
    // Panel listbox still mounted.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});

describe("MultiSelect — search", () => {
  it("filters options by case-insensitive label match", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelect options={OPTIONS} selected={[]} onChange={() => {}} allLabel="Anyone" />,
    );
    await user.click(screen.getByRole("button", { name: /Anyone/ }));
    const input = screen.getByPlaceholderText(/search/i);
    await user.type(input, "AL"); // case-insensitive
    expect(screen.getByRole("option", { name: /Alice/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Bob/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Carol/ })).not.toBeInTheDocument();
  });

  it("shows 'No matches' when nothing matches", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelect options={OPTIONS} selected={[]} onChange={() => {}} allLabel="Anyone" />,
    );
    await user.click(screen.getByRole("button", { name: /Anyone/ }));
    await user.type(screen.getByPlaceholderText(/search/i), "zzzz");
    expect(screen.getByText(/No matches/i)).toBeInTheDocument();
  });
});

describe("MultiSelect — clear button", () => {
  it("does not render the clear button when nothing is selected", () => {
    render(
      <MultiSelect options={OPTIONS} selected={[]} onChange={() => {}} allLabel="Anyone" />,
    );
    expect(screen.queryByLabelText(/Clear selection/i)).not.toBeInTheDocument();
  });

  it("calls onChange([]) when clear is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MultiSelect
        options={OPTIONS}
        selected={["alice@x.com"]}
        onChange={onChange}
        allLabel="Anyone"
      />,
    );
    await user.click(screen.getByLabelText(/Clear selection/i));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe("MultiSelect — close behaviors", () => {
  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelect options={OPTIONS} selected={[]} onChange={() => {}} allLabel="Anyone" />,
    );
    await user.click(screen.getByRole("button", { name: /Anyone/ }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button>outside</button>
        <MultiSelect options={OPTIONS} selected={[]} onChange={() => {}} allLabel="Anyone" />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: /Anyone/ }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /outside/ }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("MultiSelect — sorted dropdown", () => {
  it("floats checked options to the top of the panel", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelect
        options={OPTIONS}
        selected={["carol@x.com"]}
        onChange={() => {}}
        allLabel="Anyone"
      />,
    );
    await user.click(screen.getByRole("button", { name: /Carol/ }));
    const optionLabels = screen.getAllByRole("option").map((o) => o.textContent);
    // Carol was selected, so it should be first despite being 3rd in OPTIONS.
    expect(optionLabels[0]).toMatch(/Carol/);
  });

  it("does not reorder rows as you toggle within the open panel", async () => {
    const user = userEvent.setup();
    const Wrapper = () => {
      const [sel, setSel] = useState<string[]>([]);
      return (
        <MultiSelect options={OPTIONS} selected={sel} onChange={setSel} allLabel="Anyone" />
      );
    };
    render(<Wrapper />);
    await user.click(screen.getByRole("button", { name: /Anyone/ }));
    // Nothing was selected when the panel opened, so order stays as-authored
    // even after checking Dave.
    await user.click(screen.getByRole("option", { name: /Dave/ }));
    const optionLabels = screen.getAllByRole("option").map((o) => o.textContent);
    expect(optionLabels[0]).toMatch(/Alice/);
    expect(optionLabels[3]).toMatch(/Dave/);
  });
});

describe("MultiSelect — chips variant", () => {
  it("renders each selection as a removable chip plus an Add / edit row", () => {
    render(
      <MultiSelect
        variant="chips"
        options={OPTIONS}
        selected={["alice@x.com", "carol@x.com"]}
        onChange={() => {}}
        allLabel="No project assigned"
      />,
    );
    expect(screen.getByLabelText("Remove Alice")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Carol")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add \/ edit/ })).toBeInTheDocument();
  });

  it("removes a single selection when its chip ✕ is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MultiSelect
        variant="chips"
        options={OPTIONS}
        selected={["alice@x.com", "carol@x.com"]}
        onChange={onChange}
        allLabel="No project assigned"
      />,
    );
    await user.click(screen.getByLabelText("Remove Alice"));
    expect(onChange).toHaveBeenCalledWith(["carol@x.com"]);
  });

  it("opens the picker from the Add / edit row", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelect
        variant="chips"
        options={OPTIONS}
        selected={["alice@x.com"]}
        onChange={() => {}}
        allLabel="No project assigned"
      />,
    );
    await user.click(screen.getByRole("button", { name: /Add \/ edit/ }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("falls back to the summary trigger when nothing is selected", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelect
        variant="chips"
        options={OPTIONS}
        selected={[]}
        onChange={() => {}}
        allLabel="No project assigned"
      />,
    );
    // No chips / no Add-edit row — just the empty summary button.
    expect(screen.queryByRole("button", { name: /Add \/ edit/ })).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /No project assigned/ });
    await user.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});

describe("SingleSelect", () => {
  it("shows allLabel when nothing selected", () => {
    render(
      <SingleSelect options={OPTIONS} selected={null} onChange={() => {}} allLabel="Anyone" />,
    );
    expect(screen.getByRole("button", { name: /Anyone/ })).toBeInTheDocument();
  });

  it("shows the matching option's label when one is selected", () => {
    render(
      <SingleSelect
        options={OPTIONS}
        selected={"carol@x.com"}
        onChange={() => {}}
        allLabel="Anyone"
      />,
    );
    expect(screen.getByRole("button", { name: /Carol/ })).toBeInTheDocument();
  });

  it("sets the value and closes when picking an option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SingleSelect
        options={OPTIONS}
        selected={null}
        onChange={onChange}
        allLabel="Anyone"
      />,
    );
    await user.click(screen.getByRole("button", { name: /Anyone/ }));
    await user.click(screen.getByRole("option", { name: /Bob/ }));
    expect(onChange).toHaveBeenCalledWith("bob@x.com");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("clears to null when re-clicking the selected option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SingleSelect
        options={OPTIONS}
        selected={"alice@x.com"}
        onChange={onChange}
        allLabel="Anyone"
      />,
    );
    await user.click(screen.getByRole("button", { name: /Alice/ }));
    await user.click(screen.getByRole("option", { name: /Alice/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("clear button calls onChange(null)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SingleSelect
        options={OPTIONS}
        selected={"alice@x.com"}
        onChange={onChange}
        allLabel="Anyone"
      />,
    );
    await user.click(screen.getByLabelText(/Clear selection/i));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("search filters within the single-select panel too", async () => {
    const user = userEvent.setup();
    render(
      <SingleSelect options={OPTIONS} selected={null} onChange={() => {}} allLabel="Anyone" />,
    );
    await user.click(screen.getByRole("button", { name: /Anyone/ }));
    await user.type(screen.getByPlaceholderText(/search/i), "dav");
    expect(screen.getByRole("option", { name: /Dave/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Alice/ })).not.toBeInTheDocument();
  });
});

describe("option indicators", () => {
  // A checkbox promises "tick several". Picking a single-select option replaces
  // the previous choice and closes the panel, so it gets a bare check instead.
  it("gives multi-select options a tickable checkbox", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelect
        options={OPTIONS}
        selected={["carol@x.com"]}
        onChange={() => {}}
        allLabel="Anyone"
      />,
    );
    await user.click(screen.getByRole("button", { name: /Carol/ }));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(OPTIONS.length);
    // Every row has a box — that's what makes an unticked one look tickable.
    for (const option of options) {
      expect(option.querySelector('[data-indicator="checkbox"]')).not.toBeNull();
      expect(option.querySelector('[data-indicator="check"]')).toBeNull();
    }
  });

  it("gives single-select options no checkbox at all", async () => {
    const user = userEvent.setup();
    render(
      <SingleSelect
        options={OPTIONS}
        selected={"carol@x.com"}
        onChange={() => {}}
        allLabel="Anyone"
      />,
    );
    await user.click(screen.getByRole("button", { name: /Carol/ }));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(OPTIONS.length);
    for (const option of options) {
      expect(option.querySelector('[data-indicator="checkbox"]')).toBeNull();
    }
  });

  it("reserves the indicator's width on unselected single-select rows so labels line up", async () => {
    const user = userEvent.setup();
    render(
      <SingleSelect
        options={OPTIONS}
        selected={"carol@x.com"}
        onChange={() => {}}
        allLabel="Anyone"
      />,
    );
    await user.click(screen.getByRole("button", { name: /Carol/ }));
    for (const option of screen.getAllByRole("option")) {
      const slot = option.querySelector('[data-indicator="check"]');
      expect(slot).not.toBeNull();
      expect(slot).toHaveClass("h-4", "w-4", "shrink-0");
    }
  });

  it("marks only the current single-select row with a check mark", async () => {
    const user = userEvent.setup();
    render(
      <SingleSelect
        options={OPTIONS}
        selected={"carol@x.com"}
        onChange={() => {}}
        allLabel="Anyone"
      />,
    );
    await user.click(screen.getByRole("button", { name: /Carol/ }));
    const withCheck = screen
      .getAllByRole("option")
      .filter((o) => o.querySelector('[data-indicator="check"] svg') !== null)
      .map((o) => o.textContent);
    expect(withCheck).toEqual(["Carol"]);
  });

  it("keeps the selected row highlighted in both variants", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <SingleSelect
        options={OPTIONS}
        selected={"carol@x.com"}
        onChange={() => {}}
        allLabel="Anyone"
      />,
    );
    await user.click(screen.getByRole("button", { name: /Carol/ }));
    const singleRow = screen.getByRole("option", { name: /Carol/ });
    expect(singleRow).toHaveAttribute("aria-selected", "true");
    expect(singleRow).toHaveClass("bg-accent/10");
    expect(screen.getByRole("option", { name: /Alice/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    unmount();

    render(
      <MultiSelect
        options={OPTIONS}
        selected={["carol@x.com"]}
        onChange={() => {}}
        allLabel="Anyone"
      />,
    );
    await user.click(screen.getByRole("button", { name: /Carol/ }));
    const multiRow = screen.getByRole("option", { name: /Carol/ });
    expect(multiRow).toHaveAttribute("aria-selected", "true");
    expect(multiRow).toHaveClass("bg-accent/10");
  });
});

describe("ChoiceSelect", () => {
  const CHOICES = ["BACKLOG", "In Progress", "On Hold", "Blocked", "Complete"] as const;

  it("gives a plain choice field the same search box every other dropdown has", async () => {
    // The reason this wrapper exists: these were native <select>s, so scanning
    // was the only option (Ray, 2026-08-03).
    const user = userEvent.setup();
    render(
      <ChoiceSelect value="" onChange={() => {}} options={CHOICES} emptyLabel="Not set" />,
    );
    await user.click(screen.getByRole("button", { name: /Not set/ }));
    await user.type(screen.getByPlaceholderText(/search/i), "hold");

    expect(screen.getByRole("option", { name: "On Hold" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "BACKLOG" })).not.toBeInTheDocument();
  });

  it("reports the picked value as a plain string, not null", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ChoiceSelect value="" onChange={onChange} options={CHOICES} emptyLabel="Not set" />,
    );
    await user.click(screen.getByRole("button", { name: /Not set/ }));
    await user.click(screen.getByRole("option", { name: "Blocked" }));
    expect(onChange).toHaveBeenCalledWith("Blocked");
  });

  it("maps a cleared field back to the empty string the caller's state uses", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ChoiceSelect value="Blocked" onChange={onChange} options={CHOICES} emptyLabel="Not set" />,
    );
    await user.click(screen.getByLabelText(/clear selection/i));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("won't let a required field be emptied", async () => {
    // A task's Status has to hold something — re-picking it must not blank it.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ChoiceSelect
        value="Blocked"
        onChange={onChange}
        options={CHOICES}
        emptyLabel="Not set"
        clearable={false}
      />,
    );
    expect(screen.queryByLabelText(/clear selection/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Blocked/ }));
    await user.click(screen.getByRole("option", { name: "Blocked" }));
    expect(onChange).toHaveBeenCalledWith("Blocked");
    expect(onChange).not.toHaveBeenCalledWith("");
  });

  it("takes {value,label} pairs, for lookups whose label isn't the value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ChoiceSelect
        value=""
        onChange={onChange}
        options={[{ value: "17", label: "0042 - EZRail" }]}
        emptyLabel="None"
      />,
    );
    await user.click(screen.getByRole("button", { name: /None/ }));
    await user.click(screen.getByRole("option", { name: "0042 - EZRail" }));
    expect(onChange).toHaveBeenCalledWith("17");
  });

  it("inherits the single-select's bare check mark, not a checkbox", async () => {
    const user = userEvent.setup();
    render(
      <ChoiceSelect value="Blocked" onChange={() => {}} options={CHOICES} emptyLabel="Not set" />,
    );
    await user.click(screen.getByRole("button", { name: /Blocked/ }));
    for (const option of screen.getAllByRole("option")) {
      expect(option.querySelector('[data-indicator="checkbox"]')).toBeNull();
      expect(option.querySelector('[data-indicator="check"]')).not.toBeNull();
    }
  });

  it("can't be opened while the form is saving", async () => {
    const user = userEvent.setup();
    render(
      <ChoiceSelect
        value=""
        onChange={() => {}}
        options={CHOICES}
        emptyLabel="Not set"
        disabled
      />,
    );
    const trigger = screen.getByRole("button", { name: /Not set/ });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
  });
});
