import type { PanelQcIssue } from "@/types/task";

const TAG_PATTERN = /^P-(\d{4})-(\d{4})$/i;

/** Return the next Panel QC tag for the year represented by `now`. */
export function nextPanelQcTag(issues: PanelQcIssue[], now: Date = new Date()): string {
  const year = now.getFullYear();
  const prefix = `P-${year}-`;
  const highest = issues.reduce((current, issue) => {
    const match = TAG_PATTERN.exec(issue.tagNumber.trim());
    if (!match || Number(match[1]) !== year) return current;
    return Math.max(current, Number(match[2]));
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}