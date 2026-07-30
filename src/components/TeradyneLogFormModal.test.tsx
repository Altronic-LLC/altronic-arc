import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { TeradyneLogFormModal, clockOptionsWith } from "./TeradyneLogFormModal";

// USE_MOCK is true under Vitest — the pickers read the mock reference lists.
// Melissa Fuentes is clock #88, Dave Anderson #312, Sandy Bindas #189.

beforeEach(() => {
  vi.restoreAllMocks();
});

/**
 * Open the picker labelled `label` and choose `option`. Takes the FIRST button
 * in the field: once something is selected the trigger grows a clear (X) button
 * beside it, so a bare getByRole("button") would be ambiguous on the second
 * visit to the same picker.
 */
async function pick(label: RegExp, option: RegExp) {
  const field = screen.getByText(label).closest("label")!;
  await userEvent.click(within(field).getAllByRole("button")[0]);
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

/** What a picker currently reads as — the trigger button's own text. */
function summaryOf(label: RegExp): string {
  const field = screen.getByText(label).closest("label")!;
  return within(field).getAllByRole("button")[0].textContent ?? "";
}

function clockText(which: 1 | 2): string {
  return summaryOf(which === 1 ? /employee 1 clock/i : /employee 2 clock/i);
}

function employeeText(which: 1 | 2): string {
  return summaryOf(which === 1 ? /^employee 1$/i : /^employee 2$/i);
}

async function renderForm() {
  const result = renderWithProviders(<TeradyneLogFormModal onClose={vi.fn()} />);
  // Wait for the reference lists so the pickers have options.
  await waitFor(() =>
    expect(screen.getByText(/entry name \(built automatically\)/i)).toBeInTheDocument(),
  );
  return result;
}

describe("TeradyneLogFormModal — name and clock fill each other", () => {
  it("fills Employee 1 Clock from the employee's record when a name is picked", async () => {
    await renderForm();
    expect(clockText(1)).toMatch(/pick a clock number/i);

    await pick(/^employee 1$/i, /Melissa Fuentes/);
    await waitFor(() => expect(clockText(1)).toContain("88"));
  });

  it("fills Employee 1 from the clock number when a number is picked", async () => {
    // The reverse direction: on the floor people identify themselves by number.
    await renderForm();
    await pick(/employee 1 clock/i, /^#88 · Melissa Fuentes$/);

    await waitFor(() => expect(employeeText(1)).toContain("Melissa Fuentes"));
    expect(clockText(1)).toContain("88");
  });

  it("fills the Employee 2 slot independently of Employee 1", async () => {
    await renderForm();
    await pick(/^employee 1$/i, /Melissa Fuentes/);
    await pick(/employee 2 clock/i, /^#312 · Dave Anderson$/);

    await waitFor(() => expect(employeeText(2)).toContain("Dave Anderson"));
    // Slot 1 untouched by slot 2's pick.
    expect(clockText(1)).toContain("88");
    expect(employeeText(1)).toContain("Melissa Fuentes");
  });

  it("replaces the clock number when the employee is changed", async () => {
    await renderForm();
    await pick(/^employee 1$/i, /Melissa Fuentes/);
    await waitFor(() => expect(clockText(1)).toContain("88"));

    await pick(/^employee 1$/i, /Sandy Bindas/);
    await waitFor(() => expect(clockText(1)).toContain("189"));
  });

  it("replaces the employee when the clock number is changed", async () => {
    await renderForm();
    await pick(/^employee 1$/i, /Melissa Fuentes/);
    await waitFor(() => expect(clockText(1)).toContain("88"));

    await pick(/employee 1 clock/i, /^#189 · Sandy Bindas$/);
    await waitFor(() => expect(employeeText(1)).toContain("Sandy Bindas"));
  });

  it("clears the clock number when the employee is cleared", async () => {
    await renderForm();
    await pick(/^employee 1$/i, /Melissa Fuentes/);
    await waitFor(() => expect(clockText(1)).toContain("88"));

    // Re-picking the selected option clears a SingleSelect.
    await pick(/^employee 1$/i, /Melissa Fuentes/);
    await waitFor(() => expect(clockText(1)).toMatch(/pick a clock number/i));
  });

  it("clears the employee when the clock number is cleared — they're one person", async () => {
    await renderForm();
    await pick(/^employee 1$/i, /Melissa Fuentes/);
    await waitFor(() => expect(clockText(1)).toContain("88"));

    await pick(/employee 1 clock/i, /^#88 · Melissa Fuentes$/);
    await waitFor(() => expect(employeeText(1)).toMatch(/nobody/i));
    expect(clockText(1)).toMatch(/pick a clock number/i);
  });

  it("still offers no way to TYPE a clock number — it comes from the Employees list", async () => {
    await renderForm();
    const field = screen.getByText(/employee 1 clock/i).closest("label")!;
    expect(within(field).queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(within(field).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("labels each clock option with whose number it is", async () => {
    await renderForm();
    const field = screen.getByText(/employee 1 clock/i).closest("label")!;
    await userEvent.click(within(field).getAllByRole("button")[0]);
    expect(await screen.findByRole("option", { name: "#88 · Melissa Fuentes" })).toBeInTheDocument();
  });
});

describe("clockOptionsWith", () => {
  const options = [
    { value: "88", label: "#88 · Melissa Fuentes" },
    { value: "312", label: "#312 · Dave Anderson" },
  ];

  it("leaves the list alone when the stored number is one of them", () => {
    expect(clockOptionsWith(options, "88")).toBe(options);
    expect(clockOptionsWith(options, "")).toBe(options);
  });

  it("keeps an old entry's unrecognised number visible instead of blanking it", () => {
    // Otherwise the entry looks like it never had a clock number, and saving
    // would quietly agree.
    const withStored = clockOptionsWith(options, "9001");
    expect(withStored[0]).toEqual({ value: "9001", label: "#9001 · not on the employee list" });
    expect(withStored).toHaveLength(3);
  });
});

describe("TeradyneLogFormModal — finding an employee", () => {
  it("finds an employee by their clock number as well as their name", async () => {
    // People on the floor identify themselves by either, so the clock number is
    // in the option label — which is what the picker filters on.
    await renderForm();
    const field = screen.getByText(/^employee 1$/i).closest("label")!;
    await userEvent.click(within(field).getAllByRole("button")[0]);

    await userEvent.type(screen.getByPlaceholderText(/name or clock number/i), "88");
    expect(await screen.findByRole("option", { name: /Melissa Fuentes/ })).toBeInTheDocument();
  });

  it("still finds them by name", async () => {
    await renderForm();
    const field = screen.getByText(/^employee 1$/i).closest("label")!;
    await userEvent.click(within(field).getAllByRole("button")[0]);

    await userEvent.type(screen.getByPlaceholderText(/name or clock number/i), "Bindas");
    expect(await screen.findByRole("option", { name: /Sandy Bindas/ })).toBeInTheDocument();
  });

  it("shows the clock number and work centre alongside the name", async () => {
    await renderForm();
    const field = screen.getByText(/^employee 1$/i).closest("label")!;
    await userEvent.click(within(field).getAllByRole("button")[0]);
    expect(
      await screen.findByRole("option", { name: "Melissa Fuentes · #88 · PCB" }),
    ).toBeInTheDocument();
  });
});

describe("TeradyneLogFormModal — part numbers", () => {
  it("labels the field Altronic Part Number, not Old SAP Number", async () => {
    await renderForm();
    expect(screen.getByText(/^altronic part number$/i)).toBeInTheDocument();
    expect(screen.queryByText(/old sap/i)).not.toBeInTheDocument();
  });

  it("keeps it separate from the SAP number field", async () => {
    await renderForm();
    const sap = within(screen.getByText(/^sap number$/i).closest("label")!).getByRole("textbox");
    const part = within(
      screen.getByText(/^altronic part number$/i).closest("label")!,
    ).getByRole("textbox");

    await userEvent.type(sap, "601999");
    await userEvent.type(part, "672337-1");
    expect(sap).toHaveValue("601999");
    expect(part).toHaveValue("672337-1");
  });
});

describe("TeradyneLogFormModal — derived name", () => {
  it("previews the entry name as the product and defective parts are set", async () => {
    await renderForm();
    await pick(/^product \*$/i, /Moris Power Supply/);
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. U1/i), "U7");
    expect(await screen.findByText("Moris Power Supply - U7")).toBeInTheDocument();
  });

  it("refuses to save without a product, since the name is built from it", async () => {
    const onClose = vi.fn();
    renderWithProviders(<TeradyneLogFormModal onClose={onClose} />);
    await waitFor(() =>
      expect(screen.getByText(/entry name \(built automatically\)/i)).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: /add entry/i }));
    // Distinct from the picker's own "Pick a product" placeholder.
    expect(await screen.findByText(/choose a product above/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
