import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MaintenanceFilterBar } from "./MaintenanceFilterBar";
import { resetOpenDropdown } from "./useDropdownClose";
import { EMPTY_MAINTENANCE_FILTERS, UNASSIGNED_FILTER_KEY } from "@/lib/maintenanceFilters";
import { OTHER_TECH, TECH } from "@/test/maintenanceFixtures";

const EQUIPMENT = [
  { lookupId: 3, title: "40 HP COMPRESSOR" },
  { lookupId: 8, title: "REFLOW OVEN" },
];

function renderBar(overrides: Partial<typeof EMPTY_MAINTENANCE_FILTERS> = {}) {
  const onChange = vi.fn();
  const rendered = render(
    <MaintenanceFilterBar
      filters={{ ...EMPTY_MAINTENANCE_FILTERS, ...overrides }}
      onChange={onChange}
      equipment={EQUIPMENT}
      people={[TECH, OTHER_TECH]}
      departments={[
        { lookupId: 4, title: "MACH SHOP" },
        { lookupId: 8, title: "SMT" },
      ]}
    />,
  );
  return { onChange, ...rendered };
}

function trigger(label: string): HTMLElement {
  const bar = screen.getByRole("search", { name: /work order filters/i });
  const field = within(bar).getByText(label).closest("label") as HTMLElement;
  return field.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
}

describe("MaintenanceFilterBar", () => {
  // A claim left by a previous test closes the dropdown under test.
  beforeEach(() => resetOpenDropdown());

  it("offers every axis", () => {
    renderBar();
    for (const label of ["Type", "Equipment", "Assigned", "Category", "Department", "Search"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  // Never a native <select> anywhere in ARC.
  it("uses searchable dropdowns, not native selects", () => {
    const { container } = renderBar();
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelectorAll('[aria-haspopup="listbox"]')).toHaveLength(4);
  });

  // Three options, so pills — never a dropdown (CLAUDE.md, "A short choice
  // list is pills"), and the same three the calendar offers.
  describe("the Type axis", () => {
    function typePills(): HTMLElement {
      return screen.getByRole("radiogroup", { name: /type/i });
    }

    it("renders as pills, with the calendar's labels", () => {
      renderBar();
      const labels = within(typePills())
        .getAllByRole("radio")
        .map((r) => (r.closest("label") as HTMLElement).textContent);
      expect(labels).toEqual(["Both", "Scheduled", "One-off"]);
    });

    // It is not a sixth dropdown: the count below is what pins that.
    it("adds no dropdown to the bar", () => {
      const { container } = renderBar();
      expect(container.querySelectorAll('[aria-haspopup="listbox"]')).toHaveLength(4);
    });

    it("starts on Both", () => {
      renderBar();
      expect(within(typePills()).getByRole("radio", { name: "Both" })).toBeChecked();
    });

    it("reports the picked value", async () => {
      const { onChange } = renderBar();
      await userEvent.click(within(typePills()).getByRole("radio", { name: "Scheduled" }));
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: "scheduled" }));
    });

    it("goes back to Both, which is the empty value", async () => {
      const { onChange } = renderBar({ type: "one-off" });
      expect(within(typePills()).getByRole("radio", { name: "One-off" })).toBeChecked();
      await userEvent.click(within(typePills()).getByRole("radio", { name: "Both" }));
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: "" }));
    });

    // A pill group carries its own labels; nesting it in a <label> would make
    // the outer one steal the click (CLAUDE.md).
    it("does not sit inside a <label>", () => {
      renderBar();
      expect(typePills().closest("label")).toBeNull();
    });
  });

  it("picks an asset by lookupId", async () => {
    const { onChange } = renderBar();
    await userEvent.click(trigger("Equipment"));
    await userEvent.click(screen.getByText("REFLOW OVEN"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ equipmentIds: [8] }),
    );
  });

  // On a shop floor, "what has nobody picked up" is the most useful thing to
  // filter TO — and "no selection" already means "anyone", so it needs to be
  // an option rather than the absence of one.
  it("offers Unassigned first in the Assigned picker", async () => {
    const { onChange } = renderBar();
    await userEvent.click(trigger("Assigned"));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options[0]).toContain("Unassigned");
    await userEvent.click(screen.getByText("Unassigned"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ assignedEmails: [UNASSIGNED_FILTER_KEY] }),
    );
  });

  // personKey, so the option's value matches what applyMaintenanceFilters
  // compares against — a raw email drifts in case between SharePoint and MSAL.
  it("keys people by their lowercased address", async () => {
    const { onChange } = renderBar();
    await userEvent.click(trigger("Assigned"));
    await userEvent.click(screen.getByText("David Bulkley"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ assignedEmails: ["david.bulkley@altronic-llc.com"] }),
    );
  });

  it("picks a category", async () => {
    const { onChange } = renderBar();
    await userEvent.click(trigger("Category"));
    await userEvent.click(screen.getByText("Calibration"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ categories: ["Calibration"] }),
    );
  });

  it("picks a department by its LOOKUP id, showing its name", async () => {
    // Department became a lookup on 2026-08-28: the option's VALUE is the
    // lookupId, so a rename in Admin carries every filtered link with it, and
    // only the label is the name.
    const { onChange } = renderBar();
    await userEvent.click(trigger("Department"));
    await userEvent.click(screen.getByText("SMT"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ departments: ["8"] }));
  });

  it("shows a department it can only name by id rather than an empty option", () => {
    render(
      <MaintenanceFilterBar
        filters={EMPTY_MAINTENANCE_FILTERS}
        onChange={() => {}}
        equipment={[]}
        people={[]}
        departments={[{ lookupId: 41, title: "" }]}
      />,
    );
    return userEvent.click(trigger("Department")).then(() => {
      expect(screen.getByText("#41")).toBeInTheDocument();
    });
  });

  it("shows an asset with no title by its id rather than blank", async () => {
    render(
      <MaintenanceFilterBar
        filters={EMPTY_MAINTENANCE_FILTERS}
        onChange={() => {}}
        equipment={[{ lookupId: 42, title: "" }]}
        people={[]}
        departments={[]}
      />,
    );
    await userEvent.click(trigger("Equipment"));
    expect(screen.getByText("Asset #42")).toBeInTheDocument();
  });
});
