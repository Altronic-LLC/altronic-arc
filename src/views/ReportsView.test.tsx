import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { ReportsView } from "./ReportsView";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

describe("ReportsView", () => {
  it("lists every registered report — the trend chart and the defect breakdown for each source", () => {
    renderWithProviders(<ReportsView />);
    expect(screen.getByText("Teradyne Board Test & FPY")).toBeInTheDocument();
    expect(screen.getByText("Teradyne Defect Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Digital QC Board Test & FPY")).toBeInTheDocument();
    expect(screen.getByText("Digital QC Defect Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Ignition QC Board Test & FPY")).toBeInTheDocument();
    expect(screen.getByText("Ignition QC Defect Breakdown")).toBeInTheDocument();
  });

  it("navigates to a report's own route when its card is clicked", async () => {
    renderWithProviders(<ReportsView />);
    await userEvent.click(screen.getByText("Teradyne Board Test & FPY"));
    expect(mockNavigate).toHaveBeenCalledWith("/reports/teradyne-fpy");
  });

  it("navigates to the Digital QC report's own route", async () => {
    renderWithProviders(<ReportsView />);
    await userEvent.click(screen.getByText("Digital QC Board Test & FPY"));
    expect(mockNavigate).toHaveBeenCalledWith("/reports/digital-qc-fpy");
  });

  it("has no Kiosk view link — the kiosk machine navigates to /reports/kiosk directly", () => {
    renderWithProviders(<ReportsView />);
    expect(screen.queryByText(/kiosk/i)).not.toBeInTheDocument();
  });
});
