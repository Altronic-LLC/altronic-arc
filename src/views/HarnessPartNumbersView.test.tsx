import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { resetHarnessPartMockStore } from "@/api/harnessPartNumbers";
import { HarnessPartNumbersView } from "./HarnessPartNumbersView";

const adminAccess = vi.hoisted(() => ({ isAdmin: true, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));

beforeEach(() => {
  resetHarnessPartMockStore();
  adminAccess.isAdmin = true;
});

async function renderView() {
  renderWithProviders(<HarnessPartNumbersView />, { route: "/operations/harness-log/part-numbers" });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return screen.getByRole("table");
}

describe("HarnessPartNumbersView", () => {
  it("lists active part numbers, and retired ones on request", async () => {
    const table = await renderView();
    expect(within(table).getByText("593027-15")).toBeInTheDocument();
    expect(within(table).queryByText("593030-18")).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/Show 1 retired/));
    expect(within(screen.getByRole("table")).getByText("593030-18")).toBeInTheDocument();
  });

  it("shows how many entries use each part", async () => {
    const table = await renderView();
    const row = within(table).getByText("593075-1").closest("tr")!;
    await waitFor(() => expect(within(row).getByText("2")).toBeInTheDocument());
  });

  it("is read-only for anyone who isn't an ARC admin", async () => {
    adminAccess.isAdmin = false;
    const table = await renderView();
    expect(screen.getByRole("button", { name: /add part number/i })).toBeDisabled();
    expect(within(table).getByRole("button", { name: "Edit 593027-15" })).toBeDisabled();
    expect(within(table).getByRole("button", { name: "Retire 593027-15" })).toBeDisabled();
    expect(screen.getByText(/Only ARC admins can change part numbers/)).toBeInTheDocument();
  });

  it("lets an admin add a part number", async () => {
    await renderView();
    await userEvent.click(screen.getByRole("button", { name: /add part number/i }));
    const dialog = screen.getByRole("dialog", { name: "Add part number" });
    await userEvent.type(within(dialog).getByLabelText(/Part Number/), "ec93099-1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("EC93099-1")).toBeInTheDocument());
  });

  it("shows a duplicate refusal in the dialog", async () => {
    await renderView();
    await userEvent.click(screen.getByRole("button", { name: /add part number/i }));
    const dialog = screen.getByRole("dialog", { name: "Add part number" });
    await userEvent.type(within(dialog).getByLabelText(/Part Number/), "593027-15");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/already on the list/)).toBeInTheDocument();
  });

  it("lets an admin retire a part number", async () => {
    const table = await renderView();
    await userEvent.click(within(table).getByRole("button", { name: "Retire 593027-15" }));
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("593027-15")).not.toBeInTheDocument());
  });
});
