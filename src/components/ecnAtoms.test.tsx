import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EcnFlagChip, EcnOnHoldChip, EcnStockChip } from "./ecnAtoms";

describe("EcnOnHoldChip", () => {
  it("shows only when the notice is on hold", () => {
    const { container, rerender } = render(<EcnOnHoldChip onHold="No" />);
    expect(container).toBeEmptyDOMElement();

    rerender(<EcnOnHoldChip onHold="Yes" />);
    expect(screen.getByText("On hold")).toBeInTheDocument();
  });

  it("copes with a blank column", () => {
    const { container } = render(<EcnOnHoldChip onHold="" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("EcnFlagChip", () => {
  it("reads Yes or No", () => {
    const { rerender } = render(<EcnFlagChip label="Drawings" value="Yes" tone="good" />);
    expect(screen.getByText("Yes")).toBeInTheDocument();

    rerender(<EcnFlagChip label="Drawings" value="" tone="good" />);
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("takes a warn tone without falling over", () => {
    render(<EcnFlagChip label="Field returns" value="Yes" tone="warn" />);
    expect(screen.getByText("Field returns")).toBeInTheDocument();
  });
});

describe("EcnStockChip", () => {
  it("drops the page reference but keeps it in the tooltip", () => {
    render(<EcnStockChip disposition="Engineering - Modify stock (see pg 2 of ECN)" />);
    const chip = screen.getByText("Engineering - Modify stock");
    expect(chip).toHaveAttribute("title", "Engineering - Modify stock (see pg 2 of ECN)");
  });

  it("shows a dash when nothing is set", () => {
    render(<EcnStockChip disposition="  " />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("leaves a do-not-modify disposition as it is", () => {
    render(<EcnStockChip disposition="Engineering - Do NOT modify stock" />);
    expect(screen.getByText("Engineering - Do NOT modify stock")).toBeInTheDocument();
  });
});
