import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { LoadingTasks } from "@/components/LoadingTasks";
import { usePanelQcIssues } from "@/hooks/usePanelQcIssues";
import { formatSpDate } from "@/lib/spDates";

const DESCRIPTION_LIMIT = 105;

export function truncateLabelDescription(value: string): string {
  const text = value.trim();
  if (text.length <= DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}…`;
}

export function PrintPanelQcIssueView() {
  const { id } = useParams<{ id: string }>();
  const issueId = id ? Number(id) : NaN;
  const { data: issues = [], isLoading } = usePanelQcIssues();
  const issue = issues.find((entry) => entry.id === issueId);

  useEffect(() => {
    if (isLoading || !issue) return;
    let cancelled = false;
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    void fontsReady.then(() => {
      if (!cancelled) requestAnimationFrame(() => { if (!cancelled) window.print(); });
    });
    return () => { cancelled = true; };
  }, [isLoading, issue]);

  if (isLoading) return <LoadingTasks noun="this Panel QC label" />;
  if (!issue) return <div className="p-8 text-sm">That Panel QC issue could not be found.</div>;

  return <div className="panel-qc-label mx-auto flex h-[2in] w-[2in] flex-col justify-between overflow-hidden bg-white p-[0.12in] font-sans text-[7pt] leading-tight text-black print:m-0 print:p-[0.12in]" style={{ page: "panel-qc-label" }}>
    <div className="flex items-start justify-between gap-1 border-b border-black pb-1"><span className="font-bold">PANEL QC</span><span className="font-mono text-[8pt] font-bold">{issue.tagNumber || "—"}</span></div>
    <div className="space-y-1 pt-1"><div><span className="font-bold">Serial Note: </span>{issue.subComponentSerialNumber || "—"}</div><div><span className="font-bold">Part Number: </span>{issue.subComponentPartNumber || "—"}</div><div><span className="font-bold">Description: </span>{truncateLabelDescription(issue.partDescription) || "—"}</div><div><span className="font-bold">Date: </span>{formatSpDate(issue.date)}</div></div>
    <div className="border-t border-black pt-1 text-[6pt]">Panel Component Failure</div>
  </div>;
}