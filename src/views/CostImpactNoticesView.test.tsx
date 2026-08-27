import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CostImpactNoticesView } from "./CostImpactNoticesView";

async function renderList(search = "") {
  const result = renderWithProviders(<CostImpactNoticesView />, {
    route: `/supply-chain/cost-impact-notices${search}`,
    routePattern: "/supply-chain/cost-impact-notices",
  });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return result;
}

describe("CostImpactNoticesView", () => {
  it("lists the notices", async () => {
    await renderList();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getByText("DATA LOGGING MODULE")).toBeInTheDocument();
  });

  it("shows the delta cost as a chip", async () => {
    await renderList();
    expect(screen.getByText("+$421.85")).toBeInTheDocument();
  });

  it("searches by supplier and part", async () => {
    await renderList();
    await userEvent.type(screen.getByPlaceholderText(/part, supplier, sap number/i), "Flexcore");
    await waitFor(() =>
      expect(screen.queryByText("DATA LOGGING MODULE")).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/CURRENT TRANSFORMER/i)).toBeInTheDocument();
  });

  it("filters by Time of Impact", async () => {
    await renderList();
    const bar = screen.getByRole("search", { name: /cost impact notice filters/i });
    const field = within(bar).getByText("Time of Impact").closest("label") as HTMLElement;
    await userEvent.click(field.querySelector('[aria-haspopup="listbox"]') as HTMLElement);
    await userEvent.click(await screen.findByRole("option", { name: "Immediate" }));
    expect(screen.queryByText("DATA LOGGING MODULE")).not.toBeInTheDocument();
    expect(screen.getByText(/CURRENT TRANSFORMER/i)).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    await renderList();
    await userEvent.type(screen.getByPlaceholderText(/part, supplier, sap number/i), "zzzznothing");
    await waitFor(() =>
      expect(screen.getByText(/no notices match these filters/i)).toBeInTheDocument(),
    );
  });

  it("opens the new-notice form", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /new notice/i }));
    expect(await screen.findByRole("dialog", { name: /new cost impact notice/i })).toBeInTheDocument();
  });
});
