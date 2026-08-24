// Build the Open Orders reports from a REAL SAP extract, through the same
// parser and builders the app uses.
//
//   node scripts/generate-open-orders-from-file.mjs "<path to extract.xlsx>" [runDate]
//
// The customer list is seeded from the biggest accounts in the extract, so the
// sample shows real per-customer files; in the app that list is the managed
// SharePoint list instead.

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import ExcelJS from "exceljs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/generate-open-orders-from-file.mjs <extract.xlsx> [YYYY-MM-DD]");
  process.exit(1);
}
const outDir = join(root, "sample-open-orders-real");

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
const m = await import(pathToFileURL(bundlePath).href);

const { readFileSync } = await import("node:fs");
const buf = readFileSync(input);
const t0 = Date.now();
const parsed = await m.readOpenOrdersWorkbook(
  ExcelJS,
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
const parseMs = Date.now() - t0;

const runDate = process.argv[3]
  ? new Date(`${process.argv[3]}T12:00:00Z`)
  : new Date(
      Math.max(...parsed.lines.map((l) => (l.orderDate ? l.orderDate.getTime() : 0))),
    );

console.log(`sheet "${parsed.sheetName}" of [${parsed.availableSheets.join(", ")}]`);
console.log(`header row ${parsed.headerRow}, ${parsed.lines.length} lines, parsed in ${parseMs}ms`);
console.log(`run date ${runDate.toISOString().slice(0, 10)}`);
for (const w of parsed.warnings) console.log(`  ! ${w.message}`);

const metrics = m.metricsFor(parsed.lines, runDate);
console.log(`\nopen value: ${metrics.byCurrency.map((c) => `${c.currency} ${c.openValue.toLocaleString()}`).join(" + ")}`);
console.log(`past due:   ${metrics.byCurrency.map((c) => `${c.currency} ${c.pastDueValue.toLocaleString()}`).join(" + ")}`);
console.log(`lines ${metrics.lines}, orders ${metrics.orders}, repairs ${metrics.repairLines}, unpriced ${metrics.unpricedLines}`);
console.log("aging:");
for (const b of metrics.aging) {
  console.log(`  ${b.bucket.padEnd(16)} ${String(b.lines).padStart(5)} lines  ${b.openValue.toLocaleString()}`);
}

// Seed a customer list from the biggest accounts, cleaning SAP's truncation.
const rollup = m.customerRollup(parsed.lines, runDate);
const accounts = rollup.slice(0, 8).map((entry, i) => ({
  id: i + 1,
  accountNumber: entry.soldTo,
  customerName: entry.customerName.replace(/[,\s]+$/, ""),
  regionalManager: "",
  active: true,
  notes: "",
}));

rmSync(outDir, { recursive: true, force: true });
const weekDir = join(outDir, m.weekFolderName(runDate));
mkdirSync(weekDir, { recursive: true });

const ctx = { runDate, generatedBy: "Sample run from a live extract" };
const t1 = Date.now();
const master = await m.buildMasterWorkbook(ExcelJS, parsed.lines, accounts, ctx);
const masterName = m.masterWorkbookName(runDate);
writeFileSync(join(outDir, masterName), Buffer.from(await master.xlsx.writeBuffer()));
console.log(`\nmaster   ${masterName}`);

const reports = m.customerReportsFor(accounts, parsed.lines, runDate);
for (const report of reports) {
  const account = accounts.find(
    (a) =>
      a.accountNumber.replace(/^0+/, "").toUpperCase() ===
      report.soldTo.replace(/^0+/, "").toUpperCase(),
  );
  const wb = await m.buildCustomerWorkbook(ExcelJS, report, account, ctx);
  const name = m.customerWorkbookName(report.customerName, runDate);
  writeFileSync(join(weekDir, name), Buffer.from(await wb.xlsx.writeBuffer()));
  console.log(`customer ${name}  (${report.metrics.lines} lines, ${report.repairLines.length} repair)`);
}
console.log(`\n${reports.length + 1} workbooks written in ${Date.now() - t1}ms`);
console.log(outDir);

rmSync(bundlePath, { force: true });
