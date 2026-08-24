import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  downloadOpenOrdersFile,
  ensureWeekFolder,
  listMasterReports,
  listRawUploads,
  listWeekFiles,
  listWeeks,
  uploadOpenOrdersFile,
  uploadRawExtract,
} from "@/api/openOrdersFiles";
import { readOpenOrdersWorkbook } from "@/lib/openOrdersExcel";
import type { ParseWarning } from "@/lib/openOrdersParse";
import {
  buildCustomerWorkbook,
  buildMasterWorkbook,
  customerReportsFor,
} from "@/lib/openOrdersWorkbook";
import {
  customerWorkbookName,
  masterWorkbookName,
  sameAccount,
  weekFolderName,
} from "@/lib/openOrders";
import type { OpenOrderCustomerAccount, OpenOrderLine } from "@/types/task";
import { useCurrentUser } from "./useCurrentUser";
import { pushToast } from "@/components/Toast";

// =============================================================================
// The weekly run: read the extract, build the workbooks, put them in SharePoint.
//
// All of it happens in the BROWSER. ARC is a static site with no server and no
// scheduler, so "every Monday" is a person pressing a button — which is why the
// screen says so rather than implying the app does it by itself.
//
// **ExcelJS is imported dynamically**, once, on the first generate. It is
// ~950KB and would otherwise sit in the main bundle for the whole company to
// download in order to read a task list.
// =============================================================================

export const OPEN_ORDERS_FILES_KEY = ["openOrdersFiles"] as const;

export function useMasterReports() {
  return useQuery({
    queryKey: [...OPEN_ORDERS_FILES_KEY, "masters"],
    queryFn: listMasterReports,
    staleTime: 30_000,
  });
}

export function useOpenOrdersWeeks() {
  return useQuery({
    queryKey: [...OPEN_ORDERS_FILES_KEY, "weeks"],
    queryFn: listWeeks,
    staleTime: 30_000,
  });
}

export function useOpenOrdersWeekFiles(weekName: string | null) {
  return useQuery({
    queryKey: [...OPEN_ORDERS_FILES_KEY, "week", weekName],
    queryFn: () => listWeekFiles(weekName!),
    enabled: !!weekName,
    staleTime: 30_000,
  });
}

export function useRawUploads() {
  return useQuery({
    queryKey: [...OPEN_ORDERS_FILES_KEY, "raw"],
    queryFn: listRawUploads,
    staleTime: 30_000,
  });
}

/** One ExcelJS instance, loaded on demand and reused. */
let excelModule: typeof import("exceljs") | null = null;
async function excel(): Promise<typeof import("exceljs")> {
  excelModule ??= await import("exceljs");
  return excelModule;
}

export interface ParsedExtract {
  filename: string;
  /** The bytes, kept so the raw file can be filed alongside its reports. */
  body: ArrayBuffer;
  lines: OpenOrderLine[];
  warnings: ParseWarning[];
  sheetName: string;
  availableSheets: string[];
  headerRow: number;
}

/**
 * Read a dropped file into lines, without generating anything.
 *
 * Deliberately a separate step from generating: the warnings (mixed currency,
 * unpriced lines, a column ARC doesn't read) are worth looking at BEFORE
 * ~40 files land in a shared folder.
 */
export function useParseExtract() {
  const [parsing, setParsing] = useState(false);

  const parse = useCallback(async (file: File): Promise<ParsedExtract> => {
    setParsing(true);
    try {
      const body = await file.arrayBuffer();
      const excelJs = await excel();
      // A copy, because ExcelJS takes ownership of the buffer it loads and the
      // same bytes are uploaded afterwards.
      const result = await readOpenOrdersWorkbook(excelJs, body.slice(0));
      return {
        filename: file.name,
        body,
        lines: result.lines,
        warnings: result.warnings,
        sheetName: result.sheetName,
        availableSheets: result.availableSheets,
        headerRow: result.headerRow,
      };
    } finally {
      setParsing(false);
    }
  }, []);

  return { parse, parsing };
}

export interface GenerateInput {
  extract: ParsedExtract;
  accounts: OpenOrderCustomerAccount[];
  runDate: Date;
  /** File the raw extract in RAW UPLOADS alongside the reports. */
  keepRaw: boolean;
}

