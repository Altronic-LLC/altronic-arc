import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { Footer } from "./Footer";

// BusinessIT#77 (Alexander Masgras): the footer floats over the bottom of the
// page. An arrow slides it away until it's pressed again or the page reloads.

vi.mock("@/hooks/useVersionCheck", () => ({
  useVersionCheck: () => ({ updateAvailable: false }),
}));
vi.mock("./ListAccessIndicator", () => ({ ListAccessIndicator: () => null }));

function footer(container: HTMLElement): HTMLElement {
  return container.querySelector("footer") as HTMLElement;
}

describe("Footer — hide and show", () => {
  it("starts on screen, marked as the fixed footer", () => {
    const { container } = renderWithProviders(<Footer />);
    expect(footer(container)).toHaveAttribute("data-fixed-footer");
    expect(screen.queryByRole("button", { name: /show footer/i })).toBeNull();
  });

  it("slides away on the arrow, and stops claiming the bottom of the window", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Footer />);
    const resized = vi.fn();
    window.addEventListener("resize", resized);

    await user.click(screen.getByRole("button", { name: "Hide footer" }));

    const el = footer(container);
    expect(el.className.split(" ")).toContain("-translate-x-full");
    expect(el.className.split(" ")).toContain("invisible");
    // Dropdowns and fitted tables read this to stay clear of the footer.
    expect(el).not.toHaveAttribute("data-fixed-footer");
    // ...and are told to measure again.
    expect(resized).toHaveBeenCalled();
    window.removeEventListener("resize", resized);
  });

  it("keeps the tab out of reach while the footer is showing", () => {
    const { container } = renderWithProviders(<Footer />);
    // Rendered (so it can slide), but hidden from the accessibility tree
    // and the tab order — so found by its label attribute, not its role.
    const tab = container.ownerDocument.querySelector('button[aria-label^="Show footer"]');
    expect(tab).toHaveAttribute("aria-hidden", "true");
    expect(tab).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus to the tab once it has slid in, and back to the arrow", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Footer />);
    await user.click(screen.getByRole("button", { name: "Hide footer" }));

    const tab = screen.getByRole("button", { name: /show footer/i });
    // A transition on another property, or a bubbled one, doesn't count.
    fireEvent.transitionEnd(tab, { propertyName: "opacity" });
    expect(tab).not.toHaveFocus();
    fireEvent.transitionEnd(tab, { propertyName: "translate" });
    expect(tab).toHaveFocus();

    await user.click(tab);
    fireEvent.transitionEnd(footer(container), { propertyName: "translate" });
    expect(screen.getByRole("button", { name: "Hide footer" })).toHaveFocus();
  });

  it("comes back from the tab at the left edge", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Footer />);
    await user.click(screen.getByRole("button", { name: "Hide footer" }));

    await user.click(screen.getByRole("button", { name: /show footer/i }));

    const el = footer(container);
    expect(el).toHaveAttribute("data-fixed-footer");
    expect(el.className.split(" ")).not.toContain("-translate-x-full");
    expect(screen.queryByRole("button", { name: /show footer/i })).toBeNull();
  });
});

describe("Footer — the maintainer line (BusinessIT#81)", () => {
  it("names Ray rather than spelling out the address, and still mails it", () => {
    // 9 characters instead of 26 (Jason Lamb), so it fits one row.
    renderWithProviders(<Footer />);
    const link = screen.getByRole("link", { name: "Ray White" });
    expect(link).toHaveAttribute("href", "mailto:ray.white@altronic-llc.com");
    expect(link).toHaveAttribute("title", "ray.white@altronic-llc.com");
  });

  it("never wraps or gives up its width to the access notice", () => {
    // A long access sentence used to squeeze this line onto several rows.
    renderWithProviders(<Footer />);
    const line = screen.getByText(/Developed and managed by/).parentElement as HTMLElement;
    expect(line.className.split(" ")).toEqual(expect.arrayContaining(["shrink-0", "whitespace-nowrap"]));
  });
});
