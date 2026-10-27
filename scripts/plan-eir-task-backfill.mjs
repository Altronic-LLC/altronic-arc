// Plan the one-time backfill of promoted EIRs ⇄ their tasks — links both ways,
// and each side's comments copied to the other — through the same rules the
// tests pin (src/lib/eirTaskBackfill.ts). Changes NOTHING in SharePoint.
//
//   node scripts/plan-eir-task-backfill.mjs <exportDir> [--links <links.csv>]
//
// <exportDir> is what `eir-task-backfill.ps1 -Export` wrote (eirs.json,
// tasks.json). Writes, into the same folder — never the repo, it is
// production data:
//
//   plan.json          what -Apply will write, record by record
//   report.md          the counts, and what each pair will get
//   pairs.csv          every pair with its links BEFORE and after (the undo record)
//   unlinked.csv       promoted EIRs with no task found — fill in TaskId and
//                      pass the file back with --links to link them
//   conflicts.csv      tasks whose EIR link contradicts the pairing
//   suggestions.csv    tasks that name an EIR in their title, not linked

import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Rolldown, not esbuild: it ships with Vite 8, which dropped esbuild.
import { rolldown } from "rolldown";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const args = process.argv.slice(2);
const dir = args[0] && !args[0].startsWith("--") ? resolve(args[0]) : null;
const linksAt = args.indexOf("--links");
const linksFile = linksAt >= 0 ? resolve(args[linksAt + 1] ?? "") : null;
if (!dir || !existsSync(join(dir, "eirs.json"))) {
  console.error("usage: node scripts/plan-eir-task-backfill.mjs <exportDir> [--links <links.csv>]");
  process.exit(1);
}

const ARC_URL = "https://altronic-llc.github.io/altronic-arc";

const bundlePath = join(here, ".eir-task-backfill-bundle.mjs");
const bundle = await rolldown({
  input: join(root, "src/lib/eirTaskBackfill.ts"),
  platform: "node",
  resolve: { alias: { "@": join(root, "src") } },
  logLevel: "silent",
});
await bundle.write({ file: bundlePath, format: "esm" });
await bundle.close();
const m = await import(pathToFileURL(bundlePath).href);
rmSync(bundlePath, { force: true });

const read = (f) => JSON.parse(readFileSync(join(dir, f), "utf8").replace(/^﻿/, ""));
const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const str = (v) => (typeof v === "string" ? v : "");

const rawEirs = asArray(read("eirs.json"));
const rawTasks = asArray(read("tasks.json"));

const eirs = rawEirs.map((r) => ({
  id: Number(r.id),
  eirNo: str(r.fields?.EIRNo).trim(),
  title: str(r.fields?.Title),
  resolution: str(r.fields?.Resolution),
  taskPromotedFlag: !!r.fields?.TaskPromotedFlag,
  taskReference: str(r.fields?.TaskReference),
  communication: str(r.fields?.Communication),
}));
const hyperlink = (v) => {
  if (!v) return null;
  if (typeof v === "string") return v.trim() ? { url: v.trim(), label: v.trim() } : null;
  const url = str(v.Url ?? v.url).trim();
  const label = str(v.Description ?? v.description).trim();
  return url || label ? { url, label: label || url } : null;
};
const tasks = rawTasks.map((r) => ({
  id: Number(r.id),
  title: str(r.fields?.Title),
  numberedTitle: str(r.fields?.NumberedTitle),
  eirReference: hyperlink(r.fields?.EIRReference),
  communication: str(r.fields?.Communication),
}));

// ---- CSV -------------------------------------------------------------------
const cell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header, rows) =>
  "﻿" + [header.join(","), ...rows.map((r) => header.map((h) => cell(r[h])).join(","))].join("\r\n") + "\r\n";

function parseCsv(text) {
  const rows = [];
  let row = [], f = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f); rows.push(row); row = []; f = "";
    } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

