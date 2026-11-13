import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_PANEL_SETTINGS_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import type { GraphListItem } from "@/types/task";
import { odataString } from "@/lib/odata";
import {
  DEFAULT_PANEL_SETTINGS,
  PANEL_SETTING_KEYS,
  type PanelSettings,
  parsePanelSettings,
} from "@/lib/panelSettings";

// =============================================================================
// Panel Settings — the panel team's few adjustable settings, on
// ALTRONICPANELTEAM: one row per setting, Title = its name, Value = text.
// Today the Capacity view's amber threshold (Tim, 2026-10-29), changed in ARC
// by a panel Super User or an ARC admin.
//
// Unset list = the built-in defaults, read-only. A row is found by its Title
// (fresh read at write time) and updated, or added when missing — never two.
// =============================================================================

let mockRows: Record<string, string> = {};

/** Demo-mode-only: reset (tests). */
export function resetPanelSettingsMockStore(): void {
  mockRows = {};
}

/** Whether the list is set up. Demo mode always is. */
export const PANEL_SETTINGS_CONFIGURED = USE_MOCK || !!SP_PANEL_SETTINGS_LIST_ID;

function listPath(): string {
  return `/sites/${SITES.panelTeam}/lists/${SP_PANEL_SETTINGS_LIST_ID}/items`;
}

export async function getPanelSettings(): Promise<PanelSettings> {
  if (USE_MOCK) return mockDelay(parsePanelSettings(mockRows));
  if (!SP_PANEL_SETTINGS_LIST_ID) return { ...DEFAULT_PANEL_SETTINGS };
  const items = await graphFetchAll<GraphListItem>(
    `${listPath()}?$expand=fields($select=Title,Value)&$top=999`,
  );
  const rows: Record<string, string> = {};
  for (const it of items) {
    const f = it.fields as Record<string, unknown>;
    if (typeof f.Title === "string") rows[f.Title] = typeof f.Value === "string" ? f.Value : "";
  }
  return parsePanelSettings(rows);
}

/** Write one setting: update its row, or add it when there isn't one. */
async function writeSetting(key: string, value: string): Promise<void> {
  if (USE_MOCK) {
    mockRows = { ...mockRows, [key]: value };
    return mockDelay(undefined);
  }
  if (!SP_PANEL_SETTINGS_LIST_ID) {
    throw new Error(
      "The Panel Settings list isn't set up yet, so this can't be changed. " +
        "Run scripts/setup-panel-planning.ps1 and set VITE_SP_PANEL_SETTINGS_LIST_ID.",
    );
  }
  const existing = await graphFetch<{ value: GraphListItem[] }>(
    `${listPath()}?$filter=fields/Title eq ${odataString(key)}&$select=id&$top=1`,
    { headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" } },
  );
  const row = existing.value[0];
  if (row) {
    await graphFetch(`${listPath()}/${row.id}/fields`, {
      method: "PATCH",
      body: JSON.stringify({ Value: value }),
    });
  } else {
    await graphFetch(listPath(), {
      method: "POST",
      body: JSON.stringify({ fields: { Title: key, Value: value } }),
    });
  }
}

/** The Capacity view's amber threshold, as a whole percentage. */
export async function setPanelAmberPercent(percent: number): Promise<PanelSettings> {
  await writeSetting(PANEL_SETTING_KEYS.amberPercent, String(percent));
  return getPanelSettings();
}
