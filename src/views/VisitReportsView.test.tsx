import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_VISIT_REPORTS } from "@/data/visitReportMockData";
import { VisitReportsView } from "./VisitReportsView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

async function renderList() {
  const result = renderWithProviders(<VisitReportsView />, {
    route: "/sales/visit-reports",
    routePattern: "/sales/visit-reports",
  });
  await waitFor(() =>
    expect(screen.getByText("CSI Compressco")).toBeInTheDocument(),
  );
  return result;
}

function table(): HTMLElement {
  return screen.getByRole("table");
}

/**
 * The dropdown trigger inside a named filter. Queried through the field's
 * label rather than by accessible name: the filter labels wrap their control
 * in a <label>, and a <button> is a labelable element, so its accessible name
 * comes from the label ("RM Name") and not from the trigger text ("Anyone").
 */
function filterTrigger(label: string): HTMLElement {
  // Scoped to the filter bar: "RM Name" and "Reason" are also column headers.
  const bar = screen.getByRole("search", { name: /visit report filters/i });
  const field = within(bar).getByText(label).closest("label") as HTMLElement;
  // A filter with a value also renders a "Clear selection" button inside the
  // trigger, so pick the one that opens the panel.
  return field.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
}

describe("VisitReportsView", () => {
  it("lists the reports newest visit first", async () => {
    await renderList();
    const rows = within(table()).getAllByRole("row").slice(1); // drop the header
    expect(rows[0]).toHaveTextContent("CSI Compressco"); // 2026-08-11
    expect(rows[1]).toHaveTextContent("AGES Energy Services"); // 2026-08-04
  });

  it("counts what's shown", async () => {
    await renderList();
    expect(
      screen.getByText(`${MOCK_VISIT_REPORTS.length} reports`),
    ).toBeInTheDocument();
  });

  it("filters by regional manager", async () => {
    await renderList();
    await userEvent.click(filterTrigger("RM Name"));
    await userEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", { name: "Wes Wagner" }),
    );

    await waitFor(() =>
      expect(screen.queryByText("CSI Compressco")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("AGES Energy Services")).toBeInTheDocument();
  });

  // Managers leave; their reports stay. The filter is built from the data, not
  // just the column's current choices.
  it("offers a manager who only exists in the data", async () => {
    await renderList();
    await userEvent.click(filterTrigger("RM Name"));
    expect(
      within(screen.getByRole("listbox")).getByRole("option", { name: "Neal Keeton" }),
    ).toBeInTheDocument();
  });

  it("filters by year", async () => {
    await renderList();
    await userEvent.click(filterTrigger("Year"));
    await userEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", { name: "2024" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Northern Plains Compression")).toBeInTheDocument(),
    );
    expect(screen.queryByText("CSI Compressco")).not.toBeInTheDocument();
  });

  it("searches across every field, not just the customer name", async () => {
    await renderList();
    // "CPU95" appears in the Product column of one report only.
    await userEvent.type(screen.getByPlaceholderText(/customer, summary/i), "CPU95");

    await waitFor(() =>
      expect(screen.queryByText("CSI Compressco")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("AGES Energy Services")).toBeInTheDocument();
  });

  it("says so plainly when the filters match nothing", async () => {
    await renderList();
    await userEvent.type(
      screen.getByPlaceholderText(/customer, summary/i),
      "zzzz-no-such-customer",
    );
    await waitFor(() =>
      expect(screen.getByText(/no visit reports match/i)).toBeInTheDocument(),
    );
  });

  // Filters live in the URL, which is what makes a filtered view shareable —
  // so a link that arrives WITH them opens already filtered. (Asserted from
  // the receiving end: the test router is a MemoryRouter, so a click can't be
  // observed on window.location.)
  it("opens with the filters a shared link carries", async () => {
    renderWithProviders(<VisitReportsView />, {
      route: "/sales/visit-reports?reason=Training",
      routePattern: "/sales/visit-reports",
    });

    await waitFor(() =>
      expect(screen.getByText("Permian Gathering Co.")).toBeInTheDocument(),
    );
    expect(screen.queryByText("CSI Compressco")).not.toBeInTheDocument();
    expect(filterTrigger("Reason")).toHaveTextContent("Training");
  });

  it("has no delete control anywhere on the page", async () => {
    await renderList();
    expect(screen.queryByRole("button", { name: /delete|remove/i })).toBeNull();
  });
});
