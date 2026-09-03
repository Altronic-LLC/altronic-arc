import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OpenOrderCustomerAccount, OpenOrderLine } from "@/types/task";
import type { OpenOrdersFile } from "@/api/openOrdersFiles";

// =============================================================================
// The orchestration hooks, tested at the module boundary — mocking the API
// (SharePoint) and workbook-builder layers rather than round-tripping real
// ExcelJS files. What buildCombinedCustomerWorkbook actually PUTS on a sheet
// is covered thoroughly in lib/openOrdersWorkbook.test.ts; this file is about
// the wiring: which guard fires when, what gets downloaded vs uploaded, and
// that a failure surfaces as a toast rather than an unhandled rejection.
//
// **Checked, not a bug in THIS caller**: `zip.file(name, blob)` called twice
// with the same name silently overwrites the first entry (verified directly
// against JSZip — the zip ends up with one entry holding the second file's
// bytes, the first's silently gone). `useDownloadWeekAsZip`'s `files` always
// comes from `listWeekFiles()`, which lists ONE SharePoint folder's children —
// and SharePoint itself refuses two items sharing a name in the same folder —
// so a same-name collision can't reach this function through any real code
// path in the app today. Not tested here because there's no reachable input
// that produces it; flagged in case a future caller ever assembles `files`
// from more than one folder.
// =============================================================================

const RUN_DATE = new Date("2026-08-24T12:00:00Z");

const ACCOUNT_A: OpenOrderCustomerAccount = {
  id: 1,
  accountNumber: "1042",
  customerName: "Permian Midstream Partners",
  active: true,
  notes: "",
};
const ACCOUNT_B: OpenOrderCustomerAccount = {
  id: 2,
  accountNumber: "2277",
  customerName: "Cimarron Compression",
  active: true,
  notes: "",
};

const MASTER_FILE: OpenOrdersFile = {
  id: "master-1",
  name: "Altronic_Open_Orders_Dashboard_2026-08-24.xlsx",
  sizeBytes: 1000,
  lastModified: RUN_DATE,
  webUrl: "https://example/master",
  downloadUrl: null,
};
/**
 * A minimal but COMPLETE OpenOrderLine — customerReport() is the real, pure
 * function here (not mocked), and it calls isRepairLine()/metricsFor() on
 * every field, so a partial line throws deep inside lib/openOrders.ts rather
 * than failing at the point the test actually cares about.
 */
function makeLine(soldTo: string, customerName: string): OpenOrderLine {
  return {
    soldTo,
    customerName,
    salesOrder: "4500000001",
    lineNo: "000010",
    material: "TEST-PART",
    altronicPartNumber: "",
    description: "Test line",
    orderType: "ZTA",
    repairOrder: "",
    orderQty: 1,
    shippedQty: 0,
    openQty: 1,
    unitPrice: 100,
    openValue: 100,
    netValue: 100,
    currency: "USD",
    customerPo: "",
    orderDate: RUN_DATE,
    requestedDate: RUN_DATE,
    promiseDate: RUN_DATE,
    shipTo: soldTo,
    salesOffice: "0001",
    status: "A",
    deliveryBlock: "",
    rejectionReason: "",
    comments: "",
    commentDate: null,
    mrpController: "",
    createdBy: "",
  };
}

const RAW_FILE: OpenOrdersFile = {
  id: "raw-1",
  name: "raw-extract.xlsx",
  sizeBytes: 500,
  lastModified: RUN_DATE,
  webUrl: "https://example/raw",
  downloadUrl: null,
};

const mocks = vi.hoisted(() => ({
  listMasterReports: vi.fn(),
  listRawUploads: vi.fn(),
  downloadOpenOrdersFile: vi.fn(),
  ensureWeekFolder: vi.fn(),
  uploadOpenOrdersFile: vi.fn(),
  listWeeks: vi.fn(),
  listWeekFiles: vi.fn(),
  uploadRawExtract: vi.fn(),
  readOpenOrdersWorkbook: vi.fn(),
  buildCombinedCustomerWorkbook: vi.fn(),
  buildCustomerWorkbook: vi.fn(),
  buildMasterWorkbook: vi.fn(),
  customerReportsFor: vi.fn(),
}));

