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

import { screen, waitFor, within } from "@testing-library/react";
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

  // The view renders BOTH a phone card list and a desktop table for the same
  // rows (CSS hides one or the other; jsdom has no viewport, so both are in
  // the DOM at once) — every text assertion below expects at least one match
  // rather than exactly one.
  it("lists an entry, falling back to the raw text when nobody resolved", () => {
    state.entries = [makeEntry(), makeEntry({ id: 2, performedBy: [], performedByRaw: "Somebody" })];
    state.isLoading = false;
    renderWithProviders(<QcTimeTrackingView />);
    expect(screen.getAllByText("Kim Tech").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Somebody").length).toBeGreaterThan(0);
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
    await waitFor(() => expect(screen.queryAllByText("DE-4000 Refresh")).toHaveLength(0));
    expect(screen.getAllByText("CPU-XL Standard").length).toBeGreaterThan(0);
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
    // Both the mobile card and the desktop row's Edit button share this
    // accessible name — either should open the same modal.
    const [editButton] = screen.getAllByRole("button", { name: "Edit entry for DE-4000 Refresh" });
    await userEvent.click(editButton);
    expect(screen.getByRole("dialog", { name: "Edit QC time entry" })).toBeInTheDocument();
  });

  it("caps rendered rows and offers Show all beyond the threshold", () => {
    state.entries = Array.from({ length: 305 }, (_, i) => makeEntry({ id: i + 1, project: `Project ${i + 1}` }));
    state.isLoading = false;
    renderWithProviders(<QcTimeTrackingView />);
    expect(screen.getByText(/Show all 305/)).toBeInTheDocument();
  });
});

describe("the phone card layout", () => {
  // The table's eight columns don't fit a narrow screen — even truncated,
  // it read as a wall of dashes (reported on an iPhone). Every populated
  // field gets its own labelled row on a card instead.
  it("renders a card per entry with a labelled field for everything populated", () => {
    state.entries = [makeEntry()];
    state.isLoading = false;
    renderWithProviders(<QcTimeTrackingView />);
    // The mobile card itself is the labelled button (unlike the desktop row,
    // whose Edit button is a small pencil icon inside the row) — it's the
    // first match.
    const [card] = screen.getAllByRole("button", { name: "Edit entry for DE-4000 Refresh" });
    expect(card).toHaveTextContent("Week");
    expect(card).toHaveTextContent("35");
    expect(card).toHaveTextContent("SAP#");
    expect(card).toHaveTextContent("SAP-1");
    expect(card).toHaveTextContent("Performed By");
    expect(card).toHaveTextContent("Kim Tech");
  });

  it("shows a dash for a field the real data frequently leaves blank", () => {
    state.entries = [
      makeEntry({ week: null, sapNo: "", performedBy: [], performedByRaw: "", hoursRaw: "" }),
    ];
    state.isLoading = false;
    renderWithProviders(<QcTimeTrackingView />);
    const [card] = screen.getAllByRole("button", { name: "Edit entry for DE-4000 Refresh" });
    // dl/dt/dd renders each blank field's value as an em dash — assert at
    // least one shows up rather than pinning an exact count.
    expect(within(card).getAllByText("—").length).toBeGreaterThan(0);
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
