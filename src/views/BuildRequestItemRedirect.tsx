import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useBuildRequestItems } from "@/hooks/useBuildRequests";
import { LoadingTasks } from "@/components/LoadingTasks";

/**
 * /build-request-item/:itemId — the deep-link target used by part-comment
 * notification emails. Items don't have their own page; they live on their
 * parent header's detail page. This route looks the item up, then forwards
 * to /build-request/:headerId?item=:itemId so the right part card
 * auto-expands and scrolls into view.
 */
export function BuildRequestItemRedirect() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const { data: items, isLoading } = useBuildRequestItems();

  useEffect(() => {
    if (!items) return;
    const id = itemId ? parseInt(itemId, 10) : NaN;
    const item = items.find((i) => i.id === id);
    if (item) {
      navigate(`/build-request/${item.buildRequestLookupId}?item=${item.id}`, { replace: true });
    } else if (!isLoading) {
      navigate("/build-requests", { replace: true });
    }
  }, [items, isLoading, itemId, navigate]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <LoadingTasks noun="this part" />
    </div>
  );
}
