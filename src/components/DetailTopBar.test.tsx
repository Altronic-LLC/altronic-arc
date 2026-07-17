import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { DetailTopBar } from "./DetailTopBar";

describe("DetailTopBar", () => {
  it("shows the section category as a link to that section's list", () => {
    renderWithProviders(<DetailTopBar category="Panel Tasks" listTo="/panels/tasks" />);
    const link = screen.getByRole("link", { name: /panel tasks/i });
    expect(link).toHaveAttribute("href", "/panels/tasks");
  });

  it("renders a Back control", () => {
    renderWithProviders(<DetailTopBar category="EIRs" listTo="/eirs" />);
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });
});
