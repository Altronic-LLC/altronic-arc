import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { ListAccessIndicator } from "./ListAccessIndicator";
import { Footer } from "./Footer";
import { APPS } from "@/api/appAccess";
import { SITES } from "@/api/config";
import { clearAccessDenials, markListDenied, markSiteDenied } from "@/hooks/useListAccess";
import { resetOpenDropdown } from "./useDropdownClose";

const teradyne = APPS.find((a) => a.label === "Teradyne Log")!;

beforeEach(() => resetOpenDropdown());
afterEach(() => clearAccessDenials());

describe("ListAccessIndicator", () => {
  it("renders nothing when the user has access to everything", () => {
    const { container } = renderWithProviders(<ListAccessIndicator />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the APP, not the list GUID", () => {
    // The GUID is the only thing a refusal actually carries, and it is no use
    // to the reader or to whoever they forward the message to.
    markListDenied(teradyne.lists[0], SITES.pmo);
    renderWithProviders(<ListAccessIndicator />);

    expect(screen.getAllByText(/Teradyne Log/).length).toBeGreaterThan(0);
    expect(screen.queryByText(new RegExp(teradyne.lists[0]))).not.toBeInTheDocument();
  });

  it("offers the icon for a narrow screen and the sentence for a wide one", () => {
    // Both are always in the DOM — the breakpoint classes decide which is
    // visible, so a resize needs no JavaScript and no measurement.
    markListDenied(teradyne.lists[0], SITES.pmo);
    renderWithProviders(<ListAccessIndicator />);

    const icon = screen.getByRole("button", { name: "SharePoint access notice" });
    expect(icon.className).toContain("lg:hidden");

    const inline = screen.getByTitle(/don't have SharePoint access/);
    expect(inline.closest("div")?.className).toContain("lg:flex");
  });

  it("uses a warning colour that has a light AND a dark value", () => {
    // The brand yellows are one fixed hex: fine on the dark footer, almost
    // invisible on the light one (Tim, 2026-09-24). Anything reintroducing a
    // single-value brand yellow here fails this.
    markListDenied(teradyne.lists[0], SITES.pmo);
    renderWithProviders(<ListAccessIndicator />);

    const icon = screen.getByRole("button", { name: "SharePoint access notice" });
    const sentence = screen.getByTitle(/don't have SharePoint access/);
    for (const el of [icon, sentence]) {
      expect(el.className).toMatch(/dark:text-/);
      expect(el.className).not.toMatch(/text-ajax-yellow/);
    }
  });

  it("opens a popup from the icon, carrying the message and Check again", async () => {
    const user = userEvent.setup();
    markListDenied(teradyne.lists[0], SITES.pmo);
    renderWithProviders(<ListAccessIndicator />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "SharePoint access notice" }));

    const popup = screen.getByRole("dialog", { name: "SharePoint access notice" });
    expect(popup).toHaveTextContent(/Teradyne Log/);
    expect(popup).toHaveTextContent("Altronic_PMO");
    expect(within(popup).getByRole("button", { name: /Check again/ })).toBeInTheDocument();
  });

  it("opens the same popup from the truncated sentence", async () => {
    // The sentence truncates in a footer row, so it has to be readable in full
    // somewhere — clicking it is that somewhere.
    const user = userEvent.setup();
    markSiteDenied(SITES.panelTeam);
    renderWithProviders(<ListAccessIndicator />);

    await user.click(screen.getByTitle(/don't have SharePoint access/));
    expect(screen.getByRole("dialog")).toHaveTextContent("Panel Orders");
  });

  it("closes the popup on Escape", async () => {
    const user = userEvent.setup();
    markListDenied(teradyne.lists[0], SITES.pmo);
    renderWithProviders(<ListAccessIndicator />);

    await user.click(screen.getByRole("button", { name: "SharePoint access notice" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears what it learned when you press Check again", async () => {
    const user = userEvent.setup();
    markListDenied(teradyne.lists[0], SITES.pmo);
    const { container } = renderWithProviders(<ListAccessIndicator />);

    await user.click(screen.getAllByRole("button", { name: /Check again/ })[0]);

    // Cleared, not merely refetched: anything still refused registers again
    // within moments, and anything since granted stops being hidden.
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Footer placement", () => {
  it("sits between the maintainer line and the About button", () => {
    markListDenied(teradyne.lists[0], SITES.pmo);
    renderWithProviders(<Footer />);

    const maintainer = screen.getByText(/Developed and managed by/);
    const notice = screen.getByRole("button", { name: "SharePoint access notice" });
    const about = screen.getByRole("link", { name: /About/ });

    // Document order: maintainer → notice → About.
    expect(maintainer.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("leaves the footer alone when there is nothing to report", () => {
    renderWithProviders(<Footer />);
    expect(screen.queryByRole("button", { name: "SharePoint access notice" })).not.toBeInTheDocument();
    expect(screen.getByText(/Developed and managed by/)).toBeInTheDocument();
  });
});
