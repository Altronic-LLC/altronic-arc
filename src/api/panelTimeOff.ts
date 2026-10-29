import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANEL_TIME_OFF_LIST_ID, SP_PANELTEAM_SITE_URL, USE_MOCK } from "./config";
import { listPanelSiteUsers } from "./panelOrders";
import { resolveSiteUserLookupId } from "./siteUsers";
import { mockDelay } from "./mockLatency";
import type { GraphListItem, PanelTimeOff, Person } from "@/types/task";
import { MOCK_PANEL_TIME_OFF } from "@/data/panelMockData";
import { parseSpDate, toSpDateOnly } from "@/lib/spDates";
import { toLookupId, toNumberOrNull } from "@/lib/graphValues";

// =============================================================================
// Panel Time Off — the panel team's own "Where am I?" (BusinessIT#42), on the
// ALTRONICPANELTEAM site. Engineering's list can't serve: it has no person
// column (the name is typed into the title) and one row per day, and the
// Capacity view needs to know WHOSE capacity a day off takes away.
//
// `TeamMember` is a SINGLE person column, so Graph hands back a bare
// `TeamMemberLookupId`: both halves are selected and the name is joined from
// the panel site's users. Written as a bare integer, resolved on THIS site,
// and a person who can't be resolved REFUSES the write rather than clearing it.
//
// It HAS a delete, like Engineering's: time off is an intention, and
// intentions get cancelled.
// =============================================================================

export interface PanelTimeOffInput {
  /** Null only on a company holiday, which is everyone's. */
  person: Person | null;
  reason: string;
  startDate: Date;
  endDate: Date;
  /** Hours off each day; null = the whole day. */
  hoursPerDay: number | null;
  /** Off for everyone on the Capacity view; no person. */
  companyHoliday: boolean;
}

// CompanyHoliday arrived later (scripts/setup-panel-planning.ps1); it must
// exist before this ships, or the whole read 400s.
const SELECT = "Title,TeamMember,TeamMemberLookupId,StartDate,EndDate,HoursPerDay,CompanyHoliday";

let mockStore: PanelTimeOff[] = MOCK_PANEL_TIME_OFF.map((e) => ({ ...e }));

/** Demo-mode-only: reset the store (tests). */
export function resetPanelTimeOffMockStore(): void {
  mockStore = MOCK_PANEL_TIME_OFF.map((e) => ({ ...e }));
}

/** Whether the list is set up. Demo mode always is. */
export const PANEL_TIME_OFF_CONFIGURED = USE_MOCK || !!SP_PANEL_TIME_OFF_LIST_ID;

function listPath(): string {
  return `/sites/${SITES.panelTeam}/lists/${SP_PANEL_TIME_OFF_LIST_ID}/items`;
}

export function toPanelTimeOff(item: GraphListItem, users: Map<number, Person>): PanelTimeOff {
  const f = item.fields as Record<string, unknown>;
  const lookupId = toLookupId(f.TeamMemberLookupId);
  // An id nobody answers for still shows — a set column must never look empty.
  const person: Person | null = lookupId
    ? users.get(lookupId) ?? { lookupId, displayName: `User #${lookupId}` }
    : null;
  return {
    id: parseInt(item.id, 10),
    person,
    reason: typeof f.Title === "string" ? f.Title : "",
    startDate: parseSpDate(f.StartDate),
    endDate: parseSpDate(f.EndDate),
    hoursPerDay: toNumberOrNull(f.HoursPerDay),
    companyHoliday: f.CompanyHoliday === true,
  };
}

/** Every time-off entry. Unset list = nobody is off. */
export async function listPanelTimeOff(): Promise<PanelTimeOff[]> {
  if (USE_MOCK) return mockDelay(mockStore.map((e) => ({ ...e })));
  if (!SP_PANEL_TIME_OFF_LIST_ID) return [];
  const [items, users] = await Promise.all([
    graphFetchAll<GraphListItem>(`${listPath()}?$expand=fields($select=${SELECT})&$top=999`),
    listPanelSiteUsers(),
  ]);
  return items.map((it) => toPanelTimeOff(it, users));
}

