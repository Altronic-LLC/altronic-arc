import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { MrbEntry } from "@/types/task";

// =============================================================================
// One MRB entry.
//
// Narrow and per-feature, the same convention as DetailView.watchers /
// DetailView.projectRef — there is no broader harness for a detail view in
// this repo.
//
// **A note on what this canNOT cover.** The watcher dropdown was unreadable
// because its panel is `absolute left-0 right-0` and the trigger was
// chip-sized, so every name truncated. jsdom applies no CSS layout and this
// project has no browser automation, so nothing here can measure that. The
// fix was a layout one, checked by eye on a real phone (Tim, 2026-09-21);
// these cases pin the behaviour around it instead.
// =============================================================================

const listMrbEntries = vi.hoisted(() => vi.fn());
const mrbWatchersAvailable = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/api/mrb", () => ({
  listMrbEntries,
  mrbWatchersAvailable,
  addMrbComment: vi.fn(),
  editMrbComment: vi.fn(),
  setMrbWatchers: vi.fn(),
  createMrbEntry: vi.fn(),
  updateMrbEntry: vi.fn(),
}));

// Mocked wholesale, so every member a rendered view touches must be here —
// a missing one throws "No <name> export is defined" at render time.
vi.mock("@/hooks/useAttachments", () => ({
  useAttachments: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useUploadAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
  useCommentFileUpload: () => vi.fn(),
  useAttachmentBlobUrl: () => ({ data: null }),
  attachmentsKey: () => ["attachments"],
}));

vi.mock("@/hooks/useDirectory", () => ({
  useDirectoryPeople: () => [],
  useDirectoryDiagnostics: () => ({ data: null }),
}));

import { MrbDetailView } from "./MrbDetailView";

function entry(over: Partial<MrbEntry> = {}): MrbEntry {
  return {
    id: 42,
    sapNumber: "1000-1347-00",
    mrbDate: new Date("2026-09-08T12:00:00Z"),
    oldPartNumber: "EC10009",
    quantity: 1,
    description: "Can Machining",
    reason: "Paint chipping",
    whereCaused: "Operator Error",
    disposition: "",
    vendorName: "",
    pricePerUnit: 85,
    pricePerIssue: 85,
    notes: "Raw material# 1013-8626-00 from Newark",
    comments: [],
    watchers: [],
    dataFormat: "Current",
    sourceYear: 2026,
    // Filled on EVERY row, live ones included — the bug below.
    provenance: { sourceWorkbookRow: "97" },
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
    ...over,
  };
}

function render(e: MrbEntry) {
  listMrbEntries.mockResolvedValue([e]);
  return renderWithProviders(<MrbDetailView />, {
    route: `/supply-chain/mrb/${e.id}`,
    routePattern: "/supply-chain/mrb/:id",
  });
}

beforeEach(() => {
  listMrbEntries.mockReset();
  mrbWatchersAvailable.mockReturnValue(true);
});

describe("MrbDetailView — the source-workbook card", () => {
  // Tim caught this on 1000-1347-00: field_23 is populated on all 97 live
  // rows, so a "show any non-blank provenance column" rule put a whole card
  // on a live entry containing one meaningless spreadsheet row index.
  it("is HIDDEN on a live entry, even though it carries a workbook row", async () => {
    render(entry());
    await screen.findByText("Can Machining");
    expect(screen.queryByText(/From the source workbook/i)).not.toBeInTheDocument();
    expect(screen.queryByText("97")).not.toBeInTheDocument();
  });

  it("is SHOWN on an archive entry", async () => {
    render(entry({ dataFormat: "Legacy" }));
    expect(await screen.findByText(/From the source workbook/i)).toBeInTheDocument();
    expect(screen.getByText("97")).toBeInTheDocument();
  });

  it("labels an archive entry as archive", async () => {
    render(entry({ dataFormat: "Legacy" }));
    expect(await screen.findByText("Archive")).toBeInTheDocument();
  });
});

describe("MrbDetailView — discussion", () => {
  it("renders the comment thread and a watcher picker", async () => {
    render(entry());
    expect(await screen.findByText("Discussion")).toBeInTheDocument();
    expect(screen.getByText("Watchers")).toBeInTheDocument();
    expect(screen.getByText("No watchers")).toBeInTheDocument();
  });

  it("shows an existing comment", async () => {
    render(
      entry({
        comments: [
          {
            timestamp: new Date("2026-09-21T13:05:00Z"),
            authorName: "Tim Webster",
            authorEmail: "tim.webster@altronic-llc.com",
            bodyHtml: "<p>This is a test comment</p>",
            attachments: [],
          },
        ],
      }),
    );
    expect(await screen.findByText("This is a test comment")).toBeInTheDocument();
  });

  // Before the Watchers column exists the picker must not be offered at all —
  // its save could only fail.
  it("says watchers aren't set up when the column is missing", async () => {
    mrbWatchersAvailable.mockReturnValue(false);
    render(entry());
    await screen.findByText("Discussion");
    expect(screen.getByText("Not set up yet")).toBeInTheDocument();
    expect(screen.queryByText("No watchers")).not.toBeInTheDocument();
  });
});

describe("MrbDetailView — the cost mismatch warning", () => {
  it("flags a stored total that disagrees with unit x quantity", async () => {
    render(entry({ quantity: 3, pricePerUnit: 102, pricePerIssue: 102 }));
    await screen.findByText("Can Machining");
    expect(screen.getByText(/unit × qty/i)).toBeInTheDocument();
  });

  it("stays quiet when they agree", async () => {
    render(entry({ quantity: 2, pricePerUnit: 50, pricePerIssue: 100 }));
    await screen.findByText("Can Machining");
    expect(screen.queryByText(/unit × qty/i)).not.toBeInTheDocument();
  });
});
