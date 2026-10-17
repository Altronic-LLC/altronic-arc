import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { GitHubMark } from "./GitHubMark";

describe("GitHubMark", () => {
  it("renders a decorative svg that takes the parent's colour and the given classes", () => {
    const { getByTestId } = render(<GitHubMark className="h-4 w-4 text-fg-muted" />);
    const svg = getByTestId("github-mark");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).toHaveClass("h-4", "w-4", "text-fg-muted");
    expect(svg.querySelector("path")).not.toBeNull();
  });
});
