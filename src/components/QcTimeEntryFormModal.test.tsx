import { describe, expect, it, vi, beforeEach } from "vitest";

// =============================================================================
// The QC Time Tracking form modal.
//
// What's worth pinning: Project is the only required field (the real data
// leaves everything else blank routinely), Hours is a free-text field (the
// source column has non-numeric entries), and create sends the full input
// with no field held back — there's nothing to diff against.
// =============================================================================

const createEntry = vi.hoisted(() => vi.fn(async () => ({ id: 1 })));
const updateEntry = vi.hoisted(() => vi.fn(async () => ({ id: 1 })));
vi.mock("@/hooks/useQcTimeTracking", () => ({
  useCreateQcTimeEntry: () => ({ mutateAsync: createEntry, isPending: false }),
  useUpdateQcTimeEntry: () => ({ mutateAsync: updateEntry, isPending: false }),
}));

vi.mock("@/hooks/useDirectory", () => ({
  useDirectoryPeople: () => [
    { lookupId: 61, displayName: "Kim Tech", email: "kim.tech@altronic-llc.com" },
    { lookupId: 24, displayName: "David Bulkley", email: "david.bulkley@altronic-llc.com" },
  ],
}));

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { QcTimeEntry } from "@/types/task";
import { QcTimeEntryFormModal } from "./QcTimeEntryFormModal";

const ENTRY: QcTimeEntry = {
  id: 1,
  project: "DE-4000 Refresh",
  week: 35,
  dateIntoQc: null,
  dateStarted: null,
  sapNo: "SAP-1",
  serialNo: "SN-1",
  performedBy: [{ displayName: "Kim Tech", email: "kim.tech@altronic-llc.com", lookupId: 61 }],
  performedByRaw: "Kim Tech",
  hoursRaw: "6.5",
  effortType: "New Panel",
  notes: "",
  createdAt: new Date(),
  modifiedAt: new Date(),
};

const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("creating a new entry", () => {
  it("refuses an empty project", async () => {
    renderWithProviders(<QcTimeEntryFormModal onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Log entry" }));
    expect(createEntry).not.toHaveBeenCalled();
    expect(screen.getByText("Project is required.")).toBeInTheDocument();
  });

  it("sends the whole draft — there's nothing to diff against on a create", async () => {
    renderWithProviders(<QcTimeEntryFormModal onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/^Project/), "New Test Project");
    await userEvent.type(screen.getByLabelText(/^Hours/), "not a number");
    await userEvent.click(screen.getByRole("button", { name: "Log entry" }));
    expect(createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ project: "New Test Project", hoursRaw: "not a number" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("accepts a non-numeric value in Hours, since the source column is text", async () => {
    renderWithProviders(<QcTimeEntryFormModal onClose={onClose} />);
    const hours = screen.getByLabelText(/^Hours/);
    await userEvent.type(hours, "see notes");
    expect(hours).toHaveValue("see notes");
  });
});

describe("editing an existing entry", () => {
  it("seeds the form from the entry", () => {
    renderWithProviders(<QcTimeEntryFormModal entry={ENTRY} onClose={onClose} />);
    expect(screen.getByLabelText(/^Project/)).toHaveValue("DE-4000 Refresh");
    expect(screen.getByLabelText(/^Hours/)).toHaveValue("6.5");
    expect(screen.getByLabelText(/^SAP#/)).toHaveValue("SAP-1");
  });

  it("saves through the update mutation, not create", async () => {
    renderWithProviders(<QcTimeEntryFormModal entry={ENTRY} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, input: expect.objectContaining({ project: "DE-4000 Refresh" }) }),
    );
    expect(createEntry).not.toHaveBeenCalled();
  });
});
