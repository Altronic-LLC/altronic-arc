import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { MrbEntry } from "@/types/task";

// =============================================================================
// The MRB export dialog: the live count follows the options, an empty or
// backwards window can't be exported, and Export downloads the chosen format
// under the window's name. The generators themselves are mocked — the PDF and
// workbook content is lib/mrbExport.test.ts's job.
// =============================================================================

const generateMrbPdf = vi.hoisted(() => vi.fn());
const generateMrbWorkbook = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mrbExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mrbExport")>()),
  generateMrbPdf,
  generateMrbWorkbook,
}));

const downloadBlob = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useQuotePdf", () => ({ downloadBlob }));

const pushToast = vi.hoisted(() => vi.fn());
vi.mock("./Toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./Toast")>()),
  pushToast,
}));

import { MrbExportModal } from "./MrbExportModal";

function entry(over: Partial<MrbEntry>): MrbEntry {
  return {
    id: 1,
    sapNumber: "",
    mrbDate: null,
    oldPartNumber: "",
    quantity: 1,
    description: "",
    reason: "",
    whereCaused: "",
    disposition: "",
    vendorName: "",
    pricePerUnit: null,
    pricePerIssue: null,
    notes: "",
    comments: [],
    watchers: [],
    dataFormat: "Current",
    sourceYear: 2026,
    provenance: {},
    hasAttachments: false,
    createdAt: new Date(0),
    modifiedAt: new Date(0),
    ...over,
  };
}

const ENTRIES = [
  entry({ id: 1, mrbDate: new Date("2026-10-10T12:00:00Z"), pricePerIssue: 40 }),
  entry({ id: 2, mrbDate: new Date("2026-03-02T12:00:00Z"), pricePerIssue: 10 }),
  entry({ id: 3, mrbDate: new Date("2026-10-12T12:00:00Z"), disposition: "Scrap", pricePerIssue: 5 }),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 20, 9, 0));
  generateMrbPdf.mockResolvedValue(new Blob(["pdf"]));
  generateMrbWorkbook.mockResolvedValue(new Blob(["xlsx"]));
});

afterEach(() => {
  vi.useRealTimers();
  generateMrbPdf.mockReset();
  generateMrbWorkbook.mockReset();
  downloadBlob.mockReset();
  pushToast.mockReset();
});

describe("MrbExportModal", () => {
  it("opens on the last 30 days with every undecided entry included", () => {
    renderWithProviders(<MrbExportModal entries={ENTRIES} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("2 need a disposition · 1 decided · $55.00");
  });

  it("drops the older undecided entry when that option is unticked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrbExportModal entries={ENTRIES} onClose={() => {}} />);
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("status")).toHaveTextContent("1 need a disposition · 1 decided · $45.00");
  });

  it("can't export an empty window", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrbExportModal entries={[ENTRIES[2]]} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(screen.getByRole("status")).toHaveTextContent("Nothing to export");
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });

  it("exports a PDF named after the window, then closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<MrbExportModal entries={ENTRIES} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Export" }));
    await act(async () => {});
    expect(generateMrbPdf).toHaveBeenCalledTimes(1);
    expect(generateMrbWorkbook).not.toHaveBeenCalled();
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "MRB 2026-09-21 to 2026-10-20.pdf");
    expect(onClose).toHaveBeenCalled();
  });

  it("exports Excel when picked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrbExportModal entries={ENTRIES} onClose={() => {}} />);
    await user.click(screen.getByRole("radio", { name: "Excel" }));
    await user.click(screen.getByRole("button", { name: "Export" }));
    await act(async () => {});
    expect(generateMrbWorkbook).toHaveBeenCalledTimes(1);
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "MRB 2026-09-21 to 2026-10-20.xlsx");
  });

  it("keeps the dialog open and says so when the build fails", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    generateMrbPdf.mockRejectedValue(new Error("boom"));
    renderWithProviders(<MrbExportModal entries={ENTRIES} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Export" }));
    await act(async () => {});
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Couldn't build the export: boom", variant: "error" }),
    );
  });
});
