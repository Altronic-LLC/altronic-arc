import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ARC_PRODUCTION_URL, USE_MOCK } from "@/api/config";
import {
  GitHubError,
  addIssueToBusinessItProject,
  createBusinessItIssue,
  getBusinessItIssue,
  listBusinessItBoardStatuses,
  listBusinessItIssues,
  type BoardStatuses,
  listBusinessItLabels,
  updateBusinessItIssueBody,
} from "@/api/githubIssues";
import {
  buildIssueFromFeatureRequest,
  canManageFeatureRequestIssues,
  featureRequestIdsInIssue,
  featureRequestProductionUrl,
  findLinkedIssue,
  linkedIssueFooter,
  type GitHubIssue,
} from "@/lib/featureRequestIssues";
import type { FeatureRequest } from "@/types/task";
import { useCurrentUserEmails } from "./useCurrentUser";
import { readGitHubToken, useGitHubToken } from "./useGitHubToken";

/** Prefix for both queries — connecting a new token resets everything under it. */
export const BUSINESS_IT_KEY = ["businessIt"] as const;
export const BUSINESS_IT_ISSUES_KEY = ["businessIt", "issues"] as const;
export const BUSINESS_IT_BOARD_KEY = ["businessIt", "board"] as const;

/**
 * May the signed-in user see the GitHub controls? Ray and Tim in real mode;
 * the demo user in mock mode, so the feature can be shown without either.
 */
export function useCanManageFeatureRequestIssues(): boolean {
  const emails = useCurrentUserEmails();
  return USE_MOCK || canManageFeatureRequestIssues(emails);
}

/** Is there a token to call GitHub with? Mock mode needs none. */
export function useGitHubConnected(): boolean {
  const token = useGitHubToken();
  return USE_MOCK || !!token;
}

/**
 * Every BusinessIT issue, for the "already exists?" scan. One request per list
 * load, shared by every row. Only runs for a manager with a token, so nobody
 * else's browser ever talks to GitHub.
 */
export function useBusinessItIssues(enabled: boolean) {
  const token = useGitHubToken();
  const connected = USE_MOCK || !!token;
  return useQuery<GitHubIssue[], Error>({
    // The token is NOT in the key (it would land in devtools and the cache);
    // connecting or reconnecting invalidates the key instead.
    queryKey: BUSINESS_IT_ISSUES_KEY,
    queryFn: () => listBusinessItIssues(readGitHubToken()),
    enabled: enabled && connected,
    staleTime: 2 * 60 * 1000,
    // A refused token won't start working on a retry.
    retry: (count, err) => !(err instanceof GitHubError && err.isAuth) && count < 2,
  });
}

/**
 * Each BusinessIT issue's Status on the Business IT Tasks board. Its OWN
 * query, apart from the issue scan: it needs the token's Projects permission
 * as well, and a token without it must still show which issues exist — only
 * the Issue Status column goes blank.
 */
export function useBusinessItBoardStatuses(enabled: boolean) {
  const token = useGitHubToken();
  const connected = USE_MOCK || !!token;
  return useQuery<BoardStatuses, Error>({
    queryKey: BUSINESS_IT_BOARD_KEY,
    queryFn: () => listBusinessItBoardStatuses(readGitHubToken()),
    enabled: enabled && connected,
    staleTime: 2 * 60 * 1000,
    retry: (count, err) => !(err instanceof GitHubError && err.isAuth) && count < 2,
  });
}

export interface CreatedIssueResult {
  issue: GitHubIssue;
  /** True when the scan found one created in the meantime — nothing new was made. */
  alreadyExisted: boolean;
  /** Set when the issue was created but couldn't be put on the board. */
  projectError: string | null;
}

export class NotPermittedError extends Error {}

/** Asked inside every mutationFn, not only by whether the button rendered. */
function assertManager(emails: string[]): void {
  if (!USE_MOCK && !canManageFeatureRequestIssues(emails)) {
    throw new NotPermittedError("Only Ray White and Tim Webster can create or link BusinessIT issues from ARC.");
  }
}

/** The request's LIVE page — never localhost, even when testing from the dev server. */
function requestUrl(id: number): string {
  return featureRequestProductionUrl(id, ARC_PRODUCTION_URL);
}

function replaceIssue(list: GitHubIssue[] | undefined, issue: GitHubIssue): GitHubIssue[] | undefined {
  return list?.map((i) => (i.number === issue.number ? issue : i));
}

/**
 * Link an EXISTING issue to a request — for the issues raised by hand before
 * ARC could do it. Appends the ARC link and marker to the issue's body, so
 * from then on the scan matches it exactly rather than by guesswork.
 */
export function useLinkBusinessItIssue() {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  return useMutation<
    { issue: GitHubIssue; alreadyLinked: boolean },
    Error,
    { request: FeatureRequest; issue: GitHubIssue }
  >({
    mutationFn: async ({ request, issue }) => {
      assertManager(emails);
      const token = readGitHubToken();
      // The body as it stands NOW — somebody may have edited it since the scan.
      const fresh = await getBusinessItIssue(token, issue.number);
      const ids = featureRequestIdsInIssue(fresh.body);
      if (ids.includes(request.id)) return { issue: fresh, alreadyLinked: true };
      if (ids.length > 0) {
        throw new Error(
          `BusinessIT #${issue.number} is already linked to Feature Request #${ids[0]}. Unlink it on GitHub first if that's wrong.`,
        );
      }
      const updated = await updateBusinessItIssueBody(
        token,
        issue.number,
        fresh.body.trimEnd() + linkedIssueFooter(request.id, requestUrl(request.id)),
      );
      return { issue: updated, alreadyLinked: false };
    },
    onSuccess: ({ issue }) => {
      qc.setQueryData<GitHubIssue[] | undefined>(BUSINESS_IT_ISSUES_KEY, (list) =>
        replaceIssue(list, issue),
      );
    },
  });
}

export function useCreateBusinessItIssue() {
  const qc = useQueryClient();
  const emails = useCurrentUserEmails();
  return useMutation<CreatedIssueResult, Error, FeatureRequest>({
    mutationFn: async (request) => {
      assertManager(emails);
      const token = readGitHubToken();
      // A FRESH scan, not the cached one: the cache can be two minutes old,
      // and Ray and Tim can both be looking at the same request.
      const [issues, labels] = await Promise.all([
        listBusinessItIssues(token),
        listBusinessItLabels(token),
      ]);
      const existing = findLinkedIssue(request.id, issues);
      if (existing) {
        qc.setQueryData(BUSINESS_IT_ISSUES_KEY, issues);
        return { issue: existing, alreadyExisted: true, projectError: null };
      }
      const draft = buildIssueFromFeatureRequest(request, requestUrl(request.id), labels);
      const issue = await createBusinessItIssue(token, draft);
      // The issue is real from here on, so a refused board add is a warning,
      // not a failure — the same rule as the EIR → Task follow-up writes.
      let projectError: string | null = null;
      try {
        await addIssueToBusinessItProject(token, issue.nodeId);
        // It's in Backlog now — say so without re-reading the whole board.
        qc.setQueryData<BoardStatuses | undefined>(BUSINESS_IT_BOARD_KEY, (prev) =>
          prev ? { ...prev, [issue.number]: "Backlog" } : prev,
        );
      } catch (err) {
        projectError = err instanceof Error ? err.message : String(err);
      }
      qc.setQueryData<GitHubIssue[]>(BUSINESS_IT_ISSUES_KEY, [issue, ...issues]);
      return { issue, alreadyExisted: false, projectError };
    },
  });
}
