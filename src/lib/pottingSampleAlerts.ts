import type { LimitBreach, PottingLimits, PottingSampleEntry } from "./pottingSampleLog";
import { escapeHtml } from "./mentions";

// =============================================================================
// Potting-limit breach email — pure content builder (testable without Graph).
// Sending lives in src/api/pottingSampleLog.ts → sendOpenAlert in api/email.ts.
//
// It uses ARC's standard email layout (BusinessIT#67, Tim 2026-11-06) with two
// deliberate differences from every other ARC email:
//   - NO button. The email carries every figure; there's nothing to open ARC for.
//   - Everyone on the PSR list is in To, not Bcc, so Reply all reaches the
//     whole list — a sample out of limit is discussed by the group.
// It also keeps its own subject (no Outlook conversation): each sample is its
// own event, not an item that gathers updates.
// =============================================================================

export function pottingLimitAlertSubject(entry: PottingSampleEntry, breach: LimitBreach): string {
  const direction = breach === "below-lower" ? "below lower limit" : "above upper limit";
  return `[ARC] Coil potting sample ${direction} — weight ${entry.weight}`;
}

function sampleDate(entry: PottingSampleEntry): string {
  const d = new Date(entry.date);
  if (Number.isNaN(d.getTime())) return entry.date;
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/** The pieces the shared email layout draws: the card, the headline, the figures. */
export function pottingLimitAlertContent(
  entry: PottingSampleEntry,
  limits: PottingLimits,
  breach: LimitBreach,
): { calloutTitle: string; introHtml: string; messageHtml: string } {
  const direction = breach === "below-lower" ? "below the lower spec limit" : "above the upper spec limit";
  const row = (label: string, value: string, strong = false) =>
    `<div style="font-size:14px;">${escapeHtml(label)}: ` +
    (strong
      ? `<strong style="color:#CB2C30;">${escapeHtml(value)}</strong>`
      : `<strong>${escapeHtml(value)}</strong>`) +
    `</div>`;
  return {
    calloutTitle: `Weight ${entry.weight} — ${sampleDate(entry)}`,
    introHtml: `A recorded coil potting sample weight is <strong>${escapeHtml(direction)}</strong>.`,
    messageHtml:
      row("Date", sampleDate(entry)) +
      row("Volume", String(entry.volume)) +
      row("Weight", String(entry.weight), true) +
      row("Lower spec limit", String(limits.lowerLimit)) +
      row("Upper spec limit", String(limits.upperLimit)),
  };
}
