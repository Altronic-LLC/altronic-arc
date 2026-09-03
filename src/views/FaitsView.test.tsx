import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { FaitsView } from "./FaitsView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

async function renderList(search = "") {
  const result = renderWithProviders(<FaitsView />, {
    route: `/supply-chain/faits${search}`,
    routePattern: "/supply-chain/faits",
  });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return result;
}

function filterTrigger(label: string): HTMLElement {
  const bar = screen.getByRole("search", { name: /fait filters/i });
  const field = within(bar).getByText(label).closest("label") as HTMLElement;
  return field.querySelector('[aria-haspopup="listbox"]') as HTMLElement;
}

describe("FaitsView", () => {
  // Closed inspections are history; the ones that matter are sitting with
  // somebody.
  it("shows only open FAITs by default", async () => {
    await renderList();
    expect(screen.getByText("1000-9542-00")).toBeInTheDocument();
    expect(screen.queryByText("601491")).not.toBeInTheDocument(); // Closed
  });

  it("counts each bucket on the pills", async () => {
    await renderList();
    expect(screen.getByRole("button", { name: /^Open/ })).toHaveTextContent("5");
    expect(screen.getByRole("button", { name: /^Closed/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^All/ })).toHaveTextContent("6");
  });

  it("switches to the closed ones", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /^Closed/ }));
    await waitFor(() => expect(screen.getByText("601491")).toBeInTheDocument());
    expect(screen.queryByText("1000-9542-00")).not.toBeInTheDocument();
  });

  // Title is empty on every row the live list holds, so the part number is
  // the identifier.
  it("leads with the part number, not the title", async () => {
    await renderList();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByRole("link")).toHaveTextContent(/\d/);
  });

  it("searches the supplier as well as the part", async () => {
    await renderList();
    await userEvent.type(screen.getByPlaceholderText(/part number, description/i), "MIDWEST");
    await waitFor(() => expect(screen.queryByText("1000-9542-00")).not.toBeInTheDocument());
    expect(screen.getByText("710213")).toBeInTheDocument();
  });

  it("filters by supplier", async () => {
    await renderList();
    await userEvent.click(filterTrigger("Supplier"));
    await userEvent.click(await screen.findByRole("option", { name: "MIDWEST CASTING" }));
    await waitFor(() => expect(screen.queryByText("1000-9542-00")).not.toBeInTheDocument());
    expect(screen.getByText("710213")).toBeInTheDocument();
  });

  it("filters by project, and keeps it in the URL", async () => {
    await renderList("?project=412");
    await waitFor(() => expect(screen.queryByText("1000-9542-00")).not.toBeInTheDocument());
    expect(screen.getByText("691760")).toBeInTheDocument();
  });

  it("filters by the stage it's sitting at", async () => {
    await renderList();
    await userEvent.click(filterTrigger("Stage"));
    await userEvent.click(await screen.findByRole("option", { name: "This is with SQE" }));
    await waitFor(() => expect(screen.queryByText("1000-9542-00")).not.toBeInTheDocument());
    expect(screen.getByText("710213")).toBeInTheDocument();
  });

  it("flags a failed first pass", async () => {
    await renderList();
    expect(screen.getByText("Failed first pass")).toBeInTheDocument();
  });

  it("opens the new-FAIT form", async () => {
    await renderList();
    await userEvent.click(screen.getByRole("button", { name: /new fait/i }));
    expect(await screen.findByRole("dialog", { name: /new fait/i })).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    await renderList();
    await userEvent.type(screen.getByPlaceholderText(/part number, description/i), "zzzznothing");
    await waitFor(() =>
      expect(screen.getByText(/no faits match these filters/i)).toBeInTheDocument(),
    );
  });
});
