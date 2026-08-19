import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { GrayMarketRequestsView } from "./GrayMarketRequestsView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

async function renderList(search = "") {
  const result = renderWithProviders(<GrayMarketRequestsView />, {
    route: `/supply-chain/gray-market-requests${search}`,
    routePattern: "/supply-chain/gray-market-requests",
  });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return result;
}

function filterTrigger(label: string): HTMLElement {
  const bar = screen.getByRole("search", { name: /gray market request filters/i });
  const field = within(bar).getByText(label).closest("label") as HTMLElement;
  return field.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
}

describe("GrayMarketRequestsView", () => {
  // The SharePoint view the team lives in is the OPEN one — 199 rows of
  // finished history buries the handful that need doing.
  it("shows only open requests by default", async () => {
    await renderList();
    expect(screen.getByText("GMR_2026-003")).toBeInTheDocument();
    expect(screen.getByText("GMR_2026-002")).toBeInTheDocument();
    expect(screen.queryByText("GMR_2026-001")).not.toBeInTheDocument(); // Complete
  });

  it("counts each status on the pills", async () => {
    await renderList();
    const open = screen.getByRole("button", { name: /^Open/ });
    expect(open).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /^Complete/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^All/ })).toHaveTextContent("3");
  });

  it("switches to the completed ones", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /^Complete/ }));
    await waitFor(() => expect(screen.getByText("GMR_2026-001")).toBeInTheDocument());
    expect(screen.queryByText("GMR_2026-003")).not.toBeInTheDocument();
  });

  it("searches every field, not just the log number", async () => {
    await renderList("?status=All");
    // "Tektronics" is a vendor on one request only.
    await userEvent.type(screen.getByPlaceholderText(/part, vendor/i), "Tektronics");
    await waitFor(() =>
      expect(screen.queryByText("GMR_2026-002")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("GMR_2026-003")).toBeInTheDocument();
  });

  it("filters by requestor", async () => {
    await renderList("?status=All");
    await userEvent.click(filterTrigger("Requestor"));
    await userEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", { name: "Ray White" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("GMR_2026-003")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("GMR_2026-002")).toBeInTheDocument();
  });

  it("shows a comment count when a request has been discussed", async () => {
    await renderList();
    const row = screen.getByText("GMR_2026-002").closest("tr") as HTMLElement;
    expect(within(row).getByTitle(/1 comment/)).toBeInTheDocument();
  });

  it("opens the new-request form", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /new request/i }));
    expect(
      await screen.findByRole("dialog", { name: /new gray market request/i }),
    ).toBeInTheDocument();
  });

  it("has no delete control", async () => {
    await renderList("?status=All");
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});
