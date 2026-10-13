import { useCallback, useRef } from "react";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteProject, listTasks } from "@/api/tasks";
import { listEirs } from "@/api/eirs";
import { listEcns } from "@/api/ecns";
import { listTestSheets } from "@/api/testSheets";
import { listBuildRequests } from "@/api/buildRequests";
import { listBuildRequestItems } from "@/api/buildRequestItems";
import { listFaits } from "@/api/faits";
import { listProjectFolders } from "@/api/projectFiles";
import { listAdmins } from "@/api/admins";
import { isAdminEmail } from "@/lib/adminAccess";
import { describeListWriteFailure } from "@/lib/listWriteErrors";
import { describeProjectUsage, projectUsage, type ProjectUsage } from "@/lib/projectUsage";
import type { ProjectReference } from "@/types/task";
import { pushToast } from "@/components/Toast";
import { ADMINS_KEY } from "./useAdmins";
import { useCurrentUserEmails } from "./useCurrentUser";
import { useIsAdmin } from "./useIsAdmin";
import { PROJECTS_KEY, TASK_LIST_KEY } from "./useTasks";
import { EIRS_KEY } from "./useEirs";
import { ECN_KEY } from "./useEcns";
import { TEST_SHEETS_KEY } from "./useTestSheets";
import { BUILD_REQUESTS_KEY, BUILD_REQUEST_ITEMS_KEY } from "./useBuildRequests";
import { FAITS_KEY } from "./useFaits";
import { FOLDERS_KEY } from "./useTaskFiles";

// =============================================================================
// Deleting an Engineering project (BusinessIT#41).
//
// Refused while anything still points at the project — see lib/projectUsage.ts
// for why and which lists count. The usage check reads the SAME query keys the
// rest of the app uses, so an admin who has just re-pointed tasks elsewhere in
// ARC is checked against what they did, not a second copy.
// =============================================================================

/** How old a cached list may be when the check runs. */
const USAGE_FRESH_MS = 30_000;

export class ProjectInUseError extends Error {
  constructor(
    readonly project: string,
    readonly usage: ProjectUsage[],
  ) {
    super(
      `${project} is still used by ${describeProjectUsage(usage)}. ` +
        "Move them to the project you're keeping, then delete this one.",
    );
    this.name = "ProjectInUseError";
  }
}

/**
 * Every record still pointing at the project. Any list that can't be read
 * makes this THROW rather than report fewer uses — "couldn't look" must never
 * read as "nothing uses it", since the answer decides a delete.
 */
export async function loadProjectUsage(
  qc: QueryClient,
  lookupId: number,
  staleTime = USAGE_FRESH_MS,
): Promise<ProjectUsage[]> {
  const read = <T>(queryKey: readonly unknown[], queryFn: () => Promise<T>) =>
    qc.fetchQuery({ queryKey, queryFn, staleTime });
  try {
    const [tasks, eirs, ecns, testSheets, buildRequests, buildRequestItems, faits, projectFolders] =
      await Promise.all([
        read(TASK_LIST_KEY, listTasks),
        read(EIRS_KEY, listEirs),
        read(ECN_KEY, listEcns),
        read(TEST_SHEETS_KEY, listTestSheets),
        read(BUILD_REQUESTS_KEY, listBuildRequests),
        read(BUILD_REQUEST_ITEMS_KEY, listBuildRequestItems),
        read(FAITS_KEY, listFaits),
        read(FOLDERS_KEY, listProjectFolders),
      ]);
    return projectUsage(lookupId, {
      tasks,
      eirs,
      ecns,
      testSheets,
      buildRequests,
      buildRequestItems,
      faits,
      projectFolders,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Couldn't check where this project is used, so it wasn't deleted. ${detail.slice(0, 200)}`,
    );
  }
}

/** The usage shown in the delete dialog. Read fresh each time it opens. */
export function useProjectUsage(lookupId: number | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["projectUsage", lookupId],
    queryFn: () => loadProjectUsage(qc, lookupId as number, 0),
    enabled: lookupId !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Throws unless the signed-in user is an ARC admin, awaiting the Admins list. */
function useRequireAdmin(): () => Promise<void> {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  const renderTimeAdmin = useIsAdmin();
  const ref = useRef({ emails, renderTimeAdmin });
  ref.current = { emails, renderTimeAdmin };
  return useCallback(async () => {
    const admins = await qc
      .ensureQueryData({ queryKey: ADMINS_KEY, queryFn: listAdmins })
      .catch(() => null);
    const isAdmin = admins
      ? ref.current.emails.some((e) => isAdminEmail(e, admins))
      : ref.current.renderTimeAdmin;
    if (!isAdmin) throw new Error("Only ARC admins can delete projects.");
  }, [qc]);
}

/**
 * Delete a project — admin only, and only once nothing points at it. Both are
 * checked HERE, not just by the button, so no future screen can reach
 * `deleteProject` without them.
 *
 * One race is left, and stated: somebody linking a record to the project in
 * the seconds between the check and the delete. The lists are re-read at most
 * 30s old, and the window after that is the DELETE's own round trip.
 */
export function useDeleteProject() {
  const qc = useQueryClient();
  const requireAdmin = useRequireAdmin();
  return useMutation({
    mutationFn: async (project: ProjectReference) => {
      await requireAdmin();
      const usage = await loadProjectUsage(qc, project.lookupId);
      if (usage.length > 0) throw new ProjectInUseError(project.title, usage);
      await deleteProject(project.lookupId);
      return project;
    },
    onSuccess: (project) => {
      qc.setQueryData<ProjectReference[]>(PROJECTS_KEY, (old) =>
        old?.filter((p) => p.lookupId !== project.lookupId),
      );
      pushToast({ message: `Deleted ${project.title}.` });
    },
    onError: (err) => {
      const message =
        err instanceof ProjectInUseError ||
        (err instanceof Error && /^(Only ARC admins|Couldn't check)/.test(err.message))
          ? err.message
          : describeListWriteFailure(err, {
              action: "delete this project",
              site: "Altronic_Engineering",
            });
      pushToast({ message, variant: "error" });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  });
}
