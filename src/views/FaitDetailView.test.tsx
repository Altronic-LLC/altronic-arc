import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { FaitDetailView } from "./FaitDetailView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

vi.mock("@/hooks/useAttachments", () => ({
  useAttachments: () => ({ data: [], isLoading: false, error: null }),
  useUploadAttachment: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
}));

async function renderFait(id = 2) {
  const result = renderWithProviders(<FaitDetailView />, {
    route: `/supply-chain/fait/${id}`,
    routePattern: "/supply-chain/fait/:id",
  });
  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument(),
  );
  return result;
}

describe("FaitDetailView", () => {
  it("heads the page with the part, not the empty title", async () => {
    await renderFait();
    expect(screen.getByRole("heading", { name: "710213", level: 1 })).toBeInTheDocument();
    // Twice: the subtitle under the heading, and the Description field on
    // the Part card.
    expect(screen.getAllByText(/CASTING, ENCLOSURE WCD-10/).length).toBeGreaterThan(0);
  });

  it("lays the workflow out as one card per stage", async () => {
    await renderFait();
    for (const s of ["Part", "Request", "Inspection", "Results", "Sign-off"]) {
      expect(screen.getByRole("heading", { name: s, level: 2 })).toBeInTheDocument();
    }
  });

  it("gives each card one Edit button and no inline editors", async () => {
    await renderFait();
    for (const s of ["Part", "Request", "Inspection", "Results", "Sign-off"]) {
      expect(screen.getByRole("button", { name: `Edit ${s}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  // Nineteen Yes/No columns — spelled out when reading, pills when editing.
  it("spells a Yes/No column out rather than showing a tick", async () => {
    await renderFait();
    const card = screen
      .getByRole("heading", { name: "Request", level: 2 })
      .closest("section") as HTMLElement;
    const row = within(card).getByText("New Supplier Qualification").parentElement as HTMLElement;
    expect(within(row).getByText("Yes")).toBeInTheDocument();
  });

  it("edits a Yes/No column from the card's modal", async () => {
    await renderFait();
    await userEvent.click(screen.getByRole("button", { name: "Edit Request" }));

    const dialog = await screen.findByRole("dialog", { name: /edit request/i });
    const group = within(dialog).getByRole("radiogroup", { name: "New Part" });
    await userEvent.click(within(group).getByRole("radio", { name: "Yes" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      const card = screen
        .getByRole("heading", { name: "Request", level: 2 })
        .closest("section") as HTMLElement;
      const row = within(card).getByText("New Part").parentElement as HTMLElement;
      expect(within(row).getByText("Yes")).toBeInTheDocument();
    });
  });

  it("edits a text field from the card's modal", async () => {
    await renderFait();
    await userEvent.click(screen.getByRole("button", { name: "Edit Part" }));

    const dialog = await screen.findByRole("dialog", { name: /edit part/i });
    const input = within(dialog).getByRole("textbox", { name: "Supplier Name" });
    await userEvent.clear(input);
    await userEvent.type(input, "NEW CASTING CO");
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getAllByText(/NEW CASTING CO/).length).toBeGreaterThan(0));
  });

  it("moves the status from the sidebar's Details modal", async () => {
    await renderFait();
    await userEvent.click(screen.getByRole("button", { name: "Edit Details" }));

    const dialog = await screen.findByRole("dialog", { name: /edit details/i });
    await userEvent.click(within(dialog).getByRole("button", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "This is with ENG" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(screen.getAllByText("This is with ENG").length).toBeGreaterThan(0),
    );
  });

  it("shows the three sign-offs", async () => {
    await renderFait();
    const sidebar = screen.getByText("Sign-offs").closest("div")?.parentElement as HTMLElement;
    for (const who of ["SQE", "Eng", "KAM"]) {
      expect(within(sidebar).getByText(who)).toBeInTheDocument();
    }
  });

  it("carries the comment thread and watchers", async () => {
    await renderFait();
    expect(screen.getByText(/Dimensional check is done/)).toBeInTheDocument();
    expect(screen.getByText("Watchers")).toBeInTheDocument();
  });

  it("takes attachments", async () => {
    await renderFait();
    expect(screen.getByRole("heading", { name: /attachments/i })).toBeInTheDocument();
  });

  it("says so when the FAIT doesn't exist", async () => {
    renderWithProviders(<FaitDetailView />, {
      route: "/supply-chain/fait/999999",
      routePattern: "/supply-chain/fait/:id",
    });
    await waitFor(() =>
      expect(screen.getByText(/that fait doesn't exist/i)).toBeInTheDocument(),
    );
  });
});
