// =============================================================================
// Panel SAP BOM Builder (BusinessIT#59) — the ONE-TIME load, step 1 of 2.
//
// Reads Mark Balent's PANEL Parts Database workbook the way his
// "Rebuild BOM Builder.py" did, and writes what the lists should hold as JSON,
// for scripts/load-panel-bom-lists.ps1 to add. Nothing is written to
// SharePoint here.
//
//   node scripts/prepare-panel-bom-load.mjs "<PANEL Parts Database.xlsm>" "<qiu_map.json>" <outDir>
//
// The out dir must be OUTSIDE the repo: the workbook is production data (and
// carries COGS, which this script deliberately leaves behind — cost comes
// from SAP through Fabric). The script refuses an out dir inside the repo.
//
// Sheets and columns, as Rebuild BOM Builder.py reads them:
//   Panel-Parts-Database  SAP #, MFG/Altronic #, Description, Cluster (0-9),
//                         Category, COGS (IGNORED), Standard, Preferred,
//                         Do Not Quote, Datasheet   — flags are "X" or blank
//   Kit-List              Kit name, Description, Category, Total Cost
//                         (IGNORED), Date Updated, Standard, Preferred
//   Kit-Creation          Kit name, Line #, Qty, SAP #, MFG #, Description
// =============================================================================

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

const [, , xlsmPath, qiuPath, outDir] = process.argv;
if (!xlsmPath || !qiuPath || !outDir) {
  console.error('Usage: node scripts/prepare-panel-bom-load.mjs "<PANEL Parts Database.xlsm>" "<qiu_map.json>" <outDir>');
  process.exit(1);
}
const repo = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const out = resolve(outDir);
const rel = relative(repo, out);
if (!rel.startsWith("..") && !isAbsolute(rel)) {
  console.error(`Refusing to write inside the repo (${out}) — the workbook is production data. Pick a folder outside it.`);
  process.exit(1);
}

const cellValue = (v) => {
  if (v && typeof v === "object") {
    // A formula cell: its cached result, or nothing. Kit-List's name column is
    // a formula on every row, and the empty rows past the last kit carry the
    // formula with no result — the Python rebuild (data_only) read those as
    // blank, and so must this.
    if ("formula" in v || "sharedFormula" in v || "result" in v) return cellValue(v.result ?? null);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return v.text;
  }
  return v;
};
const text = (v) => (v === null || v === undefined ? "" : String(cellValue(v)).trim());
const flag = (v) => text(v) !== "";

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(resolve(xlsmPath));
const rows = (name) => {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`The workbook has no "${name}" sheet.`);
  const out = [];
  ws.eachRow((r, i) => {
    if (i > 1) out.push(r.values.slice(1).map(cellValue));
  });
  return out.filter((r) => text(r[0]));
};
const qiu = JSON.parse(readFileSync(resolve(qiuPath), "utf8"));

const notes = [];
const SAP = /^\d{4}-\d{4}-\d{2}$/;

// --- parts ------------------------------------------------------------------
const parts = [];
const seen = new Set();
for (const r of rows("Panel-Parts-Database")) {
  const sap = text(r[0]);
  const cluster = Number(cellValue(r[3]));
  const category = text(r[4]) || "(No Category)";
  const key = `${sap.toUpperCase()}|${category.toLowerCase()}`;
  if (seen.has(key)) {
    notes.push(`Part ${sap} appears twice in "${category}" — loaded once.`);
    continue;
  }
  seen.add(key);
  if (!SAP.test(sap)) notes.push(`Part "${sap}" isn't ####-####-## — loaded as written; fix it in ARC.`);
  if (!(Number.isInteger(cluster) && cluster >= 0 && cluster <= 9)) {
    notes.push(`Part ${sap} has cluster "${text(r[3])}" — NOT loaded (ARC needs 0-9).`);
    continue;
  }
  const q = qiu[sap];
  parts.push({
    Title: sap,
    AltronicPartNumber: text(r[1]),
    Description: text(r[2]),
    Cluster: cluster,
    Category: category,
    Standard: flag(r[6]),
    Preferred: flag(r[7]),
    DoNotQuote: flag(r[8]),
    Datasheet: text(r[9]),
    QtyIfUsed: typeof q === "number" && q > 0 ? q : null,
    Active: true,
  });
}

// --- kits -------------------------------------------------------------------
const kits = new Map();
for (const r of rows("Kit-List")) {
  const name = text(r[0]);
  if (kits.has(name.toLowerCase())) {
    notes.push(`Kit ${name} is listed twice on Kit-List — loaded once.`);
    continue;
  }
  kits.set(name.toLowerCase(), {
    Title: name,
    Description: text(r[1]),
    Category: text(r[2]) || "(No Category)",
    Standard: flag(r[5]),
    Preferred: flag(r[6]),
    Active: true,
    components: [],
  });
}
const listed = new Set(parts.map((p) => p.Title.toUpperCase()));
for (const r of rows("Kit-Creation")) {
  const name = text(r[0]);
  const kit = kits.get(name.toLowerCase());
  if (!kit) {
    notes.push(`Kit-Creation names kit ${name}, which isn't on Kit-List — its component was NOT loaded.`);
    continue;
  }
  const qty = Number(cellValue(r[2]));
  const sap = text(r[3]);
  if (!(qty > 0)) notes.push(`Kit ${name}: a component has quantity "${text(r[2])}" — loaded as written; fix it in ARC.`);
  if (sap && !listed.has(sap.toUpperCase())) notes.push(`Kit ${name}: component ${sap} isn't on the parts list.`);
  kit.components.push({ qty, sap, mfg: text(r[4]), desc: text(r[5]) });
}
const kitRows = [...kits.values()].map(({ components, ...k }) => {
  if (components.length === 0) notes.push(`Kit ${k.Title} has no components.`);
  return { ...k, Components: JSON.stringify(components) };
});

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "parts.json"), JSON.stringify(parts, null, 1));
writeFileSync(join(out, "kits.json"), JSON.stringify(kitRows, null, 1));
const report = [
  `# Panel BOM load — prepared ${new Date().toISOString()}`,
  "",
  `Source: ${resolve(xlsmPath)}`,
  "",
  `- ${parts.length} parts (COGS left behind — cost comes from SAP)`,
  `- ${kitRows.length} kits, ${kitRows.reduce((n, k) => n + JSON.parse(k.Components).length, 0)} components`,
  `- ${parts.filter((p) => p.QtyIfUsed !== null).length} parts with a Qty if used hint`,
  "",
  "## Notes",
  "",
  ...(notes.length ? notes.map((n) => `- ${n}`) : ["- None."]),
  "",
].join("\n");
writeFileSync(join(out, "report.md"), report);
console.log(report);
console.log(`Wrote parts.json, kits.json and report.md to ${out}`);
