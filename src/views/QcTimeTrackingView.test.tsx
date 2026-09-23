import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  entries: [] as unknown[],
  isLoading: false,
}));
const deleteMutate = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useQcTimeTracking", () => ({
  useQcTimeEntries: () => ({ data: state.entries, isLoading: state.isLoading }),
  useDeleteQcTimeEntry: () => ({ mutate: deleteMutate, isPending: false }),
}));

// Delete is admin-only, so the suites below flip this rather than mocking
// the gate per test.
const adminAccess = vi.hoisted(() => ({ isAdmin: false, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
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

// Reset BOTH the admin flag and the delete spy between tests. Without this a
// suite that flips isAdmin true leaks into the next one's "non-admin sees no
// delete" case and makes it pass (or fail) for the wrong reason — the same
// mock-state leak that made a Feature Request guard test pass spuriously.
beforeEach(() => {
  adminAccess.isAdmin = false;
  adminAccess.isResolving = false;
  deleteMutate.mockClear();
});

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
    onHold: false,
    holdReason: "",
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
    // The header's own count also reads "Loading…" while isLoading is true,
    // so a bare /loading/i matches both it and LoadingTasks' headline —
    // match LoadingTasks' verb + noun specifically (verb rotates, so loose
    // on that half), the same convention other views use.
    expect(screen.getByText(/\w+ qc time entries$/i)).toBeInTheDocument();
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
    // The phone card is a DIV now, not one big button — the delete control
    // has to live inside it, and a button can't nest a button. Several
    // buttons therefore share this label (the header pencil, the card body);
    // the one carrying the field list is the one to assert against.
    const card = screen
      .getAllByRole("button", { name: "Edit entry for DE-4000 Refresh" })
      .find((el) => el.textContent?.includes("Week"))!;
    expect(card).toBeDefined();
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
    const card = screen
      .getAllByRole("button", { name: "Edit entry for DE-4000 Refresh" })
      .find((el) => el.textContent?.includes("Week"))!;
    // dl/dt/dd renders each blank field's value as an em dash — assert at
    // least one shows up rather than pinning an exact count.
    expect(within(card).getAllByText("—").length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Delete — ADMIN-ONLY, and only for a duplicate.
//
// This list had no delete at all until 2026-09-16, on the "a record of what
// happened is corrected, not removed" rule. Two techs working one panel
// produce a genuine duplicate, and there is nothing to correct in a row that
// shouldn't exist (Ray). Admin-only matches the Teradyne Log, and matches what
// SharePoint permits — deleting an item needs more permission than editing one.
// =============================================================================
describe("delete", () => {
  it("offers NO delete to a non-admin", () => {
    adminAccess.isAdmin = false;
    state.entries = [makeEntry()];
    state.isLoading = false;
    renderWithProviders(<QcTimeTrackingView />);
    expect(screen.queryByRole("button", { name: /^delete entry/i })).not.toBeInTheDocument();
  });

  it("offers it to an admin", () => {
    adminAccess.isAdmin = true;
    state.entries = [makeEntry()];
    state.isLoading = false;
    renderWithProviders(<QcTimeTrackingView />);
    expect(
      screen.getAllByRole("button", { name: /^delete entry/i }).length,
    ).toBeGreaterThan(0);
  });

  it("CONFIRMS before deleting, naming the entry and saying what it is for", async () => {
    adminAccess.isAdmin = true;
    state.entries = [makeEntry()];
    state.isLoading = false;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<QcTimeTrackingView />);

    await userEvent.click(screen.getAllByRole("button", { name: /^delete entry/i })[0]);

    expect(confirm).toHaveBeenCalledTimes(1);
    const prompt = confirm.mock.calls[0][0] as string;
    expect(prompt).toContain("DE-4000 Refresh");
    expect(prompt).toContain("duplicate");
    expect(deleteMutate).toHaveBeenCalledWith(1);
    confirm.mockRestore();
  });

  it("does NOT delete when the confirm is dismissed", async () => {
    adminAccess.isAdmin = true;
    state.entries = [makeEntry()];
    state.isLoading = false;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(<QcTimeTrackingView />);

    await userEvent.click(screen.getAllByRole("button", { name: /^delete entry/i })[0]);

    expect(deleteMutate).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