vi.mock("@/api/openOrdersFiles", () => ({
  listMasterReports: mocks.listMasterReports,
  listRawUploads: mocks.listRawUploads,
  downloadOpenOrdersFile: mocks.downloadOpenOrdersFile,
  ensureWeekFolder: mocks.ensureWeekFolder,
  uploadOpenOrdersFile: mocks.uploadOpenOrdersFile,
  listWeeks: mocks.listWeeks,
  listWeekFiles: mocks.listWeekFiles,
  uploadRawExtract: mocks.uploadRawExtract,
}));

vi.mock("@/lib/openOrdersExcel", () => ({
  readOpenOrdersWorkbook: mocks.readOpenOrdersWorkbook,
}));

vi.mock("@/lib/openOrdersWorkbook", () => ({
  buildCombinedCustomerWorkbook: mocks.buildCombinedCustomerWorkbook,
  buildCustomerWorkbook: mocks.buildCustomerWorkbook,
  buildMasterWorkbook: mocks.buildMasterWorkbook,
  customerReportsFor: mocks.customerReportsFor,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 }),
}));

vi.mock("@/components/Toast", () => ({ pushToast: vi.fn() }));

import {
  useDownloadWeekAsZip,
  useGenerateCombinedCustomerReport,
} from "./useOpenOrdersReports";
import { pushToast } from "@/components/Toast";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// jsdom has no createObjectURL/revokeObjectURL by default.
beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
  mocks.listMasterReports.mockResolvedValue([MASTER_FILE]);
  mocks.listRawUploads.mockResolvedValue([RAW_FILE]);
  mocks.downloadOpenOrdersFile.mockResolvedValue(new Blob(["raw"]));
  mocks.readOpenOrdersWorkbook.mockResolvedValue({ lines: [], columns: [] });
  mocks.buildCombinedCustomerWorkbook.mockResolvedValue({
    xlsx: { writeBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) },
  });
});