// ---- Ray's list ------------------------------------------------------------
const overrides = [];
if (linksFile) {
  for (const r of parseCsv(readFileSync(linksFile, "utf8"))) {
    const eirId = parseInt(r.EirId ?? "", 10);
    const taskId = parseInt((r.TaskId ?? "").replace(/^.*\/task\//, ""), 10);
    if (eirId > 0 && taskId > 0) overrides.push({ eirId, taskId });
  }
  console.log(`Using ${overrides.length} pair(s) from ${linksFile}`);
}

const plan = m.planEirTaskBackfill({ eirs, tasks, overrides, arcUrl: ARC_URL });

// ---- plan.json — what -Apply writes ---------------------------------------
const sha = (s) => createHash("sha256").update(s ?? "", "utf8").digest("hex");
const eirById = new Map(eirs.map((e) => [e.id, e]));
const taskById = new Map(tasks.map((t) => [t.id, t]));
const writes = [];
for (const p of plan.pairs) {
  const task = taskById.get(p.taskId);
  const eir = eirById.get(p.eirId);
  // The task's EIR link is never written: it's a Hyperlink column, and Graph
  // can't write one (400 invalidRequest, proven live 2026-10-27). ARC reads
  // the old SharePoint form links and derives the rest from the EIR's side.
  if (p.toTask.length) {
    writes.push({ list: "task", id: p.taskId, what: "comments", count: p.toTask.length,
      expectedSha256: sha(task.communication), append: p.toTask.join("\n") });
  }
  if (p.toEir.length) {
    writes.push({ list: "eir", id: p.eirId, what: "comments", count: p.toEir.length,
      expectedSha256: sha(eir.communication), append: p.toEir.join("\n") });
  }
  const eirFields = {};
  if (p.eirTaskReference) eirFields.TaskReference = p.eirTaskReference;
  if (p.setPromotedFlag) eirFields.TaskPromotedFlag = true;
  if (Object.keys(eirFields).length) writes.push({ list: "eir", id: p.eirId, what: "link", fields: eirFields });
}
writeFileSync(join(dir, "plan.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), writes }, null, 2));

// ---- CSVs ------------------------------------------------------------------
const linkText = (l) => (l ? l.url : "");
writeFileSync(join(dir, "pairs.csv"), csv(
  ["EirId", "EirNo", "TaskId", "Task", "FoundBy", "TaskLink",
    "EirTaskReferenceBefore", "EirTaskReferenceAfter", "SetPromotedFlag", "CommentsToTask", "CommentsToEir"],
  plan.pairs.map((p) => ({
    EirId: p.eirId, EirNo: p.eirNo, TaskId: p.taskId, Task: p.taskLabel, FoundBy: p.foundBy,
    TaskLink: linkText(p.taskLinkBefore),
    EirTaskReferenceBefore: p.eirTaskReferenceBefore, EirTaskReferenceAfter: p.eirTaskReference ?? "(unchanged)",
    SetPromotedFlag: p.setPromotedFlag ? "yes" : "", CommentsToTask: p.toTask.length, CommentsToEir: p.toEir.length,
  }))));
writeFileSync(join(dir, "unlinked.csv"), csv(
  ["EirId", "EirNo", "Title", "Resolution", "TaskReference", "Why", "PossibleTasks", "TaskId"],
  plan.unlinked.map((u) => ({
    EirId: u.eirId, EirNo: u.eirNo, Title: u.title, Resolution: u.resolution, TaskReference: u.taskReference,
    Why: u.reason, PossibleTasks: u.candidates.map((c) => `${c.taskId}: ${c.label}`).join(" | "), TaskId: "",
  }))));
writeFileSync(join(dir, "conflicts.csv"), csv(
  ["TaskId", "Task", "EirId", "EirNo", "Why"],
  plan.conflicts.map((c) => ({ TaskId: c.taskId, Task: c.taskLabel, EirId: c.eirId, EirNo: c.eirNo, Why: c.reason }))));
writeFileSync(join(dir, "suggestions.csv"), csv(
  ["EirId", "EirNo", "TaskId", "Task"],
  plan.suggestions.map((s) => ({ EirId: s.eirId, EirNo: s.eirNo, TaskId: s.taskId, Task: s.taskLabel }))));

// ---- report ----------------------------------------------------------------
const n = (xs, f) => xs.filter(f).length;
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
const report = [
  `# EIR ⇄ task backfill plan`,
  ``,
  `Generated ${new Date().toISOString()} from ${rawEirs.length} EIRs and ${rawTasks.length} tasks.`,
  ``,
  `| | |`,
  `|---|---|`,
  `| Pairs found | ${plan.pairs.length} |`,
  `| EIR Task References to write | ${n(plan.pairs, (p) => p.eirTaskReference)} |`,
  `| "Promoted" flags to set | ${n(plan.pairs, (p) => p.setPromotedFlag)} |`,
  `| Comments to copy EIR → task | ${sum(plan.pairs, (p) => p.toTask.length)} |`,
  `| Comments to copy task → EIR | ${sum(plan.pairs, (p) => p.toEir.length)} |`,
  `| Promoted EIRs NOT linked (unlinked.csv) | ${plan.unlinked.length} |`,
  `| Tasks contradicting a pair (conflicts.csv) | ${plan.conflicts.length} |`,
  `| Tasks naming an EIR, not linked (suggestions.csv) | ${plan.suggestions.length} |`,
  ``,
  `## Pairs`,
  ``,
  `| EIR | Task | Found by | EIR ref | → task | → EIR |`,
  `|---|---|---|---|---|---|`,
  ...plan.pairs.map((p) =>
    `| ${p.eirNo || p.eirId} (${p.eirId}) | ${p.taskLabel.slice(0, 50)} (${p.taskId}) | ${p.foundBy} | ${p.eirTaskReference ? "write" : "ok"} | ${p.toTask.length} | ${p.toEir.length} |`),
  ``,
  `## Not linked`,
  ``,
  ...plan.unlinked.map((u) => `- **${u.eirNo || u.eirId}** (${u.eirId}) ${u.title} — ${u.reason}${u.candidates.length ? `; possibly ${u.candidates.map((c) => `${c.taskId} ${c.label}`).join(", ")}` : ""}`),
  ``,
  `## Conflicts`,
  ``,
  ...plan.conflicts.map((c) => `- task ${c.taskId} ${c.taskLabel} links to ${c.eirNo} (${c.eirId}), but ${c.reason}`),
  ``,
].join("\n");
writeFileSync(join(dir, "report.md"), report);

console.log(report.split("\n## Pairs")[0]);
console.log(`Wrote plan.json, report.md and four CSVs to ${dir}`);
