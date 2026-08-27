import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CostImpactDeltaChip } from "./costImpactAtoms";

describe("CostImpactDeltaChip", () => {
  it("renders nothing when the delta hasn't computed yet", () => {
    const { container } = render(<CostImpactDeltaChip deltaCost={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an increase with a plus sign", () => {
    render(<CostImpactDeltaChip deltaCost={421.85} />);
    expect(screen.getByText("+$421.85")).toBeInTheDocument();
  });

  it("shows a decrease with a minus sign", () => {
    render(<CostImpactDeltaChip deltaCost={-10} />);
    expect(screen.getByText("−$10.00")).toBeInTheDocument();
  });

  it("says so when there's no change", () => {
    render(<CostImpactDeltaChip deltaCost={0} />);
    expect(screen.getByText("No change")).toBeInTheDocument();
  });
});
