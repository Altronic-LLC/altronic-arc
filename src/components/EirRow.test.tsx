import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS } from "@/data/mockData";
import type { Eir } from "@/types/task";

// =============================================================================
// The EIR row card. The raised date lives with the EIR number rather than among
// the workflow badges, because it answers "which EIR is this" rather than
// "what state is it in" (Ray, 2026-08-25).
// =============================================================================

vi.mock("@/hooks/useUnseenMentions", () => ({
  markAsSeen: vi.fn(),
  useIsMentioned: () => false,
}));

import { EirRow } from "./EirRow";

function render(over: Partial<Eir> = {}) {
  const eir: Eir = { ...MOCK_EIRS[0], ...over };
  return renderWithProviders(<EirRow eir={eir} onOpen={vi.fn()} />);
}

describe("the raised date", () => {
  it("shows the date the EIR was created", () => {
    render({ createdAt: new Date("2026-03-12T09:30:00Z") });
    expect(screen.getByText(/12 Mar 2026|Mar 12, 2026/)).toBeInTheDocument();
  });

  // The list runs back years, so a date without a year reads as this year at a
  // glance — which is wrong for most of the list.
  it("always includes the year, even on an old EIR", () => {
    render({ createdAt: new Date("2024-01-05T09:30:00Z") });
    expect(screen.getByText(/2024/)).toBeInTheDocument();
  });

  it("carries the full timestamp on hover for anyone who needs the hour", () => {
    render({ createdAt: new Date("2026-03-12T09:30:00Z") });
    const el = screen.getByTitle(/^Raised /);
    expect(el).toBeInTheDocument();
  });

  // It must not be confused with the last-time-buy date, which is a different
  // date on the same card.
  it("is distinct from the LTB chip", () => {
    render({
      createdAt: new Date("2026-03-12T09:30:00Z"),
      ltbDate: new Date("2027-06-30T12:00:00Z"),
    });
    expect(screen.getByText(/LTB/)).toBeInTheDocument();
    expect(screen.getByTitle(/^Raised /)).toBeInTheDocument();
    expect(screen.getByTitle("Last-time-buy date")).toBeInTheDocument();
  });
});
