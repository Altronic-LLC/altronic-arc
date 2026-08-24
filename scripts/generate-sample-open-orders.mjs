// Generate the sample Open Orders workbooks from the mock fixtures, so the
// layout and branding can be reviewed in Excel before any of it is wired into
// ARC's UI.
//
//   node scripts/generate-sample-open-orders.mjs [outDir]
//
// Writes the master dashboard plus one workbook per customer on the managed
// list into `outDir` (default: ./sample-open-orders), mirroring the SharePoint
// shape — master at the root, customer files in the week subfolder.
//
// It runs the SAME builders the app uses (src/lib/openOrdersWorkbook.ts) via
// a tiny esbuild bundle, rather than a Node-only copy of them. A sample built
// by different code proves nothing about what ARC will produce.

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ExcelJS from "exceljs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = process.argv[2] ? join(root, process.argv[2]) : join(root, "sample-open-orders");

// Bundle the app's own modules to a temp file we can import.
const bundlePath = join(here, ".open-orders-sample-bundle.mjs");
await build({
  entryPoints: [join(here, "open-orders-sample-entry.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundlePath,
  external: ["exceljs"],
  logLevel: "error",
  alias: { "@": join(root, "src") },
});

const {
  MOCK_OPEN_ORDER_LINES,
  MOCK_OPEN_ORDER_ACCOUNTS,
  MOCK_RUN_DATE,
  buildMasterWorkbook,
  buildCustomerWorkbook,
  customerReportsFor,
  masterWorkbookName,
  customerWorkbookName,
  weekFolderName,
} = await import(`file://${bundlePath.replace(/\\/g, "/")}`);

const runDate = MOCK_RUN_DATE;
const ctx = { runDate, generatedBy: "Sample run (mock data)" };

rmSync(outDir, { recursive: true, force: true });
const weekDir = join(outDir, weekFolderName(runDate));
mkdirSync(weekDir, { recursive: true });

// ---- master ---------------------------------------------------------------
const master = await buildMasterWorkbook(
  ExcelJS,
  MOCK_OPEN_ORDER_LINES,
  MOCK_OPEN_ORDER_ACCOUNTS,
  ctx,
);
const masterName = masterWorkbookName(runDate);
writeFileSync(join(outDir, masterName), Buffer.from(await master.xlsx.writeBuffer()));
console.log(`master   ${masterName}`);

// ---- per customer ---------------------------------------------------------
const reports = customerReportsFor(MOCK_OPEN_ORDER_ACCOUNTS, MOCK_OPEN_ORDER_LINES, runDate);
for (const report of reports) {
  const account = MOCK_OPEN_ORDER_ACCOUNTS.find(
    (a) =>
      a.accountNumber.replace(/^0+/, "").toUpperCase() ===
      report.soldTo.replace(/^0+/, "").toUpperCase(),
  );
  const wb = await buildCustomerWorkbook(ExcelJS, report, account, ctx);
  const name = customerWorkbookName(report.customerName, runDate);
  writeFileSync(join(weekDir, name), Buffer.from(await wb.xlsx.writeBuffer()));
  console.log(`customer ${name}  (${report.metrics.lines} lines, ${report.repairLines.length} repair)`);
}

const skipped = MOCK_OPEN_ORDER_ACCOUNTS.filter(
  (a) => a.active && !reports.some((r) => r.soldTo === a.accountNumber),
);
for (const a of skipped) {
  console.log(`skipped  ${a.customerName} — no open lines (see the Coverage tab)`);
}

rmSync(bundlePath, { force: true });
console.log(`\n${outDir}`);
