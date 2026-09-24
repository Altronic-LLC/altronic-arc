import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchListItemCount } from "@/api/listItemCount";
import { markAppUnreadable } from "./useListAccess";

// =============================================================================
// A list that read fine and handed back nothing: is it empty, or is it yours
// to open but not to read?
//
// Only asked when a screen has ZERO rows and no error — so it costs a request
// on an empty screen and nothing at all on a working one. See
// api/listItemCount.ts for why SharePoint's ItemCount is the one signal that
// can tell the two apart, and why it can never fire on a genuinely empty list.
// =============================================================================

export interface EmptyListCheck {
  /** How many rows SharePoint says the list holds, when it would say. */
  totalItems: number | null;
  /** True once we know the rows exist and none of them came back. */
  hiddenRows: boolean;
}

export function useEmptyListCheck({
  appPath,
  siteUrl,
  listId,
  rowCount,
  ready,
}: {
  /** The app to lock, as registered in api/appAccess.ts. */
  appPath: string;
  siteUrl: string | undefined;
  listId: string | undefined;
  rowCount: number;
  /** False while the list is still loading, or if the read FAILED — a failed
   *  read has its own notice and must not be diagnosed as a trimmed one. */
  ready: boolean;
}): EmptyListCheck {
  const shouldAsk = ready && rowCount === 0 && !!siteUrl && !!listId;

  const { data: totalItems = null } = useQuery({
    queryKey: ["listItemCount", listId],
    queryFn: () => fetchListItemCount(siteUrl, listId),
    enabled: shouldAsk,
    staleTime: Infinity,
    retry: false,
  });

  const hiddenRows = shouldAsk && typeof totalItems === "number" && totalItems > 0;

  useEffect(() => {
    if (hiddenRows) markAppUnreadable(appPath);
  }, [hiddenRows, appPath]);

  return { totalItems, hiddenRows };
}
