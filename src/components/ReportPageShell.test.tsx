import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { ReportPageShell } from "./ReportPageShell";

describe("ReportPageShell", () => {
  it("shows a loading state and no children while loading", () => {
    renderWithProviders(
      <ReportPageShell
        icon={<span />}
        title="Test Report"
        description="A description."
        isLoading
        lastRefreshedAt={null}
        loadingNoun="the test data"
      >
        <span>The chart</span>
      </ReportPageShell>,
    );
    expect(screen.getByText(/loading|the test data/i)).toBeInTheDocument();
    expect(screen.queryByText("The chart")).not.toBeInTheDocument();
  });

  it("renders the title, description, and children once loaded", () => {
    renderWithProviders(
      <ReportPageShell
        icon={<span />}
        title="Test Report"
        description="A description."
        isLoading={false}
        lastRefreshedAt={null}
        loadingNoun="the test data"
      >
        <span>The chart</span>
      </ReportPageShell>,
    );
    expect(screen.getByText("Test Report")).toBeInTheDocument();
    expect(screen.getByText("A description.")).toBeInTheDocument();
    expect(screen.getByText("The chart")).toBeInTheDocument();
  });

  it("shows the last-refreshed time only once it's known", () => {
    const { rerender } = renderWithProviders(
      <ReportPageShell
        icon={<span />}
        title="Test Report"
        description="A description."
        isLoading={false}
        lastRefreshedAt={null}
        loadingNoun="the test data"
      >
        <span>The chart</span>
      </ReportPageShell>,
    );
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();

    rerender(
      <ReportPageShell
        icon={<span />}
        title="Test Report"
        description="A description."
        isLoading={false}
        lastRefreshedAt={new Date(2026, 8, 17, 15, 42)}
        loadingNoun="the test data"
      >
        <span>The chart</span>
      </ReportPageShell>,
    );
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it("shows the Back button and Reports chip normally, but not in kiosk mode", () => {
    const { rerender } = renderWithProviders(
      <ReportPageShell
        icon={<span />}
        title="Test Report"
        description="A description."
        isLoading={false}
        lastRefreshedAt={null}
        loadingNoun="the test data"
      >
        <span>The chart</span>
      </ReportPageShell>,
    );
    expect(screen.getByText("Back")).toBeInTheDocument();
    expect(screen.getByText("Reports")).toBeInTheDocument();

    rerender(
      <ReportPageShell
        icon={<span />}
        title="Test Report"
        description="A description."
        isLoading={false}
        lastRefreshedAt={null}
        loadingNoun="the test data"
        kiosk
      >
        <span>The chart</span>
      </ReportPageShell>,
    );
    expect(screen.queryByText("Back")).not.toBeInTheDocument();
    expect(screen.queryByText("Reports")).not.toBeInTheDocument();
    expect(screen.getByText("Test Report")).toBeInTheDocument();
  });
});
