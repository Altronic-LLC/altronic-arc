import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { EcnDetailView } from "./EcnDetailView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

async function renderDetail(id = 2) {
  const result = renderWithProviders(<EcnDetailView />, {
    route: `/engineering/ecn/${id}`,
    routePattern: "/engineering/ecn/:id",
  });
  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument(),
  );
  return result;
}

describe("EcnDetailView", () => {
  it("heads the page with the Log# and the part", async () => {
    await renderDetail();
    expect(screen.getByRole("heading", { name: "ECN 260059R1", level: 1 })).toBeInTheDocument();
    // Twice: the subtitle under the heading, and the editable Title in the
    // sidebar.
    expect(screen.getAllByText("PCB ASSEMBLY, WCD-20").length).toBeGreaterThan(0);
  });

  it("renders the three workflow cards", async () => {
    await renderDetail();
    for (const section of ["Change", "Disposition", "Sign-off"]) {
      expect(screen.getByRole("heading", { name: section, level: 2 })).toBeInTheDocument();
    }
  });

  it("renders the stored rich text rather than its tags", async () => {
    await renderDetail();
    expect(screen.getByText(/Production to modify existing in-house stock/)).toBeInTheDocument();
    expect(screen.queryByText(/ExternalClass/)).not.toBeInTheDocument();
  });

  // The rule here is different from every other comment thread in ARC, so
  // the page says it rather than leaving people to guess.
  it("says who a comment will reach", async () => {
    await renderDetail();
    expect(
      screen.getByText(/emails Ray White, who submitted this ECN, and anyone you @-mention/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/ECNs have no watchers/i)).toBeInTheDocument();
  });

  it("offers no watcher control at all", async () => {
    await renderDetail();
    expect(screen.queryByText(/^Watchers$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^watch$/i })).not.toBeInTheDocument();
  });

  it("shows the existing thread", async () => {
    await renderDetail();
    expect(screen.getByText(/Production has the modified stock on the bench/)).toBeInTheDocument();
  });

  it("takes attachments", async () => {
    await renderDetail();
    expect(screen.getByRole("heading", { name: /attachments/i })).toBeInTheDocument();
  });

  // The page reads; one Edit per card writes. It used to carry an Edit link
  // per text column and checkboxes that saved on touch, which put edit
  // controls in six places on one card (Ray, 2026-08-19).
  it("gives each card one Edit button and no inline editors", async () => {
    await renderDetail();
    for (const section of ["Change", "Disposition", "Sign-off"]) {
      expect(screen.getByRole("button", { name: `Edit ${section}` })).toBeInTheDocument();
    }
    // Nothing on the card is a live control.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "Edit" })).toHaveLength(0);
  });

  it("edits a text field through the card's modal", async () => {
    await renderDetail();
    await userEvent.click(screen.getByRole("button", { name: "Edit Change" }));

    const dialog = await screen.findByRole("dialog", { name: /edit change/i });
    const input = within(dialog).getByRole("textbox", { name: "Final Assembly Part Numbers" });
    await userEvent.clear(input);
    await userEvent.type(input, "791970, 791971");
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText("791970, 791971")).toBeInTheDocument());
  });

  it("sets a Yes / No column from the modal", async () => {
    await renderDetail();
    await userEvent.click(screen.getByRole("button", { name: "Edit Disposition" }));

    const dialog = await screen.findByRole("dialog", { name: /edit disposition/i });
    const group = within(dialog).getByRole("radiogroup", { name: "Drawings Complete?" });
    expect(within(group).getByRole("radio", { name: "No" })).toBeChecked();

    await userEvent.click(within(group).getByRole("radio", { name: "Yes" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      const card = screen.getByRole("heading", { name: "Disposition", level: 2 })
        .closest("section") as HTMLElement;
      const row = within(card).getByText("Drawings Complete?").parentElement as HTMLElement;
      expect(within(row).getByText("Yes")).toBeInTheDocument();
    });
  });

  it("edits the Log# from the sidebar's Details modal", async () => {
    await renderDetail();
    await userEvent.click(screen.getByRole("button", { name: "Edit Details" }));

    const dialog = await screen.findByRole("dialog", { name: /edit details/i });
    const input = within(dialog).getByRole("textbox", { name: "Log#" });
    await userEvent.clear(input);
    await userEvent.type(input, "260059R2");
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "ECN 260059R2", level: 1 })).toBeInTheDocument(),
    );
  });

  it("names the project it belongs to", async () => {
    await renderDetail();
    // Joined from the Projects list, which loads separately from the ECN.
    await waitFor(() =>
      expect(screen.getByText("0000-Engineering Apps")).toBeInTheDocument(),
    );
  });

  it("changes the project from the Details modal", async () => {
    await renderDetail();
    await userEvent.click(screen.getByRole("button", { name: "Edit Details" }));

    const dialog = await screen.findByRole("dialog", { name: /edit details/i });
    await userEvent.click(within(dialog).getByRole("button", { name: "Project Reference" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "0017-AMP-5000 Refresh" }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(screen.getByText("0017-AMP-5000 Refresh")).toBeInTheDocument(),
    );
  });

  it("names the submitter", async () => {
    await renderDetail();
    const sidebar = screen.getByText("Submitted by").closest("div")?.parentElement as HTMLElement;
    expect(within(sidebar).getByText("Ray White")).toBeInTheDocument();
  });

  it("says so when the ECN doesn't exist", async () => {
    renderWithProviders(<EcnDetailView />, {
      route: "/engineering/ecn/999999",
      routePattern: "/engineering/ecn/:id",
    });
    await waitFor(() =>
      expect(screen.getByText(/that ecn doesn't exist/i)).toBeInTheDocument(),
    );
  });
});
