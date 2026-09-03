import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANEL_QC_DEFECTS_LIST_ID, SP_PANEL_QC_ISSUES_LIST_ID, SP_PANELTEAM_SITE_URL, USE_MOCK } from "./config";
import { ensureLookupIds } from "./siteUsers";
import type { GraphListItem, PanelQcDefect, PanelQcIssue, PanelQcIssueInput, Person } from "@/types/task";
import {
  MOCK_PANEL_QC_DEFECTS,
  MOCK_PANEL_QC_ISSUES,
  MOCK_PANEL_QC_REPAIR_DEFECT_CHOICES,
  MOCK_PANEL_QC_STATUS_CHOICES,
} from "@/data/panelQcMockData";
import { parsePersonField } from "@/lib/taskMapper";
import { multiPersonField } from "@/lib/graphFields";
import { appendComment, parseCommunication, replaceComment } from "@/lib/communicationParser";
import { nextPanelQcTag } from "@/lib/panelQcNumber";

// =============================================================================
// Panel QC Issues API — the panel team's defect tracker, on the same
// ALTRONICPANELTEAM site as panel orders/tasks (SITES.panelTeam). Field names
// are discovered from the live SharePoint columns (not hardcoded) because the
// list's internal names weren't confirmed ahead of time — see
// FIELD_CANDIDATES below.
//
// Watchers and the Communication comment thread follow the same shape as
// api/panelTasks.ts: Watchers is written ONLY through the dedicated
// setPanelQcIssueWatchers()/watch/unwatch functions (never through the
// whole-form updatePanelQcIssue save), so a mention-driven auto-watch or a
// Watch-button click can't be clobbered by a stale form draft being saved
// later. Communication is written ONLY through addPanelQcIssueComment /
// editPanelQcIssueComment, via the shared appendComment/replaceComment
// helpers every other comment thread in ARC uses.
// =============================================================================

type IssueField = keyof PanelQcIssueInput;
/** Fields resolved from SharePoint columns that aren't part of the editable
 * form draft — the comment thread lives on its own write path (see above). */
type ExtraField = "communication";
type AllField = IssueField | ExtraField;
type FieldNames = Record<AllField, string>;
type Column = { name?: string; displayName?: string; choice?: { choices?: string[] } };

// Candidates carry BOTH the pre-2026-09-03 internal/display names and the
// ones Ray renamed them to on the list directly (see CLAUDE.md) — a rename
// in SharePoint changes the displayName but not necessarily the internal
// `name`, and it wasn't confirmed which happened here, so both are offered.
const FIELD_CANDIDATES: Record<AllField, string[]> = {
  panelSerialNumber: ["PanelBoardSerialNumber", "Panel Board Serial Number", "PanelSerialNumber", "Panel Serial Number", "Title"],
  panelPartNumber: ["PanelPartNumber", "Panel Part Number"],
  date: ["Date"],
  subComponentPartNumber: ["PartNumber", "Part Number", "SubComponentPartNumber", "Sub Component Part Number"],
  partDescription: ["PartDescription", "Part Description"],
  subComponentSerialNumber: ["SerialReferenceNote", "Serial Reference Note", "SubComponentSerialNumber", "Sub Component Serial Number"],
  defectCategory: ["DefectCategory", "Defect Category"],
  failureReported: ["Comments", "Comment", "FailureReported", "Failure Reported"],
  panelsResolution: ["SubsequentStepsCorrectiveAction", "Subsequent Steps / Corrective Action", "PanelsResolution", "Panels Resolution"],
  repairTechnician: ["ProductionTechnician", "Production Technician", "RepairTechnician", "Repair Technician"],
  repairDefectCategory: ["RepairDefectCategory", "Repair Defect Category"],
  repairIssueFound: ["ProductionRepairNotes", "Production Repair Notes", "RepairIssueFound", "Repair Issue Found"],
  repairResolution: ["ProductionResolution", "Production Resolution", "RepairResolution", "Repair Resolution"],
  status: ["Status"],
  watchers: ["Watchers"],
  communication: ["Communication"],
  tagNumber: ["TAGNumber", "TAG Number"],
};

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
let fieldNames: FieldNames | null = null;
let defectFieldName: string | null = null;
// The live choices behind the "Status" and "Repair Defect Category" choice
// columns — captured alongside field-name resolution below, NEVER
// hardcoded, because both are strict choice columns ("Can add values
// manually" is off) and a value ARC writes that isn't in the column's real
// list gets rejected outright. See listPanelQcStatusChoices /
// listPanelQcRepairDefectChoices.
let statusChoices: string[] | null = null;
let repairDefectChoices: string[] | null = null;

