import { Navigate, useNavigate, useParams } from "react-router-dom";
import { LoadingTasks } from "@/components/LoadingTasks";
import { PanelQcIssueFormModal } from "@/components/PanelQcIssueFormModal";
import { usePanelQcIssues } from "@/hooks/usePanelQcIssues";

export function PanelQcIssueEditorView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: issues = [], isLoading } = usePanelQcIssues();
  const issueId = id && id !== "new" ? Number(id) : null;
  const issue = issueId === null ? undefined : issues.find((entry) => entry.id === issueId);

  if (isLoading && issueId !== null) return <LoadingTasks noun="Panel QC issue" />;
  if (issueId !== null && !issue) return <Navigate to="/panels/qc-issues" replace />;

  return <PanelQcIssueFormModal issue={issue} onClose={() => navigate("/panels/qc-issues")} />;
}