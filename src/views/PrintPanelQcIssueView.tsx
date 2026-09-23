import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { LoadingTasks } from "@/components/LoadingTasks";
import { usePanelQcIssues } from "@/hooks/usePanelQcIssues";
import { formatSpDate } from "@/lib/spDates";
import { printPanelQcLabelSilently } from "@/api/qzPrint";
import type { PanelQcIssue } from "@/types/task";

const DESCRIPTION_LIMIT = 105;

export function truncateLabelDescription(value: string): string {
  const text = value.trim();
  if (text.length <= DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}…`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * A self-contained, fully inline-styled HTML string of the same label the
 * JSX below renders on screen — built separately rather than reusing that
 * JSX's `outerHTML`, because QZ Tray's HTML print path uses its OWN,
 * considerably more limited HTML/CSS renderer, not the browser's. It has no
 * access to this app's Tailwind stylesheet (a class name means nothing
 * without the rules behind it) and historically has weak support for
 * anything past basic HTML/CSS2 — so this deliberately avoids flexbox and
 * any external stylesheet dependency, using plain block elements and
 * `float` for the one two-ends header row instead. Exported so the field
 * layout can be pinned by a test without needing QZ Tray installed.
 */
export function buildPanelQcLabelHtml(issue: PanelQcIssue): string {
  const tagNumber = escapeHtml(issue.tagNumber || "—");
  const serialNote = escapeHtml(issue.subComponentSerialNumber || "—");
  const partNumber = escapeHtml(issue.subComponentPartNumber || "—");
  const description = escapeHtml(truncateLabelDescription(issue.partDescription) || "—");
  const date = escapeHtml(formatSpDate(issue.date));
  return `
<div style="box-sizing:border-box;width:3in;height:2in;padding:0.12in;font-family:Arial,Helvetica,sans-serif;font-size:9pt;line-height:1.3;color:#000;background:#fff;">
  <div style="border-bottom:1px solid #000;padding-bottom:4px;overflow:hidden;">
    <span style="font-weight:bold;float:left;">PANEL QC</span>
    <span style="font-weight:bold;font-family:'Courier New',monospace;font-size:10pt;float:right;">${tagNumber}</span>
  </div>
  <div style="padding-top:4px;">
    <div><b>Serial Note: </b>${serialNote}</div>
    <div><b>Part Number: </b>${partNumber}</div>
    <div><b>Description: </b>${description}</div>
    <div><b>Date: </b>${date}</div>
  </div>
  <div style="border-top:1px solid #000;padding-top:4px;font-size:8pt;">Panel Component Failure</div>
</div>`.trim();
}

export function PrintPanelQcIssueView() {
  const { id } = useParams<{ id: string }>();
  const issueId = id ? Number(id) : NaN;
  const { data: issues = [], isLoading } = usePanelQcIssues();
  const issue = issues.find((entry) => entry.id === issueId);

  useEffect(() => {
    if (isLoading || !issue) return;
    let cancelled = false;
    (async () => {
      // Try the configured network printer first — silent, no dialog. Only
      // when that's unavailable for any reason (QZ Tray not installed, the
      // printer not configured, or not currently found) does this fall
      // back to the browser's own print dialog, exactly as before.
      const printedSilently = await printPanelQcLabelSilently(buildPanelQcLabelHtml(issue));
      if (cancelled) return;
      if (printedSilently) {
        // This tab only ever exists because the modal opened it with
        // `window.open` for the browser-dialog path — closing it once the
        // silent print has actually gone out is what makes "it just
        // prints" true rather than leaving a spare tab behind to notice
        // and close by hand.
        window.close();
        return;
      }
      const fontsReady = document.fonts?.ready ?? Promise.resolve();
      await fontsReady;
      if (!cancelled) requestAnimationFrame(() => { if (!cancelled) window.print(); });
    })();
    return () => { cancelled = true; };
  }, [isLoading, issue]);

  if (isLoading) return <LoadingTasks noun="this Panel QC label" />;
  if (!issue) return <div className="p-8 text-sm">That Panel QC issue could not be found.</div>;

  return <div className="panel-qc-label mx-auto flex h-[2in] w-[3in] flex-col justify-between overflow-hidden bg-white p-[0.12in] font-sans text-[9pt] leading-tight text-black print:m-0 print:p-[0.12in]" style={{ page: "panel-qc-label" }}>
    <div className="flex items-start justify-between gap-1 border-b border-black pb-1"><span className="font-bold">PANEL QC</span><span className="font-mono text-[10pt] font-bold">{issue.tagNumber || "—"}</span></div>
    <div className="space-y-1 pt-1"><div><span className="font-bold">Serial Note: </span>{issue.subComponentSerialNumber || "—"}</div><div><span className="font-bold">Part Number: </span>{issue.subComponentPartNumber || "—"}</div><div><span className="font-bold">Description: </span>{truncateLabelDescription(issue.partDescription) || "—"}</div><div><span className="font-bold">Date: </span>{formatSpDate(issue.date)}</div></div>
    <div className="border-t border-black pt-1 text-[8pt]">Panel Component Failure</div>
  </div>;
}