async function getDefectFieldName(): Promise<string> {
  if (defectFieldName) return defectFieldName;
  try {
    const columns = await graphFetch<{ value: Column[] }>(
      `/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_DEFECTS_LIST_ID}/columns?$select=name,displayName`,
    );
    const match = (columns.value ?? []).find((column) =>
      [column.name, column.displayName].filter(Boolean).some((value) =>
        ["defect", "title"].includes(normalise(value!)),
      ),
    );
    if (match?.name) {
      defectFieldName = match.name;
      return match.name;
    }
  } catch {
    // Some SharePoint list permissions allow items but refuse column metadata.
  }
  defectFieldName = "Defect";
  return defectFieldName;
}

async function getFieldNames(): Promise<FieldNames> {
  if (fieldNames) return fieldNames;
  const columns = await graphFetch<{ value: Column[] }>(
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_ISSUES_LIST_ID}/columns?$select=name,displayName,choice`,
  );
  const byName = new Map((columns.value ?? []).flatMap((c) => (c.name ? [[normalise(c.name), c.name] as const] : [])));
  const byDisplay = new Map((columns.value ?? []).flatMap((c) => (c.name && c.displayName ? [[normalise(c.displayName), c.name] as const] : [])));
  const choicesByInternalName = new Map(
    (columns.value ?? []).flatMap((c) => (c.name && c.choice?.choices ? [[c.name, c.choice.choices] as const] : [])),
  );
  const resolved = {} as FieldNames;
  for (const [key, candidates] of Object.entries(FIELD_CANDIDATES) as [AllField, string[]][]) {
    const match = candidates.map(normalise).map((candidate) => byName.get(candidate) ?? byDisplay.get(candidate)).find(Boolean);
    if (!match) throw new Error(`SharePoint column not found for Panel QC field: ${key}`);
    resolved[key] = match;
  }
  fieldNames = resolved;
  statusChoices = choicesByInternalName.get(resolved.status) ?? null;
  repairDefectChoices = choicesByInternalName.get(resolved.repairDefectCategory) ?? null;
  return resolved;
}

/** The live "Status" column's choices, in the order SharePoint has them configured. */
export async function listPanelQcStatusChoices(): Promise<string[]> {
  if (USE_MOCK) return [...MOCK_PANEL_QC_STATUS_CHOICES];
  await getFieldNames();
  return statusChoices ?? [];
}

/** The live "Repair Defect Category" column's choices. */
export async function listPanelQcRepairDefectChoices(): Promise<string[]> {
  if (USE_MOCK) return [...MOCK_PANEL_QC_REPAIR_DEFECT_CHOICES];
  await getFieldNames();
  return repairDefectChoices ?? [];
}

/**
 * Drop any `lookupId` a Person object carries before it reaches
 * `ensureLookupIds` for THIS site.
 *
 * A `lookupId` is only valid on the ONE SharePoint site it was resolved
 * for — the same numeric id means a different person on every site's own
 * hidden User Information List (CLAUDE.md's "per-site lookupId" rule).
 * `ensureLookupIds` treats an existing `lookupId` as already-verified and
 * skips re-resolving it, so a Person carrying one from elsewhere gets
 * written straight through — silently misassigning the watcher to whoever
 * that number happens to belong to on THIS site.
 *
 * The concrete way this bit: `useCurrentUser()`'s `lookupId` is always
 * resolved against the ENGINEERING site (see `resolveCurrentUserLookupId`
 * in `api/currentUser.ts`), and the creator auto-watches their own new
 * issue (`autoWatchers` in `usePanelQcIssues.ts`) — so creating an issue
 * wrote the CREATOR's Engineering lookupId into this list's Watchers
 * column. On refresh that numeric id resolved, on the ALTRONICPANELTEAM
 * site's own directory, to a completely different person (reported
 * 2026-09-03: creating an issue and adding one watcher showed the intended
 * pick PLUS an unrelated third person the reporter never added or
 * mentioned).
 *
 * Stripping it here forces every watcher write in this module to
 * re-resolve by EMAIL against the panel team site specifically, which is
 * correct (if slightly more work) even for a Person who already holds a
 * genuinely-valid panel-team lookupId — re-resolving one returns the same
 * id right back.
 */
function forSiteResolution(people: Person[]): Person[] {
  return people.map((p) => (p.lookupId ? { ...p, lookupId: undefined } : p));
}

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

function mapIssue(item: GraphListItem, names: FieldNames): PanelQcIssue {
  const fields = item.fields as Record<string, unknown>;
  const value = (key: AllField) => fields[names[key]];
  return {
    id: Number(item.id),
    panelSerialNumber: String(value("panelSerialNumber") ?? ""),
    panelPartNumber: String(value("panelPartNumber") ?? ""),
    date: toDate(value("date")),
    subComponentPartNumber: String(value("subComponentPartNumber") ?? ""),
    partDescription: String(value("partDescription") ?? ""),
    subComponentSerialNumber: String(value("subComponentSerialNumber") ?? ""),
    defectCategory: value("defectCategory") ? String(value("defectCategory")) : null,
    failureReported: String(value("failureReported") ?? ""),
    panelsResolution: String(value("panelsResolution") ?? ""),
    repairTechnician: String(value("repairTechnician") ?? ""),
    repairDefectCategory: value("repairDefectCategory") ? String(value("repairDefectCategory")) : null,
    repairIssueFound: String(value("repairIssueFound") ?? ""),
    repairResolution: String(value("repairResolution") ?? ""),
    status: String(value("status") ?? "Created"),
    watchers: parsePersonField(value("watchers")),
    comments: parseCommunication(value("communication") as string | null | undefined),
    hasAttachments: Boolean(fields.Attachments),
    tagNumber: String(value("tagNumber") ?? ""),
  };
}

/** Every field the whole-form save writes — everything EXCEPT Watchers and
 * Communication, which have their own dedicated write paths (see header). */
async function buildFields(
  input: PanelQcIssueInput,
  names: FieldNames,
  opts: { includeWatchers: boolean },
): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {
    [names.panelSerialNumber]: input.panelSerialNumber.trim(),
    [names.panelPartNumber]: input.panelPartNumber.trim(),
    [names.date]: input.date?.toISOString() ?? null,
    [names.subComponentPartNumber]: input.subComponentPartNumber.trim(),
    [names.partDescription]: input.partDescription.trim(),
    [names.subComponentSerialNumber]: input.subComponentSerialNumber.trim(),
    [names.defectCategory]: input.defectCategory || null,
    [names.failureReported]: input.failureReported.trim(),
    [names.panelsResolution]: input.panelsResolution.trim(),
    [names.repairTechnician]: input.repairTechnician.trim(),
    [names.repairDefectCategory]: input.repairDefectCategory || null,
    [names.repairIssueFound]: input.repairIssueFound.trim(),
    [names.repairResolution]: input.repairResolution.trim(),
    [names.status]: input.status,
    [names.tagNumber]: input.tagNumber.trim(),
  };
  if (opts.includeWatchers) {
    Object.assign(fields, multiPersonField(names.watchers, await ensureLookupIds(SP_PANELTEAM_SITE_URL, forSiteResolution(input.watchers))));
  }
  return fields;
}

export async function listPanelQcIssues(): Promise<PanelQcIssue[]> {
  if (USE_MOCK) return MOCK_PANEL_QC_ISSUES.map((issue) => ({ ...issue }));
  const names = await getFieldNames();
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_ISSUES_LIST_ID}/items?$expand=fields($select=${Object.values(names).join(",")},Attachments)`,
  );
  return items.map((item) => mapIssue(item, names));
}

