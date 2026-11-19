import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

// Panel Orders / Tasks / Capacity / Project Dashboard during their live test
// (PANEL_PLANNING_LIVE off): the page gate wrapped round those routes.

const access = vi.hoisted(() => ({ value: { canOpenPlanning: false, planningResolving: false, planningHint: "Not open yet." } }));
vi.mock("@/hooks/usePanelRoles", () => ({ usePanelTeamAccess: () => access.value }));

import { PanelPreviewGate } from "./PanelTeamGate";

function renderGate() {
  return renderWithProviders(
    <PanelPreviewGate noun="panel orders">
      <p>The page</p>
    </PanelPreviewGate>,
  );
}

describe("PanelPreviewGate", () => {
  it("shows the page to whoever may open it", () => {
    access.value = { canOpenPlanning: true, planningResolving: false, planningHint: "" };
    renderGate();
    expect(screen.getByText("The page")).toBeInTheDocument();
  });

  it("says Coming soon, and why, to anybody else", () => {
    access.value = { canOpenPlanning: false, planningResolving: false, planningHint: "Not open yet." };
    renderGate();
    expect(screen.queryByText("The page")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Coming soon" })).toBeInTheDocument();
    expect(screen.getByText("Not open yet.")).toBeInTheDocument();
  });

  it("neither shows nor refuses while the roles list loads", () => {
    access.value = { canOpenPlanning: false, planningResolving: true, planningHint: "" };
    renderGate();
    expect(screen.queryByText("The page")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Coming soon" })).not.toBeInTheDocument();
  });
});