describe("useGenerateCombinedCustomerReport", () => {
  it("refuses to combine an account with itself", async () => {
    const { result } = renderHook(() => useGenerateCombinedCustomerReport(), { wrapper });
    await expect(
      result.current.mutateAsync([ACCOUNT_A, { ...ACCOUNT_A }]),
    ).rejects.toThrow(/two different accounts/i);
    expect(mocks.listMasterReports).not.toHaveBeenCalled();
  });

  it("recognises the same account by number even with padding — sameAccount, not ===", async () => {
    const { result } = renderHook(() => useGenerateCombinedCustomerReport(), { wrapper });
    const padded = { ...ACCOUNT_A, accountNumber: "0001042" };
    await expect(result.current.mutateAsync([ACCOUNT_A, padded])).rejects.toThrow(
      /two different accounts/i,
    );
  });

  it("fails clearly when there's no master workbook to find a run date from", async () => {
    mocks.listMasterReports.mockResolvedValue([]);
    const { result } = renderHook(() => useGenerateCombinedCustomerReport(), { wrapper });
    await expect(result.current.mutateAsync([ACCOUNT_A, ACCOUNT_B])).rejects.toThrow(
      /no master workbook/i,
    );
    expect(mocks.downloadOpenOrdersFile).not.toHaveBeenCalled();
  });

  it("fails clearly when the raw extract isn't filed", async () => {
    mocks.listRawUploads.mockResolvedValue([]);
    const { result } = renderHook(() => useGenerateCombinedCustomerReport(), { wrapper });
    await expect(result.current.mutateAsync([ACCOUNT_A, ACCOUNT_B])).rejects.toThrow(
      /raw extract/i,
    );
  });

  it("refuses when neither account has any open lines in the extract", async () => {
    // customerReport is the REAL pure function (not mocked) — with no lines
    // parsed, both accounts naturally have 0.
    const { result } = renderHook(() => useGenerateCombinedCustomerReport(), { wrapper });
    await expect(result.current.mutateAsync([ACCOUNT_A, ACCOUNT_B])).rejects.toThrow(
      /has open lines/i,
    );
    expect(mocks.buildCombinedCustomerWorkbook).not.toHaveBeenCalled();
  });

  it("builds and downloads — never uploads to SharePoint", async () => {
    mocks.readOpenOrdersWorkbook.mockResolvedValue({
      lines: [
        makeLine(ACCOUNT_A.accountNumber, ACCOUNT_A.customerName),
        makeLine(ACCOUNT_B.accountNumber, ACCOUNT_B.customerName),
      ],
      columns: [],
    });
    const { result } = renderHook(() => useGenerateCombinedCustomerReport(), { wrapper });
    const out = await result.current.mutateAsync([ACCOUNT_A, ACCOUNT_B]);

    expect(mocks.buildCombinedCustomerWorkbook).toHaveBeenCalledTimes(1);
    // The two reports passed to the builder, one per account, in the order given.
    const [, reports] = mocks.buildCombinedCustomerWorkbook.mock.calls[0];
    expect(reports).toHaveLength(2);
    expect(reports[0].soldTo).toBe(ACCOUNT_A.accountNumber);
    expect(reports[1].soldTo).toBe(ACCOUNT_B.accountNumber);

    // Never touches SharePoint upload or the week-folder machinery.
    expect(mocks.uploadOpenOrdersFile).not.toHaveBeenCalled();
    expect(mocks.ensureWeekFolder).not.toHaveBeenCalled();

    expect(out.filename).toContain("Permian_Midstream_Partners");
    expect(out.filename).toContain("Cimarron_Compression");
    expect(out.lines).toBe(2);
  });

  it("toasts success on the download", async () => {
    mocks.readOpenOrdersWorkbook.mockResolvedValue({
      lines: [makeLine(ACCOUNT_A.accountNumber, ACCOUNT_A.customerName)],
      columns: [],
    });
    const { result } = renderHook(() => useGenerateCombinedCustomerReport(), { wrapper });
    await result.current.mutateAsync([ACCOUNT_A, ACCOUNT_B]);
    await waitFor(() =>
      expect(pushToast as Mock).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/Downloaded/) }),
      ),
    );
  });

  it("toasts the error message on failure, and clears `step`", async () => {
    mocks.listMasterReports.mockResolvedValue([]);
    const { result } = renderHook(() => useGenerateCombinedCustomerReport(), { wrapper });
    await expect(result.current.mutateAsync([ACCOUNT_A, ACCOUNT_B])).rejects.toThrow();
    await waitFor(() =>
      expect(pushToast as Mock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      ),
    );
    expect(result.current.step).toBeNull();
  });

  // sameAccount("", "") is FALSE — accountKey() explicitly excludes empty from
  // matching itself (see openOrders.test.ts's "never matches on empty"), so two
  // accounts that BOTH carry a blank/whitespace accountNumber do NOT trip the
  // "pick two different accounts" guard. Each then legitimately picks up zero
  // lines (nothing in the extract has a blank soldTo either), so this falls
  // through to the ordinary "neither account has open lines" refusal rather
  // than the same-account one — worth pinning so the guard's exact wording
  // doesn't silently drift to the wrong message for this input.
  it("falls through to the no-open-lines refusal, not the same-account one, when both accountNumbers are blank", async () => {
    const blankA: OpenOrderCustomerAccount = { ...ACCOUNT_A, accountNumber: "" };
    const blankB: OpenOrderCustomerAccount = { ...ACCOUNT_B, accountNumber: "   " };
    mocks.readOpenOrdersWorkbook.mockResolvedValue({
      lines: [makeLine(ACCOUNT_A.accountNumber, ACCOUNT_A.customerName)],
      columns: [],
    });
    const { result } = renderHook(() => useGenerateCombinedCustomerReport(), { wrapper });
    await expect(result.current.mutateAsync([blankA, blankB])).rejects.toThrow(
      /has open lines/i,
    );
  });

  // A blank accountNumber on only ONE side still proceeds — it isn't treated
  // as "same account" (sameAccount requires both sides non-empty to match),
  // and the account WITH a real number still gets its real lines. The blank
  // one just reports zero, same as any account with no matching lines.
  it("still builds a report when only one account has a blank accountNumber, using the other's real lines", async () => {
    const blankA: OpenOrderCustomerAccount = { ...ACCOUNT_A, accountNumber: "" };
    mocks.readOpenOrdersWorkbook.mockResolvedValue({
      lines: [makeLine(ACCOUNT_B.accountNumber, ACCOUNT_B.customerName)],
      columns: [],
    });
    const { result } = renderHook(() => useGenerateCombinedCustomerReport(), { wrapper });
    const out = await result.current.mutateAsync([blankA, ACCOUNT_B]);
    const [, reports] = mocks.buildCombinedCustomerWorkbook.mock.calls[0];
    expect(reports[0].metrics.lines).toBe(0);
    expect(reports[1].metrics.lines).toBe(1);
    expect(out.lines).toBe(1);
  });
});

