import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { ListAccessBanner } from "./ListAccessBanner";
import { APPS } from "@/api/appAccess";
import { SITES } from "@/api/config";
import { clearAccessDenials, markListDenied, markSiteDenied } from "@/hooks/useListAccess";

const teradyne = APPS.find((a) => a.label === "Teradyne Log")!;

afterEach(() => clearAccessDenials());

describe("ListAccessBanner", () => {
  it("renders nothing when the user has access to everything", () => {
    const { container } = renderWithProviders(<ListAccessBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the APP, not the list GUID", () => {
    // The GUID is the only thing a refusal actually carries, and it is no use
    // to the reader or to whoever they forward the message to.
    markListDenied(teradyne.lists[0], SITES.pmo);
    renderWithProviders(<ListAccessBanner />);

    expect(screen.getByText(/Teradyne Log/)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(teradyne.lists[0]))).not.toBeInTheDocument();
  });

  it("names the site to ask about", () => {
    markListDenied(teradyne.lists[0], SITES.pmo);
    renderWithProviders(<ListAccessBanner />);
    expect(screen.getByText("Altronic_PMO")).toBeInTheDocument();
  });

  it("names every app on a site refused outright", () => {
    markSiteDenied(SITES.panelTeam);
    renderWithProviders(<ListAccessBanner />);
    const banner = screen.getByText(/Panel Orders/);
    expect(banner).toHaveTextContent("Panel Tasks");
  });

  it("clears what it learned when you press Check again", async () => {
    const user = userEvent.setup();
    markListDenied(teradyne.lists[0], SITES.pmo);
    const { container } = renderWithProviders(<ListAccessBanner />);

    await user.click(screen.getByRole("button", { name: "Check again" }));

    // Cleared, not merely refetched: anything still refused registers again
    // within moments, and anything since granted stops being hidden.
    expect(container).toBeEmptyDOMElement();
  });
});
