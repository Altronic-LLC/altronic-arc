import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { listHarnessLog, resetHarnessLogMockStore } from "@/api/harnessProductionLog";
import { MOCK_HARNESS_LOG, MOCK_HARNESS_PART_NUMBERS } from "@/data/harnessMockData";
import { HarnessLogFormModal, harnessPartOptions } from "./HarnessLogFormModal";

const adminAccess = vi.hoisted(() => ({ isAdmin: false, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));

beforeEach(() => {
  resetHarnessLogMockStore();
  adminAccess.isAdmin = false;
});

describe("harnessPartOptions", () => {
  it("offers active parts only", () => {
    const values = harnessPartOptions(MOCK_HARNESS_PART_NUMBERS, null).map((o) => o.label);
    expect(values).not.toContain("593030-18 (retired)");
    expect(values).toContain("EC93005-5 — Waukesha 295495F");
  });

  it("keeps an entry's retired part in its own picker", () => {
    expect(harnessPartOptions(MOCK_HARNESS_PART_NUMBERS, 8).map((o) => o.label)).toContain("593030-18 (retired)");
  });

  it("keeps a part that has gone from the list", () => {
    expect(harnessPartOptions(MOCK_HARNESS_PART_NUMBERS, 99, "OLD-1")[0]).toEqual({
      value: "99",
      label: "OLD-1 (not on the list)",
    });
  });
});

describe("HarnessLogFormModal", () => {
  it("refuses to save without a part, then adds the entry", async () => {
    const onClose = vi.fn();
    renderWithProviders(<HarnessLogFormModal onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "New harness entry" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Add entry" }));
    expect(within(dialog).getByText(/Pick the part number/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Part Number" }));
    await userEvent.click(await screen.findByRole("option", { name: /^783001$/ }));
    await userEvent.type(within(dialog).getByRole("spinbutton", { name: /^Qty/ }), "12");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /work order/i }), "1002999999");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add entry" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const { entries } = await listHarnessLog({ kind: "all" });
    expect(entries.find((e) => e.workOrder === "1002999999")).toMatchObject({
      part: { title: "783001" },
      quantity: 12,
      reworkQuantity: 0,
    });
  });

  it("refuses more rework than was built", async () => {
    renderWithProviders(<HarnessLogFormModal entry={MOCK_HARNESS_LOG[0]} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Edit harness entry" });
    const rework = within(dialog).getByRole("spinbutton", { name: /Rework/ });
    await userEvent.clear(rework);
    await userEvent.type(rework, "99");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(within(dialog).getByText(/Rework can't be more/)).toBeInTheDocument();
  });

  it("shows what the import changed on an edited row", () => {
    const imported = MOCK_HARNESS_LOG.find((e) => e.dataQualityNotes)!;
    renderWithProviders(<HarnessLogFormModal entry={imported} onClose={() => {}} />);
    expect(screen.getByText(/Changed when imported/)).toBeInTheDocument();
  });

  it("points an admin at the part numbers, and anyone else at an admin", () => {
    renderWithProviders(<HarnessLogFormModal onClose={() => {}} />);
    expect(screen.getByText(/Ask an ARC admin/)).toBeInTheDocument();
  });

  it("gives an admin a link to add a part", () => {
    adminAccess.isAdmin = true;
    renderWithProviders(<HarnessLogFormModal onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /add it to the part numbers/i })).toBeInTheDocument();
  });
});
