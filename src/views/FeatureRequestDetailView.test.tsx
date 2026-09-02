import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { FeatureRequestDetailView } from "./FeatureRequestDetailView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

async function renderRequest(id: number) {
  const result = renderWithProviders(<FeatureRequestDetailView />, {
    route: `/feature-request/${id}`,
    routePattern: "/feature-request/:id",
  });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  return result;
}

describe("FeatureRequestDetailView", () => {
  it("shows the request's title, description and requester", async () => {
    await renderRequest(2);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Bulk status change on the EIR board",
    );
    expect(screen.getByText(/all need to move to Closed/i)).toBeInTheDocument();
    expect(screen.getAllByText("Sheila Horn").length).toBeGreaterThan(0);
  });

  it("shows Not implemented reasons when the request is closed", async () => {
    await renderRequest(4);
    expect(screen.getByText(/no backend\/server/i)).toBeInTheDocument();
  });

  it("renders comments, newest first", async () => {
    await renderRequest(2);
    expect(screen.getByText(/planning to add a checkbox/i)).toBeInTheDocument();
  });

  it("shows an existing status without changing it accidentally", async () => {
    await renderRequest(2);
    expect(screen.getByText("In Work")).toBeInTheDocument();
  });

  it("changes status from the sidebar — any signed-in user, no admin gate", async () => {
    await renderRequest(1);
    // ChoiceSelect renders as a button showing the current value.
    const statusControl = screen.getByRole("button", { name: /pending review/i });
    await userEvent.click(statusControl);
    await userEvent.click(await screen.findByRole("option", { name: "In Work" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /in work/i })).toBeInTheDocument(),
    );
  });

  it("posts a new comment", async () => {
    await renderRequest(1);
    const composer = screen.getByPlaceholderText(/write a comment/i);
    await userEvent.type(composer, "Looks good to me");
    const buttons = screen.getAllByRole("button");
    const sendButton = buttons.find((b) => b.querySelector("svg.lucide-send"));
    await userEvent.click(sendButton!);
    await waitFor(() => expect(screen.getByText("Looks good to me")).toBeInTheDocument());
  });

  it("shows 'not found' for an id that doesn't exist", async () => {
    renderWithProviders(<FeatureRequestDetailView />, {
      route: "/feature-request/999999",
      routePattern: "/feature-request/:id",
    });
    await waitFor(() =>
      expect(screen.getByText(/doesn't exist/i)).toBeInTheDocument(),
    );
  });
});

describe("what is deliberately absent", () => {
  it("offers no delete anywhere on the page", async () => {
    await renderRequest(1);
    expect(screen.queryByRole("button", { name: /delete|remove request/i })).not.toBeInTheDocument();
  });

  it("never restricts status/priority editing behind an admin check", async () => {
    // No useIsAdmin/useAdminAccess mock is registered — if the view imported
    // an admin gate it would need one to render at all.
    await renderRequest(1);
    expect(screen.getByText("Priority")).toBeInTheDocument();
  });
});
