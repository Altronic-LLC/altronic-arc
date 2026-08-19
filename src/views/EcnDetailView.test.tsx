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

  it("edits a text field in place", async () => {
    await renderDetail();
    const label = screen.getByText("Final Assembly Part Numbers").closest("div") as HTMLElement;
    await userEvent.click(within(label).getByRole("button", { name: "Edit" }));

    const input = screen.getByLabelText("Final Assembly Part Numbers");
    await userEvent.clear(input);
    await userEvent.type(input, "791970, 791971");
    await userEvent.click(within(label).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("791970, 791971")).toBeInTheDocument());
  });

  it("ticks a boolean straight off the page", async () => {
    await renderDetail();
    const drawings = screen.getByLabelText("Drawings Complete?");
    expect(drawings).not.toBeChecked();
    await userEvent.click(drawings);
    await waitFor(() => expect(screen.getByLabelText("Drawings Complete?")).toBeChecked());
  });

  it("edits the Log# from the sidebar", async () => {
    await renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /edit log#/i }));
    const input = screen.getByLabelText("Log#");
    await userEvent.clear(input);
    await userEvent.type(input, "260059R2{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "ECN 260059R2", level: 1 })).toBeInTheDocument(),
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
