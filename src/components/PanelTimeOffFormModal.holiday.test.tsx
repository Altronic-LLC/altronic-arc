import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// Company holidays on the Time Off form (demo mode): only a panel Super User
// or an ARC admin sees the box; ticking it drops the person, and the entry
// saves with nobody named. Anyone else sees a holiday read-only.

vi.mock("@/hooks/useDirectory", () => ({ useDirectoryPeople: () => [] }));

import { listPanelTimeOff, resetPanelTimeOffMockStore } from "@/api/panelTimeOff";
import { PanelTimeOffFormModal } from "./PanelTimeOffFormModal";

beforeEach(() => resetPanelTimeOffMockStore());

const DAY = new Date("2026-12-25T12:00:00Z");

describe("PanelTimeOffFormModal: company holiday", () => {
  it("isn't offered to anyone but a Super User or ARC admin", () => {
    renderWithProviders(
      <PanelTimeOffFormModal canEdit canManageHolidays={false} defaultDate={DAY} onClose={() => {}} />,
    );
    expect(screen.queryByRole("checkbox", { name: /company holiday/i })).not.toBeInTheDocument();
    expect(screen.getByText("Who")).toBeInTheDocument();
  });

  it("drops the person and saves a holiday for everyone", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <PanelTimeOffFormModal canEdit canManageHolidays defaultDate={DAY} onClose={onClose} />,
    );
    await user.click(screen.getByRole("checkbox", { name: /company holiday/i }));
    expect(screen.queryByText("Who")).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/Vacation, training/), "Christmas");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const saved = (await listPanelTimeOff()).find((e) => e.reason === "Christmas");
    expect(saved).toMatchObject({ companyHoliday: true, person: null });
  });

  it("shows an existing holiday read-only to anyone else", async () => {
    const holiday = (await listPanelTimeOff()).find((e) => e.companyHoliday);
    expect(holiday).toBeTruthy();
    renderWithProviders(
      <PanelTimeOffFormModal entry={holiday} canEdit canManageHolidays={false} onClose={() => {}} />,
    );
    expect(screen.getByText(/Only a panel Super User or an ARC admin can change it/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Vacation, training/)).toBeDisabled();
  });
});
