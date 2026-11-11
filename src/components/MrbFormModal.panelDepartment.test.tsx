import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// =============================================================================
// New MRB entry — the Panel department flag (BusinessIT#71).
//
// It starts at No, so nothing is attributed to the panel department that
// nobody said came from there, and choosing Yes reaches the create as a real
// boolean.
// =============================================================================

const createMrbEntry = vi.hoisted(() => vi.fn());
vi.mock("@/api/mrb", () => ({
  createMrbEntry,
  listMrbEntries: vi.fn().mockResolvedValue([]),
}));

import { MrbFormModal } from "./MrbFormModal";

beforeEach(() => {
  createMrbEntry.mockReset();
  createMrbEntry.mockImplementation(async (input) => ({ id: 99, ...input }));
});

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/SAP Number/), "1014-1023-00");
  await user.type(screen.getByLabelText(/^Reason/), "Insert rotated 180 degrees");
}

function panelPills() {
  return screen.getByRole("radiogroup", { name: "Panel department" });
}

describe("MrbFormModal — Panel department", () => {
  it("starts at No", () => {
    renderWithProviders(<MrbFormModal onClose={vi.fn()} />);
    expect(within(panelPills()).getByRole("radio", { name: "No" })).toBeChecked();
    expect(within(panelPills()).getByRole("radio", { name: "Yes" })).not.toBeChecked();
  });

  it("logs an entry as NOT from the panel department when left alone", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrbFormModal onClose={vi.fn()} />);
    await fillRequired(user);

    await user.click(screen.getByRole("button", { name: /Log entry/ }));

    await waitFor(() => expect(createMrbEntry).toHaveBeenCalled());
    expect(createMrbEntry.mock.calls[0][0].panelDepartment).toBe(false);
  });

  it("logs an entry as from the panel department when Yes is picked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrbFormModal onClose={vi.fn()} />);
    await fillRequired(user);

    await user.click(within(panelPills()).getByRole("radio", { name: "Yes" }));
    await user.click(screen.getByRole("button", { name: /Log entry/ }));

    await waitFor(() => expect(createMrbEntry).toHaveBeenCalled());
    expect(createMrbEntry.mock.calls[0][0].panelDepartment).toBe(true);
  });
});
