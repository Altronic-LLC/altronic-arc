import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { KioskReportsView } from "./KioskReportsView";

// Stub the six real report views — the kiosk's own job is deciding WHICH
// one is mounted and WHEN, not re-proving each report's own data fetching
// (that's covered in each view's own test file). Mirrors the "stub the row
// component" lesson for a cap test in CLAUDE.md. Each stub echoes its
// `kiosk` prop so the wiring itself is provable.
vi.mock("@/views/TeradyneFpyReportView", () => ({
  TeradyneFpyReportView: ({ kiosk }: { kiosk?: boolean }) => (
    <div>Teradyne FPY report{kiosk ? " (kiosk)" : ""}</div>
  ),
}));
vi.mock("@/views/TeradyneDefectBreakdownReportView", () => ({
  TeradyneDefectBreakdownReportView: ({ kiosk }: { kiosk?: boolean }) => (
    <div>Teradyne defects report{kiosk ? " (kiosk)" : ""}</div>
  ),
}));
vi.mock("@/views/DigitalQcFpyReportView", () => ({
  DigitalQcFpyReportView: ({ kiosk }: { kiosk?: boolean }) => (
    <div>Digital QC FPY report{kiosk ? " (kiosk)" : ""}</div>
  ),
}));
vi.mock("@/views/DigitalQcDefectBreakdownReportView", () => ({
  DigitalQcDefectBreakdownReportView: ({ kiosk }: { kiosk?: boolean }) => (
    <div>Digital QC defects report{kiosk ? " (kiosk)" : ""}</div>
  ),
}));
vi.mock("@/views/IgnitionQcFpyReportView", () => ({
  IgnitionQcFpyReportView: ({ kiosk }: { kiosk?: boolean }) => (
    <div>Ignition QC FPY report{kiosk ? " (kiosk)" : ""}</div>
  ),
}));
vi.mock("@/views/IgnitionQcDefectBreakdownReportView", () => ({
  IgnitionQcDefectBreakdownReportView: ({ kiosk }: { kiosk?: boolean }) => (
    <div>Ignition QC defects report{kiosk ? " (kiosk)" : ""}</div>
  ),
}));

beforeEach(() => {
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.classList.remove("dark");
});

describe("KioskReportsView", () => {
  it("starts on the first registered report, rendered with kiosk={true}", () => {
    renderWithProviders(<KioskReportsView />, { route: "/reports/kiosk" });
    expect(screen.getByText("Teradyne FPY report (kiosk)")).toBeInTheDocument();
  });

  it("cycles FPY then Defect Breakdown for each dataset, every 60 seconds, then wraps", () => {
    vi.useFakeTimers();
    renderWithProviders(<KioskReportsView />, { route: "/reports/kiosk" });

    const order = [
      /Teradyne FPY report/,
      /Teradyne defects report/,
      /Digital QC FPY report/,
      /Digital QC defects report/,
      /Ignition QC FPY report/,
      /Ignition QC defects report/,
    ];

    expect(screen.getByText(order[0])).toBeInTheDocument();

    for (let i = 1; i < order.length; i++) {
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByText(order[i])).toBeInTheDocument();
    }

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText(order[0])).toBeInTheDocument();
  });

  it("uses the slower kiosk-fade animation, not the app-wide 150ms fade-in", () => {
    renderWithProviders(<KioskReportsView />, { route: "/reports/kiosk" });
    const layer = screen.getByText(/Teradyne FPY report/).parentElement;
    expect(layer).toHaveClass("animate-kiosk-fade");
  });

  it("has a fullscreen button that calls the Fullscreen API", async () => {
    const requestFullscreen = vi.fn();
    document.documentElement.requestFullscreen = requestFullscreen;

    renderWithProviders(<KioskReportsView />, { route: "/reports/kiosk" });
    screen.getByRole("button", { name: /fullscreen/i }).click();

    expect(requestFullscreen).toHaveBeenCalled();
  });

  describe("?dept= filter", () => {
    it("cycles only Teradyne's reports when ?dept=ICT is on the URL", () => {
      vi.useFakeTimers();
      renderWithProviders(<KioskReportsView />, { route: "/reports/kiosk?dept=ICT" });

      expect(screen.getByText(/Teradyne FPY report/)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByText(/Teradyne defects report/)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByText(/Teradyne FPY report/)).toBeInTheDocument();
      expect(screen.queryByText(/Digital QC/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Ignition QC/)).not.toBeInTheDocument();
    });

    it("cycles only Digital QC's reports when ?dept=dig is on the URL (case-insensitive)", () => {
      vi.useFakeTimers();
      renderWithProviders(<KioskReportsView />, { route: "/reports/kiosk?dept=dig" });

      expect(screen.getByText(/Digital QC FPY report/)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByText(/Digital QC defects report/)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByText(/Digital QC FPY report/)).toBeInTheDocument();
    });

    it("cycles only Ignition QC's reports when ?dept=IGN is on the URL", () => {
      renderWithProviders(<KioskReportsView />, { route: "/reports/kiosk?dept=IGN" });
      expect(screen.getByText(/Ignition QC FPY report/)).toBeInTheDocument();
      expect(screen.queryByText(/Teradyne/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Digital QC/)).not.toBeInTheDocument();
    });

    it("falls back to every report when ?dept= is unrecognized", () => {
      renderWithProviders(<KioskReportsView />, { route: "/reports/kiosk?dept=XYZ" });
      expect(screen.getByText(/Teradyne FPY report/)).toBeInTheDocument();
    });
  });

  describe("?theme= override", () => {
    it("forces dark mode when ?theme=dark is on the URL", () => {
      renderWithProviders(<KioskReportsView />, { route: "/reports/kiosk?theme=dark" });
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("forces light mode when ?theme=light is on the URL, even over a stored dark preference", () => {
      localStorage.setItem("aets-theme", "dark");
      renderWithProviders(<KioskReportsView />, { route: "/reports/kiosk?theme=light" });
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      localStorage.removeItem("aets-theme");
    });

    it("falls back to the stored preference when no ?theme= flag is present", () => {
      localStorage.setItem("aets-theme", "dark");
      renderWithProviders(<KioskReportsView />, { route: "/reports/kiosk" });
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      localStorage.removeItem("aets-theme");
    });

    it("ignores an unrecognized ?theme= value", () => {
      renderWithProviders(<KioskReportsView />, { route: "/reports/kiosk?theme=purple" });
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });
});
