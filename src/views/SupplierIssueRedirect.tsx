import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSupplierIssues } from "@/hooks/useSupplierIssues";
import { LoadingTasks } from "@/components/LoadingTasks";

/**
 * /supply-chain/supplier-issue/:issueId — the deep-link target used by
 * issue-comment notification emails. Same arrangement as
 * SupplierContactRedirect and BuildRequestItemRedirect: issues live on their
 * supplier's detail page, not their own.
 */
export function SupplierIssueRedirect() {
  const { issueId } = useParams<{ issueId: string }>();
  const navigate = useNavigate();
  const { data: issues, isLoading } = useSupplierIssues();

  useEffect(() => {
    if (!issues) return;
    const id = issueId ? parseInt(issueId, 10) : NaN;
    const issue = issues.find((i) => i.id === id);
    if (issue && issue.supplierId) {
      navigate(`/supply-chain/supplier/${issue.supplierId}?issue=${issue.id}`, { replace: true });
    } else if (!isLoading) {
      navigate("/supply-chain/suppliers", { replace: true });
    }
  }, [issues, isLoading, issueId, navigate]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <LoadingTasks noun="this issue" />
    </div>
  );
}
