import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CostImpactNoticeDetailView } from "./CostImpactNoticeDetailView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

async function renderDetail(id = 1) {
  const result = renderWithProviders(<CostImpactNoticeDetailView />, {
    route: `/supply-chain/cost-impact-notice/${id}`,
    routePattern: "/supply-chain/cost-impact-notice/:id",
  });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  return result;
}

describe("CostImpactNoticeDetailView", () => {
  it("heads the page with the part and the SAP number", async () => {
    await renderDetail();
    expect(
      screen.getByRole("heading", { name: "DATA LOGGING MODULE", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/SAP 1000-5110-00/)).toBeInTheDocument();
  });

  it("renders the Part, Cost & Impact, Where Used and Notes cards", async () => {
    await renderDetail();
    expect(screen.getByRole("heading", { name: "Part", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cost & Impact", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Where Used", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Notes", level: 2 })).toBeInTheDocument();
  });

  it("shows the delta cost, formatted as currency", async () => {
    await renderDetail();
    expect(screen.getAllByText("+$421.85").length).toBeGreaterThan(0);
  });

  it("says who raised it, and that there are no watchers", async () => {
    await renderDetail();
    expect(screen.getByText(/Mark Balent, who raised this notice/)).toBeInTheDocument();
    expect(screen.getByText(/have no watchers/)).toBeInTheDocument();
  });

  it("edits the Part card through its Edit modal", async () => {
    await renderDetail();
    await userEvent.click(screen.getByRole("button", { name: "Edit Part" }));
    const dialog = await screen.findByRole("dialog", { name: /edit part/i });
    const supplierInput = within(dialog).getByDisplayValue("Redlion");
    await userEvent.clear(supplierInput);
    await userEvent.type(supplierInput, "New Supplier Co");
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(screen.getByText("New Supplier Co")).toBeInTheDocument());
  });
});
