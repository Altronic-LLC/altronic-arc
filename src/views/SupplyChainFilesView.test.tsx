import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetSupplyChainFilesMock } from "@/api/supplyChainFiles";
import { SupplyChainFilesView } from "./SupplyChainFilesView";

const ROUTE = "/supply-chain/files";

beforeEach(() => {
  __resetSupplyChainFilesMock();
});

describe("SupplyChainFilesView", () => {
  it("opens on the folder root with folders first and the root breadcrumb", async () => {
    renderWithProviders(<SupplyChainFilesView />, { route: ROUTE });
    const t = within(await screen.findByRole("table"));
    const names = t.getAllByRole("row").slice(1).map((r) => r.querySelector("td")?.textContent);
    expect(names.slice(0, 2)).toEqual(["Forms", "Supplier Audits"]);
    expect(names).toContain("Approved Supplier List.xlsx");
    const crumbs = screen.getByRole("navigation", { name: "Folder path" });
    expect(within(crumbs).getByText("Supply Chain Files")).toHaveAttribute("aria-current", "page");
  });

  it("creates a subfolder, renames it, then deletes it", async () => {
    renderWithProviders(<SupplyChainFilesView />, { route: ROUTE });
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: /New folder/ }));
    await userEvent.type(screen.getByLabelText("New folder name"), "Contracts{Enter}");
    const t = within(await screen.findByRole("table"));
    expect(await t.findByRole("button", { name: "Contracts" })).toBeInTheDocument();

    await userEvent.click(t.getByRole("button", { name: "Rename Contracts" }));
    const input = await screen.findByLabelText("New name");
    await userEvent.clear(input);
    await userEvent.type(input, "Agreements{Enter}");
    expect(await within(await screen.findByRole("table")).findByRole("button", { name: "Agreements" })).toBeInTheDocument();

    await userEvent.click(
      within(await screen.findByRole("table")).getByRole("button", { name: "Delete Agreements" }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(within(screen.getByRole("table")).queryByRole("button", { name: "Agreements" })).toBeNull(),
    );
  });
});
