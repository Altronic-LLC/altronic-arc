import { Lock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { siteLabelForId, unavailableAppLabels } from "@/api/appAccess";
import { clearAccessDenials, useAccessDenials } from "@/hooks/useListAccess";
import { describeAccessGap } from "@/lib/listAccess";

// =============================================================================
// The app-wide "you don't have access to some of this" banner.
//
// Sits beside UpdateAvailableBanner on every non-print route, and says the one
// thing eighty-odd screens couldn't say for themselves: that an empty list is
// empty because SharePoint refused it, not because there is nothing in it.
//
// It names APPS rather than lists wherever it can. A list GUID is the only
// thing a refusal actually carries, and it is useless to the person reading
// the banner and to whoever they forward it to.
// =============================================================================

export function ListAccessBanner() {
  const denials = useAccessDenials();
  const queryClient = useQueryClient();

  if (denials.count === 0) return null;

  const apps = unavailableAppLabels(denials);
  const sites = [...denials.implicatedSites]
    .map(siteLabelForId)
    .filter((label): label is string => label !== null);

  function checkAgain() {
    // Forget what we learned FIRST, so the refetch below starts from a clean
    // slate — anything still refused simply registers again a moment later.
    clearAccessDenials();
    void queryClient.refetchQueries();
  }

  return (
    <div className="border-b border-ajax-yellow/30 bg-ajax-yellow/10 py-3 text-sm text-fg">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-2">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />
          <span className="min-w-0">
            {describeAccessGap(apps, sites)}{" "}
            {sites.length > 0 && (
              <>
                Ask an admin for access to{" "}
                <span className="font-mono text-xs">{sites.join(", ")}</span>.
              </>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={checkAgain}
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-2"
        >
          Check again
        </button>
      </div>
    </div>
  );
}
