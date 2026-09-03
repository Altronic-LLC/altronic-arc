import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANEL_QC_DEFECTS_LIST_ID, SP_PANEL_QC_ISSUES_LIST_ID, SP_PANELTEAM_SITE_URL, USE_MOCK } from "./config";
import { ensureLookupIds } from "./siteUsers";
import type { GraphListItem, PanelQcDefect, PanelQcIssue, PanelQcIssueInput } from "@/types/task";
import { MOCK_PANEL_QC_DEFECTS, MOCK_PANEL_QC_ISSUES } from "@/data/panelQcMockData";
import { parsePersonField } from "@/lib/taskMapper";
import { multiPersonField } from "@/lib/graphFields";
import { nextPanelQcTag } from "@/lib/panelQcNumber";

type IssueField = keyof PanelQcIssueInput;
type FieldNames = Record<IssueField, string>;
type Column = { name?: string; displayName?: string };

const FIELD_CANDIDATES: Record<IssueField, string[]> = {
  panelSerialNumber: ["PanelBoardSerialNumber", "Panel Board Serial Number", "Title"],
  date: ["Date"],
  partNumber: ["PartNumber", "Part Number"],
  partDescription: ["PartDescription", "Part Description"],
  serialReferenceNote: ["SerialReferenceNote", "Serial Reference Note"],
  defectCategory: ["DefectCategory", "Defect Category"],
  comments: ["Comments", "Comment"],
  correctiveAction: ["SubsequentStepsCorrectiveAction", "Subsequent Steps / Corrective Action"],
  productionTechnician: ["ProductionTechnician", "Production Technician"],
  productionRepairNotes: ["ProductionRepairNotes", "Production Repair Notes"],
  productionResolution: ["ProductionResolution", "Production Resolution"],
  communication: ["Communication"],
  watchers: ["Watchers"],
  tagNumber: ["TAGNumber", "TAG Number"],
};

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
let fieldNames: FieldNames | null = null;
let defectFieldName: string | null = null;

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
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_ISSUES_LIST_ID}/columns?$select=name,displayName`,
  );
  const byName = new Map((columns.value ?? []).flatMap((c) => (c.name ? [[normalise(c.name), c.name] as const] : [])));
  const byDisplay = new Map((columns.value ?? []).flatMap((c) => (c.name && c.displayName ? [[normalise(c.displayName), c.name] as const] : [])));
  const resolved = {} as FieldNames;
  for (const [key, candidates] of Object.entries(FIELD_CANDIDATES) as [IssueField, string[]][]) {
    const match = candidates.map(normalise).map((candidate) => byName.get(candidate) ?? byDisplay.get(candidate)).find(Boolean);
    if (!match) throw new Error(`SharePoint column not found for Panel QC field: ${key}`);
    resolved[key] = match;
  }
  fieldNames = resolved;
  return resolved;
}

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

function mapIssue(item: GraphListItem, names: FieldNames): PanelQcIssue {
  const fields = item.fields as Record<string, unknown>;
  const value = (key: IssueField) => fields[names[key]];
  return {
    id: Number(item.id),
    panelSerialNumber: String(value("panelSerialNumber") ?? ""),
    date: toDate(value("date")),
    partNumber: String(value("partNumber") ?? ""),
    partDescription: String(value("partDescription") ?? ""),
    serialReferenceNote: String(value("serialReferenceNote") ?? ""),
    defectCategory: value("defectCategory") ? String(value("defectCategory")) : null,
    comments: String(value("comments") ?? ""),
    correctiveAction: String(value("correctiveAction") ?? ""),
    productionTechnician: String(value("productionTechnician") ?? ""),
    productionRepairNotes: String(value("productionRepairNotes") ?? ""),
    productionResolution: String(value("productionResolution") ?? ""),
    communication: String(value("communication") ?? ""),
    watchers: parsePersonField(value("watchers")),
    tagNumber: String(value("tagNumber") ?? ""),
  };
}

async function buildFields(input: PanelQcIssueInput, names: FieldNames): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {
    [names.panelSerialNumber]: input.panelSerialNumber.trim(),
    [names.date]: input.date?.toISOString() ?? null,
    [names.partNumber]: input.partNumber.trim(),
    [names.partDescription]: input.partDescription.trim(),
    [names.serialReferenceNote]: input.serialReferenceNote.trim(),
    [names.defectCategory]: input.defectCategory || null,
    [names.comments]: input.comments.trim(),
    [names.correctiveAction]: input.correctiveAction.trim(),
    [names.productionTechnician]: input.productionTechnician.trim(),
    [names.productionRepairNotes]: input.productionRepairNotes.trim(),
    [names.productionResolution]: input.productionResolution.trim(),
    [names.communication]: input.communication.trim(),
    [names.tagNumber]: input.tagNumber.trim(),
  };
  Object.assign(fields, multiPersonField(names.watchers, await ensureLookupIds(SP_PANELTEAM_SITE_URL, input.watchers)));
  return fields;
}

export async function listPanelQcIssues(): Promise<PanelQcIssue[]> {
  if (USE_MOCK) return MOCK_PANEL_QC_ISSUES.map((issue) => ({ ...issue }));
  const names = await getFieldNames();
  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_ISSUES_LIST_ID}/items?$expand=fields($select=${Object.values(names).join(",")})`,
  );
  return items.map((item) => mapIssue(item, names));
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
  if (USE_MOCK) {
    const issue: PanelQcIssue = { id: Math.max(0, ...MOCK_PANEL_QC_ISSUES.map((item) => item.id)) + 1, ...input, tagNumber: nextPanelQcTag(MOCK_PANEL_QC_ISSUES), date: input.date ? new Date(input.date) : null };
    MOCK_PANEL_QC_ISSUES.unshift(issue);
    return issue;
  }
  const names = await getFieldNames();
  const tagNumber = nextPanelQcTag(await listPanelQcIssues());
  const item = await graphFetch<GraphListItem>(`/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_ISSUES_LIST_ID}/items`, { method: "POST", body: JSON.stringify({ fields: await buildFields({ ...input, tagNumber }, names) }) });
  return mapIssue(item, names);
}

export async function updatePanelQcIssue(id: number, input: PanelQcIssueInput): Promise<PanelQcIssue> {
  if (USE_MOCK) {
    const index = MOCK_PANEL_QC_ISSUES.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Panel QC issue ${id} not found.`);
    MOCK_PANEL_QC_ISSUES[index] = { id, ...input, date: input.date ? new Date(input.date) : null };
    return MOCK_PANEL_QC_ISSUES[index];
  }
  const names = await getFieldNames();
  await graphFetch(`/sites/${SITES.panelTeam}/lists/${SP_PANEL_QC_ISSUES_LIST_ID}/items/${id}/fields`, { method: "PATCH", body: JSON.stringify(await buildFields(input, names)) });
  const issue = (await listPanelQcIssues()).find((item) => item.id === id);
  if (!issue) throw new Error(`Panel QC issue ${id} disappeared after update.`);
  return issue;
}
