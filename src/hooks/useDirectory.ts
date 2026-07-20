import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { listDirectoryPeople, probeDirectory, type DirectoryProbe } from "@/api/directory";
import type { Person } from "@/types/task";

export const DIRECTORY_KEY = ["directoryPeople"] as const;
const DIRECTORY_PROBE_KEY = ["directoryProbe"] as const;

const SIX_HOURS = 6 * 60 * 60_000;
/**
 * When the directory comes back EMPTY it's almost always degraded (token/
 * consent not ready), not a genuinely empty tenant — so don't sit on that for
 * six hours. Retry it soon so the pickers self-heal once the problem clears
 * (e.g. after an admin grants consent) without the user reloading.
 */
const EMPTY_RETRY_MS = 60_000;

/**
 * The staff directory (whole tenant) for the assignment + @-mention pickers.
 * A non-empty result is cached hard (6h) since it rarely changes; an empty
 * result is treated as stale quickly so it retries. Returns [] (never errors
 * out a view) when the directory can't be read — `listDirectoryPeople` already
 * degrades to [] in that case.
 */
export function useDirectoryPeople(): Person[] {
  const { data = [] } = useQuery({
    queryKey: DIRECTORY_KEY,
    queryFn: listDirectoryPeople,
    staleTime: (query) => (query.state.data?.length ? SIX_HOURS : EMPTY_RETRY_MS),
    gcTime: 12 * 60 * 60_000,
  });
  return data;
}

/**
 * Diagnostic probe of the tenant directory — count of people loaded, or the
 * exact failure reason. Powers the About page's "Staff directory" status card.
 * Mounted on demand (About only), not app-wide, so the full /users read isn't
 * paged on every screen. The card's "Retry" button force-refetches regardless
 * of staleTime.
 */
export function useDirectoryDiagnostics(enabled = true): UseQueryResult<DirectoryProbe> {
  return useQuery({
    queryKey: DIRECTORY_PROBE_KEY,
    queryFn: probeDirectory,
    enabled,
    staleTime: 2 * 60_000,
    gcTime: 2 * 60_000,
    retry: false,
  });
}