export async function getPanelQcIssue(id: number): Promise<PanelQcIssue | null> {
  const all = await listPanelQcIssues();
  return all.find((item) => item.id === id) ?? null;
}

export async function listPanelQcDefects(): Promise<PanelQcDefect[]> {
  if (USE_MOCK) return MOCK_PANEL_QC_DEFECTS.map((defect) => ({ ...defect }));
  const nameField = await getDefectFieldName();
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_DEFECTS_LIST_ID}/items?$expand=fields`,
  );
  return items
    .map((item) => ({ id: Number(item.id), name: String((item.fields as Record<string, unknown>)[nameField] ?? "") }))
    .filter((defect) => defect.name)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function createPanelQcDefect(name: string): Promise<PanelQcDefect> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Defect category is required.");
  if (USE_MOCK) {
    const defect = { id: Math.max(0, ...MOCK_PANEL_QC_DEFECTS.map((item) => item.id)) + 1, name: trimmed };
    MOCK_PANEL_QC_DEFECTS.push(defect);
    return defect;
  }
  const nameField = await getDefectFieldName();
  const item = await graphFetch<GraphListItem>(`/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_DEFECTS_LIST_ID}/items`, {
    method: "POST",
    body: JSON.stringify({ fields: { [nameField]: trimmed } }),
  });
  return { id: Number(item.id), name: trimmed };
}

export async function createPanelQcIssue(input: PanelQcIssueInput): Promise<PanelQcIssue> {
  // Status is never on the New Issue form (Ray, 2026-09-03) — every create
  // is forced to "Created" here regardless of what the draft happens to
  // hold, the same belt-and-suspenders treatment TAG Number gets below.
  const withStatus: PanelQcIssueInput = { ...input, status: "Created" };
  if (USE_MOCK) {
    const issue: PanelQcIssue = {
      id: Math.max(0, ...MOCK_PANEL_QC_ISSUES.map((item) => item.id)) + 1,
      panelSerialNumber: withStatus.panelSerialNumber,
      panelPartNumber: withStatus.panelPartNumber,
      date: withStatus.date ? new Date(withStatus.date) : null,
      subComponentPartNumber: withStatus.subComponentPartNumber,
      partDescription: withStatus.partDescription,
      subComponentSerialNumber: withStatus.subComponentSerialNumber,
      defectCategory: withStatus.defectCategory,
      failureReported: withStatus.failureReported,
      panelsResolution: withStatus.panelsResolution,
      repairTechnician: withStatus.repairTechnician,
      repairDefectCategory: withStatus.repairDefectCategory,
      repairIssueFound: withStatus.repairIssueFound,
      repairResolution: withStatus.repairResolution,
      status: withStatus.status,
      watchers: withStatus.watchers,
      comments: [],
      hasAttachments: false,
      tagNumber: nextPanelQcTag(MOCK_PANEL_QC_ISSUES),
    };
    MOCK_PANEL_QC_ISSUES.unshift(issue);
    return issue;
  }
  const names = await getFieldNames();
  const tagNumber = nextPanelQcTag(await listPanelQcIssues());
  const item = await graphFetch<GraphListItem>(`/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_ISSUES_LIST_ID}/items`, {
    method: "POST",
    body: JSON.stringify({ fields: await buildFields({ ...withStatus, tagNumber }, names, { includeWatchers: true }) }),
  });
  return mapIssue(item, names);
}

/** Whole-form save. Never touches Watchers or Communication — see header. */
export async function updatePanelQcIssue(id: number, input: PanelQcIssueInput): Promise<PanelQcIssue> {
  if (USE_MOCK) {
    const index = MOCK_PANEL_QC_ISSUES.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Panel QC issue ${id} not found.`);
    const current = MOCK_PANEL_QC_ISSUES[index];
    MOCK_PANEL_QC_ISSUES[index] = {
      ...current,
      panelSerialNumber: input.panelSerialNumber,
      panelPartNumber: input.panelPartNumber,
      date: input.date ? new Date(input.date) : null,
      subComponentPartNumber: input.subComponentPartNumber,
      partDescription: input.partDescription,
      subComponentSerialNumber: input.subComponentSerialNumber,
      defectCategory: input.defectCategory,
      failureReported: input.failureReported,
      panelsResolution: input.panelsResolution,
      repairTechnician: input.repairTechnician,
      repairDefectCategory: input.repairDefectCategory,
      repairIssueFound: input.repairIssueFound,
      repairResolution: input.repairResolution,
      status: input.status,
      tagNumber: input.tagNumber,
      // watchers / comments / hasAttachments intentionally preserved —
      // managed by their own dedicated mutations, not the whole-form save.
    };
    return MOCK_PANEL_QC_ISSUES[index];
  }
  const names = await getFieldNames();
  await graphFetch(`/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_ISSUES_LIST_ID}/items/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(await buildFields(input, names, { includeWatchers: false })),
  });
  const issue = await getPanelQcIssue(id);
  if (!issue) throw new Error(`Panel QC issue ${id} disappeared after update.`);
  return issue;
}

/** Replace the Watchers list. The only function that writes that column. */
export async function setPanelQcIssueWatchers(id: number, people: Person[]): Promise<PanelQcIssue> {
  if (USE_MOCK) {
    const index = MOCK_PANEL_QC_ISSUES.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Panel QC issue ${id} not found.`);
    MOCK_PANEL_QC_ISSUES[index] = { ...MOCK_PANEL_QC_ISSUES[index], watchers: people };
    return MOCK_PANEL_QC_ISSUES[index];
  }
  const names = await getFieldNames();
  const ensured = await ensureLookupIds(SP_PANELTEAM_SITE_URL, forSiteResolution(people));
  if (people.length > 0 && !ensured.some((p) => p.lookupId)) {
    throw new Error(
      "Cannot update Watchers: couldn't resolve a SharePoint user for any of the selected people.",
    );
  }
  await graphFetch(`/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_ISSUES_LIST_ID}/items/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(multiPersonField(names.watchers, ensured)),
  });
  const issue = await getPanelQcIssue(id);
  if (!issue) throw new Error(`Panel QC issue ${id} disappeared after update.`);
  return issue;
}

/** Add the given person to the watchers list (if not already there). */
export async function watchPanelQcIssue(id: number, person: Person): Promise<PanelQcIssue> {
  if (!USE_MOCK && !person.lookupId) {
    throw new Error(
      "Cannot add to watchers: your SharePoint user lookupId hasn't been resolved yet. " +
        "Please wait a moment and try again, or refresh the page.",
    );
  }
  const issue = await getPanelQcIssue(id);
  if (!issue) throw new Error(`Panel QC issue ${id} not found.`);
  const alreadyWatching = issue.watchers.some(
    (w) => w.email === person.email || (w.lookupId && w.lookupId === person.lookupId),
  );
  if (alreadyWatching) return issue;
  return setPanelQcIssueWatchers(id, [...issue.watchers, person]);
}

/** Remove the given person from the watchers list. */
export async function unwatchPanelQcIssue(id: number, person: Person): Promise<PanelQcIssue> {
  const issue = await getPanelQcIssue(id);
  if (!issue) throw new Error(`Panel QC issue ${id} not found.`);
  const next = issue.watchers.filter(
    (w) => !(w.email === person.email || (w.lookupId && w.lookupId === person.lookupId)),
  );
  if (next.length === issue.watchers.length) return issue;
  return setPanelQcIssueWatchers(id, next);
}

/** Append a comment to a panel QC issue's Communication field. */
export async function addPanelQcIssueComment(
  id: number,
  comment: { authorName: string; authorEmail: string; bodyHtml: string },
): Promise<PanelQcIssue> {
  if (USE_MOCK) {
    const index = MOCK_PANEL_QC_ISSUES.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Panel QC issue ${id} not found.`);
    const next = { ...MOCK_PANEL_QC_ISSUES[index] };
    next.comments = [
      { timestamp: new Date(), authorName: comment.authorName, authorEmail: comment.authorEmail, bodyHtml: comment.bodyHtml, attachments: [] },
      ...next.comments,
    ];
    MOCK_PANEL_QC_ISSUES[index] = next;
    return next;
  }
  const names = await getFieldNames();
  const path = `/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_ISSUES_LIST_ID}/items/${id}?$expand=fields($select=${names.communication})`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields as Record<string, unknown>)[names.communication] as string | undefined;
  const newRaw = appendComment(existingRaw, comment);
  await graphFetch(`/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_ISSUES_LIST_ID}/items/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ [names.communication]: newRaw }),
  });
  const issue = await getPanelQcIssue(id);
  if (!issue) throw new Error(`Panel QC issue ${id} disappeared after update.`);
  return issue;
}

/** Edit the body of an existing comment, matched by timestamp + author email. */
export async function editPanelQcIssueComment(
  id: number,
  target: { timestamp: Date; authorEmail: string },
  newBodyHtml: string,
): Promise<PanelQcIssue> {
  if (USE_MOCK) {
    const index = MOCK_PANEL_QC_ISSUES.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Panel QC issue ${id} not found.`);
    const next = { ...MOCK_PANEL_QC_ISSUES[index] };
    const targetEmail = target.authorEmail.toLowerCase();
    next.comments = next.comments.map((c) =>
      c.timestamp.getTime() === target.timestamp.getTime() && c.authorEmail.toLowerCase() === targetEmail
        ? { ...c, bodyHtml: newBodyHtml }
        : c,
    );
    MOCK_PANEL_QC_ISSUES[index] = next;
    return next;
  }
  const names = await getFieldNames();
  const path = `/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_ISSUES_LIST_ID}/items/${id}?$expand=fields($select=${names.communication})`;
  const existing = await graphFetch<GraphListItem>(path);
  const existingRaw = (existing.fields as Record<string, unknown>)[names.communication] as string | undefined;
  const newRaw = replaceComment(existingRaw, target, newBodyHtml);
  await graphFetch(`/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_ISSUES_LIST_ID}/items/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ [names.communication]: newRaw }),
  });
  const issue = await getPanelQcIssue(id);
  if (!issue) throw new Error(`Panel QC issue ${id} disappeared after update.`);
  return issue;
}
