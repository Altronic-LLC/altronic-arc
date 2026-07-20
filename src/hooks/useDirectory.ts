import { useQuery } from "@tanstack/react-query";
import { listDirectoryPeople } from "@/api/directory";
import type { Person } from "@/types/task";

const DIRECTORY_KEY = ["directoryPeople"] as const;

/**
 * The staff directory (members of the "everyone" group) for the assignment +
 * @-mention pickers. Cached hard — the directory rarely changes and reading
 * it hits Graph under a separate scope, so we don't want to refetch it per
 * view. Returns [] (never errors out a view) when the group can't be read;
 * `listDirectoryPeople` already degrades to [] in that case.
 */
export function useDirectoryPeople(): Person[] {
  const { data = [] } = useQuery({
    queryKey: DIRECTORY_KEY,
    queryFn: listDirectoryPeople,
    staleTime: 6 * 60 * 60_000, // 6 hours
    gcTime: 12 * 60 * 60_000,
  });
  return data;
}
