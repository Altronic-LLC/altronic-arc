import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  entries: [] as unknown[],
  isLoading: false,
}));
vi.mock("@/hooks/useQcTimeTracking", () => ({
  useQcTimeEntries: () => ({ data: state.entries, isLoading: state.isLoading }),
}));

vi.mock("@/components/QcTimeEntryFormModal", () => ({
  QcTimeEntryFormModal: ({ entry, onClose }: { entry?: unknown; onClose: () => void }) => (
    <div role="dialog" aria-label={entry ? "Edit QC time entry" : "New QC time entry"}>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { QcTimeEntry } from "@/types/task";
import { QcTimeTrackingView } from "./QcTimeTrackingView";

function makeEntry(over: Partial<QcTimeEntry> = {}): QcTimeEntry {
  return {
    id: 1,
    project: "DE-4000 Refresh",
    week: 35,
    dateIntoQc: null,
    dateStarted: new Date("2026-08-25T12:00:00Z"),
    sapNo: "SAP-1",
    serialNo: "SN-1",
    performedBy: [{ displayName: "Kim Tech", email: "kim.tech@altronic-llc.com" }],
    performedByRaw: "Kim Tech",
    hoursRaw: "6.5",
    effortType: "New Panel",
    notes: "",
    createdAt: new Date(),
    modifiedAt: new Date(),
    ...over,
  };
}

describe("QcTimeTrackingView", () => {
  it("shows a loading state", () => {
    state.entries = [];
    state.isLoading = true;
    renderWithProviders(<QcTimeTrackingView />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows an empty state with no entries", () => {
    state.entries = [];
    state.isLoading = false;
    renderWithProviders(<QcTimeTrackingView />);
    expect(screen.getByText(/no entries yet/i)).toBeInTheDocument();
  });

  it("lists an entry, falling back to the raw text when nobody resolved", () => {
    state.entries = [makeEntry(), makeEntry({ id: 2, performedBy: [], performedByRaw: "Somebody" })];
    state.isLoading = false;
    renderWithProviders(<QcTimeTrackingView />);
    expect(screen.getByText("Kim Tech")).toBeInTheDocument();
    expect(screen.getByText("Somebody")).toBeInTheDocument();
  });

  it("filters by search across project, SAP#, serial#, performed by and notes", async () => {
    state.entries = [
      makeEntry({ id: 1, project: "DE-4000 Refresh" }),
      makeEntry({ id: 2, project: "CPU-XL Standard", sapNo: "SAP-2", serialNo: "SN-2" }),
    ];
    state.isLoading = false;
    renderWithProviders(<QcTimeTrackingView />);
    await userEvent.type(screen.getByPlaceholderText(/search project/i), "CPU-XL");
    // SearchInput debounces onChange 250ms after the last keystroke, so the
    // filtered-out row disappearing is the actual signal to wait on.
    await waitFor(() => expect(screen.queryByText("DE-4000 Refresh")).not.toBeInTheDocument());
    expect(screen.getByText("CPU-XL Standard")).toBeInTheDocument();
  });

  it("opens the New Entry modal in create mode", async () => {
    state.entries = [];
    state.isLoading = false;
    renderWithProviders(<QcTimeTrackingView />);
    await userEvent.click(screen.getByRole("button", { name: "New Entry" }));
    expect(screen.getByRole("dialog", { name: "New QC time entry" })).toBeInTheDocument();
  });

  it("opens a row in edit mode when clicked", async () => {
    state.entries = [makeEntry()];
    state.isLoading = false;
    renderWithProviders(<QcTimeTrackingView />);
    await userEvent.click(screen.getByText("DE-4000 Refresh"));
    expect(screen.getByRole("dialog", { name: "Edit QC time entry" })).toBeInTheDocument();
  });

  it("caps rendered rows and offers Show all beyond the threshold", () => {
    state.entries = Array.from({ length: 305 }, (_, i) => makeEntry({ id: i + 1, project: `Project ${i + 1}` }));
    state.isLoading = false;
    renderWithProviders(<QcTimeTrackingView />);
    expect(screen.getByText(/Show all 305/)).toBeInTheDocument();
  });
});

describe("what is deliberately absent", () => {
  it("offers no delete anywhere on the screen", () => {
    state.entries = [makeEntry()];
    state.isLoading = false;
    renderWithProviders(<QcTimeTrackingView />);
    expect(screen.queryByRole("button", { name: /delete|remove/i })).not.toBeInTheDocument();
  });
});
