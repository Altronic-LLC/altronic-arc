import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetSalesDocumentationMock } from "@/api/salesDocumentation";
import { SalesDocumentationView } from "./SalesDocumentationView";

const ROUTE = "/sales/documentation";

beforeEach(() => {
  __resetSalesDocumentationMock();
});

describe("SalesDocumentationView", () => {
  it("opens on the folder root with folders first and the root breadcrumb", async () => {
    renderWithProviders(<SalesDocumentationView />, { route: ROUTE });
    const t = within(await screen.findByRole("table"));
    const names = t.getAllByRole("row").slice(1).map((r) => r.querySelector("td")?.textContent);
    expect(names.slice(0, 2)).toEqual(["00_Completed - PDFs", "01_Completed - Design Files"]);
    expect(names).toContain("Altronic Brand Guidelines 2025.01.pdf");
    const crumbs = screen.getByRole("navigation", { name: "Folder path" });
    expect(within(crumbs).getByText("Sales Documentation")).toHaveAttribute("aria-current", "page");
  });

  it("creates a subfolder, renames it, then deletes it", async () => {
    renderWithProviders(<SalesDocumentationView />, { route: ROUTE });
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: /New folder/ }));
    await userEvent.type(screen.getByLabelText("New folder name"), "Catalogs{Enter}");
    const t = within(await screen.findByRole("table"));
    expect(await t.findByRole("button", { name: "Catalogs" })).toBeInTheDocument();

    await userEvent.click(t.getByRole("button", { name: "Rename Catalogs" }));
    const input = await screen.findByLabelText("New name");
    await userEvent.clear(input);
    await userEvent.type(input, "Brochures{Enter}");
    expect(
      await within(await screen.findByRole("table")).findByRole("button", { name: "Brochures" }),
    ).toBeInTheDocument();

    await userEvent.click(
      within(await screen.findByRole("table")).getByRole("button", { name: "Delete Brochures" }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(within(screen.getByRole("table")).queryByRole("button", { name: "Brochures" })).toBeNull(),
    );
  });
});
