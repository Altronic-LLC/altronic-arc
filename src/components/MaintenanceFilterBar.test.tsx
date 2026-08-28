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
      departments={["MACH SHOP", "SMT"]}
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
    for (const label of ["Equipment", "Assigned", "Category", "Department", "Search"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  // Never a native <select> anywhere in ARC.
  it("uses searchable dropdowns, not native selects", () => {
    const { container } = renderBar();
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelectorAll('[aria-haspopup="listbox"]')).toHaveLength(4);
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

  it("picks a department", async () => {
    const { onChange } = renderBar();
    await userEvent.click(trigger("Department"));
    await userEvent.click(screen.getByText("SMT"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ departments: ["SMT"] }));
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
