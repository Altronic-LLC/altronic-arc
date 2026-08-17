import type { LimitBreach, PottingLimits, PottingSampleEntry } from "./pottingSampleLog";
import { escapeHtml } from "./mentions";

// =============================================================================
// Potting-limit breach email — pure content builder (testable without Graph).
// Sending lives in src/api/pottingSampleLog.ts, same split as changeAlerts.ts.
// =============================================================================

export function pottingLimitAlertSubject(entry: PottingSampleEntry, breach: LimitBreach): string {
  const direction = breach === "below-lower" ? "below lower limit" : "above upper limit";
  return `[ARC] Coil potting sample ${direction} — weight ${entry.weight}`;
}

export function pottingLimitAlertHtml(
  entry: PottingSampleEntry,
  limits: PottingLimits,
  breach: LimitBreach,
): string {
  const direction = breach === "below-lower" ? "below the lower spec limit" : "above the upper spec limit";
  const dateStr = new Date(entry.date).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;">
      <div style="background:#CB2C30;color:#fff;padding:16px 20px;font-size:16px;font-weight:600;">
        ARC — Coil Potting Sample Log
      </div>
      <div style="padding:20px;">
        <p style="margin:0 0 12px;">
          A recorded potting sample weight is <strong>${escapeHtml(direction)}</strong>.
        </p>
        <table style="border-collapse:collapse;font-size:14px;">
          <tbody>
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Date</td><td>${escapeHtml(dateStr)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Volume</td><td>${entry.volume}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Weight</td><td><strong>${entry.weight}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Lower Spec Limit</td><td>${limits.lowerLimit}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Upper Spec Limit</td><td>${limits.upperLimit}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}
