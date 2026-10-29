import type { PanelTimeOff } from "@/types/task";
import { dayKey } from "./calendarGrid";
import { formatHours } from "./capacity";
import { tokenizeQuery } from "./itemSearch";

// =============================================================================
// Panel Time Off on a calendar (BusinessIT#42). One row covers a RANGE, so it
// is shown on every day from its first to its last — the opposite of
// Engineering's Where Am I?, where a row is one day. Pure.
// =============================================================================

/** Longest range spread onto a calendar — a mistyped year mustn't build a year of cells. */
const MAX_SPAN_DAYS = 366;

/** Each entry on every day of its range, keyed `yyyy-mm-dd`; a day's entries by name. */
export function panelTimeOffByDay(entries: readonly PanelTimeOff[]): Map<string, PanelTimeOff[]> {
  const out = new Map<string, PanelTimeOff[]>();
  for (const e of entries) {
    if (!e.startDate || !e.endDate) continue;
    const day = new Date(e.startDate);
    const last = dayKey(e.endDate);
    for (let i = 0; i < MAX_SPAN_DAYS && dayKey(day) <= last; i++) {
      const key = dayKey(day);
      out.set(key, [...(out.get(key) ?? []), e]);
      day.setUTCDate(day.getUTCDate() + 1);
    }
  }
  // A company holiday first (it's everyone's), then by name.
  for (const list of out.values()) {
    list.sort(
      (a, b) =>
        Number(b.companyHoliday) - Number(a.companyHoliday) ||
        (a.person?.displayName ?? "").localeCompare(b.person?.displayName ?? ""),
    );
  }
  return out;
}

/** Who an entry is for: the person, or everyone on a company holiday. */
export function panelTimeOffWho(e: PanelTimeOff): string {
  if (e.companyHoliday) return e.reason ? `Company holiday — ${e.reason}` : "Company holiday";
  return e.person?.displayName ?? "Someone";
}

/** "Sarah Shaffer" or "Sarah Shaffer · 4h" — one line in a calendar cell. */
export function panelTimeOffLabel(e: PanelTimeOff): string {
  const who = panelTimeOffWho(e);
  return e.hoursPerDay === null ? who : `${who} · ${formatHours(e.hoursPerDay)}`;
}

/** "Sarah Shaffer — Doctor's appointment (4h off)" — the cell's tooltip. */
export function panelTimeOffTitle(e: PanelTimeOff): string {
  const parts = [e.companyHoliday ? "Company holiday (everyone)" : e.person?.displayName ?? "Someone"];
  if (e.reason) parts.push(e.reason);
  const hours = e.hoursPerDay === null ? "whole day" : `${formatHours(e.hoursPerDay)} off`;
  return `${parts.join(" — ")} (${hours})`;
}

/** Every search word must match the name or the reason. */
export function filterPanelTimeOff(entries: readonly PanelTimeOff[], q: string): PanelTimeOff[] {
  const words = tokenizeQuery(q);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => {
    const holiday = e.companyHoliday ? "company holiday" : "";
    const text = `${e.person?.displayName ?? ""} ${e.person?.email ?? ""} ${e.reason} ${holiday}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
