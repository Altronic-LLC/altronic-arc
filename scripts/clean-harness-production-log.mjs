// Clean the legacy Harness Production Report (Access → CSV) for loading into
// SharePoint, through the same rules the tests pin (src/lib/harnessLegacyClean.ts).
//
//   node scripts/clean-harness-production-log.mjs "<HARNESS PRODUCTION REPORT.csv>" [outDir] [today]
//
// Writes three files, by default into a "harness-clean" folder BESIDE the input
// — never into the repo, because they hold production data:
//
//   harness-production-log.clean.csv   one row per entry, ready for the load script
//   harness-part-numbers.csv           the part number list, with Active decided
//   harness-clean-report.md            what changed and what still needs a person
//
// Then load them with scripts/load-harness-production-log.ps1.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const input = process.argv[2];
if (!input) {
  console.error('usage: node scripts/clean-harness-production-log.mjs "<export.csv>" [outDir] [YYYY-MM-DD]');
  process.exit(1);
}
const outDir = resolve(process.argv[3] || join(dirname(resolve(input)), "harness-clean"));
const today = process.argv[4] || new Date().toISOString().slice(0, 10);

const bundlePath = join(here, ".harness-clean-bundle.mjs");
await build({
  entryPoints: [join(root, "src/lib/harnessLegacyClean.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundlePath,
  logLevel: "error",
  alias: { "@": join(root, "src") },
});
const m = await import(pathToFileURL(bundlePath).href);
rmSync(bundlePath, { force: true });

// Access exports in the machine's ANSI code page, not UTF-8.
const text = readFileSync(input, "latin1");
const result = m.cleanHarnessExport(m.readLegacyRows(text), { today });

const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header, rows) =>
  [header.join(","), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(","))].join("\r\n") + "\r\n";

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "harness-production-log.clean.csv"),
  "﻿" +
    csv(
      ["LegacySource", "Line", "ProductionDate", "WorkOrder", "PartNumber", "Quantity", "ReworkQuantity",
        "Comments", "BuiltBy", "VisualCheck", "DataQualityNotes"],
      result.rows.map((r) => ({
        LegacySource: r.legacySource,
        Line: r.line,
        ProductionDate: r.date,
        WorkOrder: r.workOrder,
        PartNumber: r.partNumber,
        Quantity: r.quantity,
        ReworkQuantity: r.reworkQuantity,
        Comments: r.comments,
        BuiltBy: r.builtBy,
        VisualCheck: r.visualCheck,
        DataQualityNotes: r.notes.join("\n"),
      })),
    ),
);
writeFileSync(
  join(outDir, "harness-part-numbers.csv"),
  "﻿" +
    csv(
      ["PartNumber", "Active", "Uses", "FirstUsed", "LastUsed", "Note"],
      result.parts.map((p) => ({
        PartNumber: p.partNumber,
        Active: p.active ? "TRUE" : "FALSE",
        Uses: p.uses,
        FirstUsed: p.firstUsed,
        LastUsed: p.lastUsed,
        Note: p.note,
      })),
    ),
);

const withNotes = result.rows.filter((r) => r.notes.length);
const flaggedParts = result.parts.filter((p) => !p.active && p.note.startsWith("Spelling"));
const years = {};
for (const r of result.rows) {
  const y = r.date?.slice(0, 4) ?? "none";
  years[y] = (years[y] ?? 0) + 1;
}
const report = [
  `# Harness Production Log — clean report`,
  ``,
  `Source: ${input}  `,
  `Run as of: ${today}`,
  ``,
  `| | |`,
  `|---|---|`,
  `| Rows read | ${result.rows.length + result.excluded.length} |`,
  `| Rows excluded | ${result.excluded.length} |`,
  `| Rows to load | ${result.rows.length} |`,
  `| Rows with a data-quality note | ${withNotes.length} |`,
  `| Rows with no part number | ${result.rows.filter((r) => !r.partNumber).length} |`,
  `| Distinct part numbers | ${result.parts.length} (${result.parts.filter((p) => p.active).length} active) |`,
  `| Unrecognised part spellings | ${flaggedParts.length} |`,
  ``,
  `## Rows by year`,
  ``,
  ...Object.entries(years).sort().map(([y, n]) => `- ${y}: ${n}`),
  ``,
  `## Excluded rows`,
  ``,
  ...result.excluded.map((e) => `- line ${e.line}: ${e.reason}`),
  ``,
  `## Unrecognised part spellings (kept as typed, retired, need a person)`,
  ``,
  ...flaggedParts.map((p) => `- ${p.partNumber} — ${p.uses} row(s), last ${p.lastUsed}`),
  ``,
  `## Part number changes`,
  ``,
  `| Typed | Recorded as | Rows | Rule |`,
  `|---|---|---|---|`,
  ...result.partChanges.map((c) => `| \`${c.from}\` | ${c.to ?? "(blank)"} | ${c.rows} | ${c.rule} |`),
  ``,
].join("\n");
writeFileSync(join(outDir, "harness-clean-report.md"), report);

console.log(`Cleaned ${result.rows.length} rows (${result.excluded.length} excluded) → ${outDir}`);
console.log(`${result.parts.length} part numbers, ${result.parts.filter((p) => p.active).length} active, ${flaggedParts.length} unrecognised.`);
console.log(`${withNotes.length} rows carry a data-quality note.`);