function requireConfigured(action: string): void {
  if (!SP_PANEL_TIME_OFF_LIST_ID) {
    throw new Error(`Can't ${action}: VITE_SP_PANEL_TIME_OFF_LIST_ID is not set.`);
  }
}

/** The input as list fields, with the person resolved on the panel site. */
export async function buildPanelTimeOffFields(
  input: PanelTimeOffInput,
): Promise<Record<string, unknown>> {
  const dates = {
    Title: input.reason.trim(),
    StartDate: toSpDateOnly(input.startDate),
    EndDate: toSpDateOnly(input.endDate),
    HoursPerDay: input.hoursPerDay,
  };
  // A company holiday is everyone's: no person, and the column cleared so an
  // entry turned into a holiday doesn't keep pointing at somebody.
  if (input.companyHoliday) return { ...dates, TeamMemberLookupId: null, CompanyHoliday: true };
  if (!input.person) throw new Error("Pick who is off.");
  const lookupId = await resolveSiteUserLookupId(
    SITES.panelTeam,
    SP_PANELTEAM_SITE_URL,
    input.person.email ?? "",
  );
  if (!lookupId) {
    throw new Error(
      `Couldn't find ${input.person.displayName} on the panel team's SharePoint site, ` +
        "so the time off wasn't saved.",
    );
  }
  return { ...dates, TeamMemberLookupId: lookupId, CompanyHoliday: false };
}

/** What's wrong with an entry before it's saved, or null. */
export function panelTimeOffProblem(input: Partial<PanelTimeOffInput>): string | null {
  if (!input.person && !input.companyHoliday) return "Pick who is off.";
  if (!input.startDate || !input.endDate) return "Pick the first and last day off.";
  if (input.endDate.getTime() < input.startDate.getTime()) {
    return "The last day can't be before the first.";
  }
  if (input.hoursPerDay !== null && input.hoursPerDay !== undefined) {
    if (!(input.hoursPerDay > 0 && input.hoursPerDay <= 24)) {
      return "Hours off a day must be more than 0 and no more than 24 — or leave it blank for the whole day.";
    }
  }
  return null;
}

export async function createPanelTimeOff(input: PanelTimeOffInput): Promise<PanelTimeOff> {
  if (USE_MOCK) {
    const entry: PanelTimeOff = {
      id: Math.max(0, ...mockStore.map((e) => e.id)) + 1,
      person: input.person,
      reason: input.reason.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      hoursPerDay: input.hoursPerDay,
      companyHoliday: input.companyHoliday,
    };
    if (entry.companyHoliday) entry.person = null;
    mockStore = [...mockStore, entry];
    return mockDelay({ ...entry });
  }
  requireConfigured("add time off");
  const fields = await buildPanelTimeOffFields(input);
  const created = await graphFetch<GraphListItem>(listPath(), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return {
    ...toPanelTimeOff(created, new Map()),
    person: input.companyHoliday ? null : input.person,
  };
}

export async function updatePanelTimeOff(
  id: number,
  input: PanelTimeOffInput,
): Promise<PanelTimeOff> {
  if (USE_MOCK) {
    const entry: PanelTimeOff = {
      id,
      ...input,
      person: input.companyHoliday ? null : input.person,
      reason: input.reason.trim(),
    };
    mockStore = mockStore.map((e) => (e.id === id ? entry : e));
    return mockDelay({ ...entry });
  }
  requireConfigured("change time off");
  const fields = await buildPanelTimeOffFields(input);
  await graphFetch(`${listPath()}/${id}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  return { id, ...input, person: input.companyHoliday ? null : input.person, reason: input.reason.trim() };
}

export async function deletePanelTimeOff(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((e) => e.id !== id);
    await mockDelay(null);
    return;
  }
  requireConfigured("remove time off");
  await graphFetch(`${listPath()}/${id}`, { method: "DELETE" });
}
