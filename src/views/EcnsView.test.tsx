import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { EcnsView } from "./EcnsView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

async function renderList(search = "") {
  const result = renderWithProviders(<EcnsView />, {
    route: `/engineering/ecns${search}`,
    routePattern: "/engineering/ecns",
  });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return result;
}

function filterTrigger(label: string): HTMLElement {
  const bar = screen.getByRole("search", { name: /ecn filters/i });
  const field = within(bar).getByText(label).closest("label") as HTMLElement;
  return field.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
}

describe("EcnsView", () => {
  it("lists every ECN, newest number first", async () => {
    await renderList();
    const rows = screen.getAllByRole("row").slice(1); // drop the header
    expect(within(rows[0]).getByText("260062")).toBeInTheDocument();
    expect(within(rows[1]).getByText("260059R1")).toBeInTheDocument();
  });

  // The question people arrive with is "which ECN changed part 711478?", and
  // that number is in the Detailed Description, not the title.
  it("searches the description, not just the title", async () => {
    await renderList();
    await userEvent.type(screen.getByPlaceholderText(/part number, assembly/i), "711478");
    await waitFor(() => expect(screen.queryByText("260058")).not.toBeInTheDocument());
    expect(screen.getByText("260062")).toBeInTheDocument();
  });

  it("flags the notices that are on hold", async () => {
    await renderList();
    // Scoped to the table — "On hold" is also a filter label above it.
    const table = screen.getByRole("table");
    expect(within(table).getByText("On hold")).toBeInTheDocument();
  });

  it("filters to the ones on hold", async () => {
    await renderList();
    await userEvent.click(filterTrigger("On hold"));
    await userEvent.click(await screen.findByRole("option", { name: "On hold" }));
    await waitFor(() => expect(screen.queryByText("260062")).not.toBeInTheDocument());
    expect(screen.getByText("260059R1")).toBeInTheDocument();
  });

  it("filters on whether the drawings are done", async () => {
    await renderList();
    await userEvent.click(filterTrigger("Drawings"));
    await userEvent.click(await screen.findByRole("option", { name: "Outstanding" }));
    await waitFor(() => expect(screen.queryByText("260059")).not.toBeInTheDocument());
    expect(screen.getByText("260062")).toBeInTheDocument();
  });

  // ProjectReference is a lookup, so the row carries an id and the title is
  // joined from the Projects list. A missing join shows as a blank column.
  it("shows each notice's project by name", async () => {
    await renderList();
    // The Projects list is its own query — the table renders first, with the
    // project column filling in once the join data lands.
    await waitFor(() =>
      expect(
        within(screen.getByRole("table")).getAllByText("0000-Engineering Apps").length,
      ).toBeGreaterThan(0),
    );
  });

  it("filters by project", async () => {
    await renderList();
    await userEvent.click(filterTrigger("Project"));
    await userEvent.click(await screen.findByRole("option", { name: "0003-Engineering Task List" }));

    await waitFor(() => expect(screen.queryByText("260062")).not.toBeInTheDocument());
    expect(screen.getByText("260059")).toBeInTheDocument();
    expect(screen.getByText("260058")).toBeInTheDocument();
  });

  it("keeps the project filter in the URL", async () => {
    await renderList("?project=274");
    await waitFor(() => expect(screen.queryByText("260058")).not.toBeInTheDocument());
    expect(screen.getByText("260062")).toBeInTheDocument();
  });

  it("filters on the stock disposition", async () => {
    await renderList();
    await userEvent.click(filterTrigger("In House Stock"));
    await userEvent.click(
      await screen.findByRole("option", { name: "Operations - Stock modified" }),
    );
    await waitFor(() => expect(screen.queryByText("260062")).not.toBeInTheDocument());
    expect(screen.getByText("260059")).toBeInTheDocument();
  });

  it("keeps the filters in the URL so a view can be shared", async () => {
    await renderList("?hold=On+hold");
    expect(screen.getByText("260059R1")).toBeInTheDocument();
    expect(screen.queryByText("260062")).not.toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    await renderList();
    await userEvent.type(screen.getByPlaceholderText(/part number, assembly/i), "zzzznothing");
    await waitFor(() =>
      expect(screen.getByText(/no ecns match these filters/i)).toBeInTheDocument(),
    );
  });

  it("opens the new-ECN form", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /new ecn/i }));
    expect(await screen.findByRole("dialog", { name: /new ecn/i })).toBeInTheDocument();
  });
});