export interface GenerateProgress {
  /** What is happening right now, for the button's label. */
  step: string;
  done: number;
  total: number;
}

export interface GenerateResult {
  masterName: string;
  weekFolder: string;
  customerFiles: string[];
  /** Accounts on the list that the extract had nothing for. */
  skipped: OpenOrderCustomerAccount[];
}

/**
 * Build and upload everything for one run.
 *
 * The master goes to the root of OPEN ORDERS and the customer files into
 * `Week of <Monday>`. Both REPLACE what's there for that week — see the note
 * on uploadOpenOrdersFile. The screen warns first.
 */
export function useGenerateOpenOrders() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const [progress, setProgress] = useState<GenerateProgress | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: GenerateInput): Promise<GenerateResult> => {
      const { extract, accounts, runDate } = input;
      const excelJs = await excel();
      const ctx = { runDate, generatedBy: user.displayName || undefined };

      const active = accounts.filter((a) => a.active);
      const reports = customerReportsFor(accounts, extract.lines, runDate);
      const total = reports.length + 1 + (input.keepRaw ? 1 : 0);
      let done = 0;
      const tick = (step: string) => setProgress({ step, done, total });

      tick("Creating this week's folder");
      const weekFolder = await ensureWeekFolder(runDate);

      tick("Building the master dashboard");
      const master = await buildMasterWorkbook(excelJs, extract.lines, accounts, ctx);
      const masterName = masterWorkbookName(runDate);
      await uploadOpenOrdersFile({
        filename: masterName,
        body: await master.xlsx.writeBuffer(),
      });
      done += 1;

      const customerFiles: string[] = [];
      for (const report of reports) {
        const account =
          active.find((a) => sameAccount(a.accountNumber, report.soldTo)) ?? {
            id: 0,
            accountNumber: report.soldTo,
            customerName: report.customerName,
            regionalManager: "",
            active: true,
            notes: "",
          };
        tick(`${report.customerName} (${done} of ${total})`);
        const wb = await buildCustomerWorkbook(excelJs, report, account, ctx);
        const filename = customerWorkbookName(report.customerName, runDate);
        await uploadOpenOrdersFile({
          folder: weekFolder,
          filename,
          body: await wb.xlsx.writeBuffer(),
        });
        customerFiles.push(filename);
        done += 1;
      }

      if (input.keepRaw) {
        tick("Filing the raw extract");
        await uploadRawExtract(extract.filename, extract.body);
        done += 1;
      }

      return {
        masterName,
        weekFolder,
        customerFiles,
        skipped: active.filter(
          (a) => !extract.lines.some((l) => sameAccount(l.soldTo, a.accountNumber)),
        ),
      };
    },
    onSuccess: (result) => {
      setProgress(null);
      qc.invalidateQueries({ queryKey: OPEN_ORDERS_FILES_KEY });
      pushToast({
        message:
          `Built ${result.customerFiles.length + 1} workbooks into ${result.weekFolder}.` +
          (result.skipped.length > 0
            ? ` ${result.skipped.length} customer${result.skipped.length === 1 ? "" : "s"} had nothing open.`
            : ""),
      });
    },
    onError: (err: Error) => {
      setProgress(null);
      pushToast({ message: `Generation stopped: ${err.message}`, variant: "error" });
    },
  });

  return { ...mutation, progress };
}

/**
 * Download a file through the browser.
 *
 * Goes via Graph rather than linking straight at SharePoint, so the file
 * arrives without a sign-in round trip in a new tab — which is the difference
 * between "download" and "open a tab, wait, click again".
 */
export function useDownloadOpenOrdersFile() {
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const blob = await downloadOpenOrdersFile(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick, not immediately: Safari cancels an in-flight
      // download if the object URL disappears in the same frame as the click.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    onError: (err: Error) =>
      pushToast({ message: `Couldn't download that file: ${err.message}`, variant: "error" }),
  });
}

/** The folder this week's files will land in, for the confirmation copy. */
export function weekFolderFor(runDate: Date): string {
  return weekFolderName(runDate);
}
