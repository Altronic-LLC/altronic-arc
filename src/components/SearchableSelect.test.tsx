import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MultiSelect, SingleSelect, type SelectOption } from "./SearchableSelect";

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
