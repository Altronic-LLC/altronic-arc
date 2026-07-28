import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { TeradyneLogFormModal } from "./TeradyneLogFormModal";

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

/** The clock number is displayed, not editable — read its rendered text. */
function clockText(which: 1 | 2): string {
  const label = which === 1 ? /employee 1 clock/i : /employee 2 clock/i;
  const field = screen.getByText(label).closest("label")!;
  return within(field).getByRole("status").textContent ?? "";
}

async function renderForm() {
  const result = renderWithProviders(<TeradyneLogFormModal onClose={vi.fn()} />);
  // Wait for the reference lists so the pickers have options.
  await waitFor(() =>
    expect(screen.getByText(/entry name \(built automatically\)/i)).toBeInTheDocument(),
  );
  return result;
}

describe("TeradyneLogFormModal — clock auto-fill", () => {
  it("fills Employee 1 Clock from the employee's record when one is picked", async () => {
    await renderForm();
    expect(clockText(1)).toMatch(/pick an employee/i);

    await pick(/^employee 1$/i, /Melissa Fuentes/);
    await waitFor(() => expect(clockText(1)).toBe("88"));
  });

  it("fills the Employee 2 slot independently of Employee 1", async () => {
    await renderForm();
    await pick(/^employee 1$/i, /Melissa Fuentes/);
    await pick(/^employee 2$/i, /Dave Anderson/);

    await waitFor(() => expect(clockText(2)).toBe("312"));
    // Slot 1 untouched by slot 2's pick.
    expect(clockText(1)).toBe("88");
  });

  it("replaces the clock number when the employee is changed", async () => {
    await renderForm();
    await pick(/^employee 1$/i, /Melissa Fuentes/);
    await waitFor(() => expect(clockText(1)).toBe("88"));

    await pick(/^employee 1$/i, /Sandy Bindas/);
    await waitFor(() => expect(clockText(1)).toBe("189"));
  });

  it("clears the clock number when the employee is cleared", async () => {
    await renderForm();
    await pick(/^employee 1$/i, /Melissa Fuentes/);
    await waitFor(() => expect(clockText(1)).toBe("88"));

    // Re-picking the selected option clears a SingleSelect.
    await pick(/^employee 1$/i, /Melissa Fuentes/);
    await waitFor(() => expect(clockText(1)).toMatch(/pick an employee/i));
  });

  it("offers no way to type a clock number — it belongs to the employee record", async () => {
    await renderForm();
    await pick(/^employee 1$/i, /Melissa Fuentes/);
    await waitFor(() => expect(clockText(1)).toBe("88"));

    const field = screen.getByText(/employee 1 clock/i).closest("label")!;
    expect(within(field).queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(within(field).queryByRole("textbox")).not.toBeInTheDocument();
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
