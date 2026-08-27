import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuickLinksRow } from "./QuickLinksRow";
import type { QuickLink } from "@/types/task";

function link(overrides: Partial<QuickLink> = {}): QuickLink {
  return {
    id: 1,
    label: "CAD Vault",
    url: "https://example.com/cad",
    department: "Engineering",
    order: 1,
    ...overrides,
  };
}

describe("QuickLinksRow", () => {
  it("renders nothing when there are no links — no empty heading, no clutter", () => {
    const { container } = render(<QuickLinksRow links={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a real button for a valid http(s) URL", () => {
    render(<QuickLinksRow links={[link()]} />);
    const button = screen.getByRole("link", { name: /CAD Vault/ });
    expect(button).toHaveAttribute("href", "https://example.com/cad");
    expect(button).toHaveAttribute("target", "_blank");
    expect(button).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders every link passed, in the order given", () => {
    render(
      <QuickLinksRow
        links={[link({ id: 1, label: "First" }), link({ id: 2, label: "Second" })]}
      />,
    );
    const labels = screen.getAllByRole("link").map((l) => l.textContent);
    expect(labels[0]).toMatch(/First/);
    expect(labels[1]).toMatch(/Second/);
  });

  it("disarms a link whose URL isn't a real http(s) address, rather than sending the browser somewhere broken", () => {
    render(<QuickLinksRow links={[link({ url: "not a url" })]} />);
    const disarmed = screen.getByText("CAD Vault").closest("a")!;
    expect(disarmed).not.toHaveAttribute("href");
    expect(disarmed).toHaveAttribute("aria-disabled", "true");
  });

  it("disarms a non-http(s) scheme (e.g. javascript:) rather than letting it through", () => {
    render(<QuickLinksRow links={[link({ url: "javascript:alert(1)" })]} />);
    const disarmed = screen.getByText("CAD Vault").closest("a")!;
    expect(disarmed).not.toHaveAttribute("href");
  });
});