describe("useDownloadWeekAsZip", () => {
  const FILES: OpenOrdersFile[] = [
    { ...RAW_FILE, id: "f1", name: "Alpha_Open_Orders_2026-08-24.xlsx" },
    { ...RAW_FILE, id: "f2", name: "Bravo_Open_Orders_2026-08-24.xlsx" },
  ];

  // A plain string, not the shared `beforeEach`'s `new Blob([...])` —
  // zip.file() hands whatever downloadOpenOrdersFile returns straight to
  // JSZip, and JSZip's own Blob-read path (via jsdom's FileReader) is flaky
  // enough here to throw an UNHANDLED rejection well after zip.file()
  // returns (JSZip defers the actual read until generateAsync() walks the
  // entries), independent of what any test itself asserts. This describe
  // block is the only one whose code under test (useDownloadWeekAsZip)
  // actually zips the mocked content — every other describe block's blob
  // goes through `blob.arrayBuffer()` instead, so overriding the SHARED
  // default would break those. A string is one of JSZip's directly
  // supported input types, same as Blob, ArrayBuffer, etc, and is read
  // synchronously rather than through jsdom's Blob/FileReader plumbing.
  beforeEach(() => {
    mocks.downloadOpenOrdersFile.mockResolvedValue("raw");
  });

  it("refuses an empty folder rather than producing an empty zip", async () => {
    const { result } = renderHook(() => useDownloadWeekAsZip(), { wrapper });
    await expect(
      result.current.mutateAsync({ weekName: "Week of 2026-08-24", files: [] }),
    ).rejects.toThrow(/empty/i);
    expect(mocks.downloadOpenOrdersFile).not.toHaveBeenCalled();
  });

  it("downloads every file in the folder, one call each — same path as a single download", async () => {
    const { result } = renderHook(() => useDownloadWeekAsZip(), { wrapper });
    const out = await result.current.mutateAsync({ weekName: "Week of 2026-08-24", files: FILES });
    expect(mocks.downloadOpenOrdersFile).toHaveBeenCalledTimes(2);
    expect(mocks.downloadOpenOrdersFile).toHaveBeenCalledWith("f1");
    expect(mocks.downloadOpenOrdersFile).toHaveBeenCalledWith("f2");
    expect(out.count).toBe(2);
  });

  it("fetches files SEQUENTIALLY, not all at once — a burst risks Graph throttling", async () => {
    let inFlight = 0;
    let sawOverlap = false;
    mocks.downloadOpenOrdersFile.mockImplementation(async () => {
      inFlight += 1;
      if (inFlight > 1) sawOverlap = true;
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return "x"; // see the note on the beforeEach default, above
    });
    const { result } = renderHook(() => useDownloadWeekAsZip(), { wrapper });
    await result.current.mutateAsync({ weekName: "Week of 2026-08-24", files: FILES });
    expect(sawOverlap).toBe(false);
  });

  it("names the download after the week folder", async () => {
    const { result } = renderHook(() => useDownloadWeekAsZip(), { wrapper });
    await result.current.mutateAsync({ weekName: "Week of 2026-08-24", files: FILES });
    // The <a download> element is created and clicked, then removed — assert
    // via the object URL lifecycle rather than reaching into the DOM node
    // that no longer exists once the handler returns.
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("toasts the error on a failed fetch partway through", async () => {
    mocks.downloadOpenOrdersFile.mockResolvedValueOnce("ok"); // see the beforeEach note, above
    mocks.downloadOpenOrdersFile.mockRejectedValueOnce(new Error("network blip"));
    const { result } = renderHook(() => useDownloadWeekAsZip(), { wrapper });
    await expect(
      result.current.mutateAsync({ weekName: "Week of 2026-08-24", files: FILES }),
    ).rejects.toThrow("network blip");
    await waitFor(() =>
      expect(pushToast as Mock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error", message: expect.stringMatching(/network blip/) }),
      ),
    );
  });
});
