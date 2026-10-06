import {
  BUSINESS_IT_BACKLOG_OPTION_ID,
  BUSINESS_IT_PROJECT_ID,
  BUSINESS_IT_REPO,
  BUSINESS_IT_STATUS_FIELD_ID,
  USE_MOCK,
} from "./config";
import { mockDelay } from "./mockLatency";
import type { GitHubIssue, GitHubIssueDraft } from "@/lib/featureRequestIssues";
import {
  MOCK_BUSINESS_IT_BOARD_STATUSES,
  MOCK_BUSINESS_IT_ISSUES,
  MOCK_BUSINESS_IT_LABELS,
} from "@/data/businessItIssueMockData";

// =============================================================================
// The BusinessIT GitHub repo — read its issues, open one, put it on the
// "Business IT Tasks" board. Used by ARC Feature Requests (Ray and Tim only).
//
// **Every call carries the signed-in person's OWN GitHub token**, pasted once
// into ARC and kept in their browser (`hooks/useGitHubToken.ts`). There is
// deliberately NO token in the bundle: ARC is public JavaScript on GitHub
// Pages, so a shared token there would be anyone's — the same reasoning that
// keeps the Power Automate flow URL out of it. A personal token also means
// GitHub, not ARC, decides what each person may do.
//
// api.github.com answers CORS for any origin, so this works straight from the
// browser with no backend.
// =============================================================================

const API = "https://api.github.com";
const REPO_PATH = `/repos/${BUSINESS_IT_REPO.owner}/${BUSINESS_IT_REPO.name}`;
/** The repo has a few dozen issues; this is a runaway guard, not a limit anyone should meet. */
const MAX_PAGES = 20;

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The token is missing, wrong, expired or not authorised for the org — reconnecting fixes it. */
    readonly isAuth: boolean,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

async function githubFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  if (!token) throw new GitHubError("Connect GitHub first — no token is saved in this browser.", 401, true);
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const json = (await res.json()) as { message?: string };
      detail = json.message ?? "";
    } catch {
      /* no body */
    }
    throw toGitHubError(res.status, detail);
  }
  return (await res.json()) as T;
}

/** A failed call, in words someone can act on. */
export function toGitHubError(status: number, detail: string): GitHubError {
  const lower = detail.toLowerCase();
  if (status === 401 || lower.includes("bad credentials")) {
    return new GitHubError(
      "GitHub refused your token — it may be wrong or expired. Reconnect GitHub with a new one.",
      status,
      true,
    );
  }
  if (lower.includes("saml") || lower.includes("sso")) {
    return new GitHubError(
      "Your token isn't authorised for the Altronic-LLC organisation. Authorise it for SSO on GitHub, then try again.",
      status,
      true,
    );
  }
  if (status === 404) {
    return new GitHubError(
      `GitHub can't see ${BUSINESS_IT_REPO.owner}/${BUSINESS_IT_REPO.name} with your token. Give the token access to that repo (Issues: read and write).`,
      status,
      true,
    );
  }
  if (status === 403 && lower.includes("rate limit")) {
    return new GitHubError("GitHub's rate limit was hit. Wait a minute and try again.", status, false);
  }
  if (status === 403) {
    return new GitHubError(
      `GitHub refused the request${detail ? `: ${detail}` : ""}. Check the token has Issues read/write on BusinessIT.`,
      status,
      true,
    );
  }
  return new GitHubError(`GitHub ${status}${detail ? `: ${detail}` : ""}`, status, false);
}

interface RawIssue {
  number: number;
  node_id: string;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  pull_request?: unknown;
}

function toIssue(raw: RawIssue): GitHubIssue {
  return {
    number: raw.number,
    nodeId: raw.node_id,
    title: raw.title,
    state: raw.state === "closed" ? "closed" : "open",
    htmlUrl: raw.html_url,
    body: raw.body ?? "",
  };
}

let mockIssues: GitHubIssue[] = MOCK_BUSINESS_IT_ISSUES.map((i) => ({ ...i }));
let mockBoardStatuses: Record<number, string> = { ...MOCK_BUSINESS_IT_BOARD_STATUSES };

/** Test-only: mock mode mutates a module-level store. */
export function __resetBusinessItMockStore(): void {
  mockIssues = MOCK_BUSINESS_IT_ISSUES.map((i) => ({ ...i }));
  mockBoardStatuses = { ...MOCK_BUSINESS_IT_BOARD_STATUSES };
}

/**
 * Every BusinessIT issue, open AND closed, pull requests excluded. Listed
 * rather than searched: the search API lags new issues by up to a minute, so
 * an issue created a moment ago could scan as missing and be created twice.
 */
export async function listBusinessItIssues(token: string): Promise<GitHubIssue[]> {
  if (USE_MOCK) return mockDelay(mockIssues.map((i) => ({ ...i })));
  const all: GitHubIssue[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await githubFetch<RawIssue[]>(
      token,
      `${REPO_PATH}/issues?state=all&per_page=100&page=${page}`,
    );
    for (const raw of batch) if (!raw.pull_request) all.push(toIssue(raw));
    if (batch.length < 100) break;
  }
  return all;
}

/** The repo's label names — a new issue only asks for labels that exist. */
export async function listBusinessItLabels(token: string): Promise<string[]> {
  if (USE_MOCK) return mockDelay([...MOCK_BUSINESS_IT_LABELS]);
  const labels = await githubFetch<Array<{ name: string }>>(token, `${REPO_PATH}/labels?per_page=100`);
  return labels.map((l) => l.name);
}

export async function createBusinessItIssue(token: string, draft: GitHubIssueDraft): Promise<GitHubIssue> {
  if (USE_MOCK) {
    const number = Math.max(0, ...mockIssues.map((i) => i.number)) + 1;
    const issue: GitHubIssue = {
      number,
      nodeId: `I_mock_${number}`,
      title: draft.title,
      state: "open",
      htmlUrl: `https://github.com/${BUSINESS_IT_REPO.owner}/${BUSINESS_IT_REPO.name}/issues/${number}`,
      body: draft.body,
    };
    mockIssues = [issue, ...mockIssues];
    return mockDelay({ ...issue });
  }
  const raw = await githubFetch<RawIssue>(token, `${REPO_PATH}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: draft.title, body: draft.body, labels: draft.labels }),
  });
  return toIssue(raw);
}

/** One issue, read fresh — Link appends to the body as it stands NOW. */
export async function getBusinessItIssue(token: string, number: number): Promise<GitHubIssue> {
  if (USE_MOCK) {
    const found = mockIssues.find((i) => i.number === number);
    if (!found) throw new GitHubError(`BusinessIT #${number} doesn't exist.`, 404, false);
    return mockDelay({ ...found });
  }
  return toIssue(await githubFetch<RawIssue>(token, `${REPO_PATH}/issues/${number}`));
}

/** Replace an issue's body. Callers read it first and send it back extended. */
export async function updateBusinessItIssueBody(
  token: string,
  number: number,
  body: string,
): Promise<GitHubIssue> {
  if (USE_MOCK) {
    mockIssues = mockIssues.map((i) => (i.number === number ? { ...i, body } : i));
    return getBusinessItIssue(token, number);
  }
  const raw = await githubFetch<RawIssue>(token, `${REPO_PATH}/issues/${number}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
  return toIssue(raw);
}

async function githubGraphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  // GraphQL answers 200 with an `errors` array for a refused mutation, so the
  // body has to be checked — a 200 alone proves nothing.
  const json = await githubFetch<{ data?: T; errors?: Array<{ message: string }> }>(
    token,
    `${API}/graphql`,
    { method: "POST", body: JSON.stringify({ query, variables }) },
  );
  if (json.errors?.length || !json.data) {
    throw new GitHubError(json.errors?.map((e) => e.message).join("; ") || "GitHub returned no data.", 200, false);
  }
  return json.data;
}

/** Issue number → its board Status name ("Backlog", "In progress", …). */
export type BoardStatuses = Record<number, string>;

interface BoardItemsPage {
  node: {
    items: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{
        fieldValueByName: { name?: string } | null;
        content: { number?: number; repository?: { name: string; owner: { login: string } } } | null;
      }>;
    };
  } | null;
}

const BOARD_ITEMS_QUERY = `query($project: ID!, $after: String) {
  node(id: $project) { ... on ProjectV2 {
    items(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        content { ... on Issue { number repository { name owner { login } } } }
      }
    }
  } }
}`;

/**
 * Every BusinessIT issue on the Business IT Tasks board, with its Status.
 * Read from the BOARD, not the issues: the column lives on the project item.
 * Items from other repos (the board can hold them) and drafts are skipped. An
 * issue on the board with no Status set is simply absent.
 */
export async function listBusinessItBoardStatuses(token: string): Promise<BoardStatuses> {
  if (USE_MOCK) return mockDelay({ ...mockBoardStatuses });
  const out: BoardStatuses = {};
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: BoardItemsPage = await githubGraphql<BoardItemsPage>(token, BOARD_ITEMS_QUERY, {
      project: BUSINESS_IT_PROJECT_ID,
      after,
    });
    const items = data.node?.items;
    if (!items) break;
    for (const item of items.nodes) {
      const repo = item.content?.repository;
      const number = item.content?.number;
      const status = item.fieldValueByName?.name;
      if (
        number &&
        status &&
        repo?.name.toLowerCase() === BUSINESS_IT_REPO.name.toLowerCase() &&
        repo.owner.login.toLowerCase() === BUSINESS_IT_REPO.owner.toLowerCase()
      ) {
        out[number] = status;
      }
    }
    if (!items.pageInfo.hasNextPage) break;
    after = items.pageInfo.endCursor;
  }
  return out;
}

/**
 * Put a NEW issue on the Business IT Tasks board, in Backlog. Adding is
 * idempotent on GitHub's side — an issue already there returns its existing
 * item — so it's safe whether or not the board auto-adds new issues. Two
 * calls, because setting the status needs the item id the add hands back.
 * Needs the token's organisation "Projects: read and write" permission
 * (classic: `project`).
 */
export async function addIssueToBusinessItProject(token: string, issueNodeId: string): Promise<void> {
  if (USE_MOCK) {
    const issue = mockIssues.find((i) => i.nodeId === issueNodeId);
    if (issue) mockBoardStatuses[issue.number] = "Backlog";
    return mockDelay(undefined);
  }
  const added = await githubGraphql<{ addProjectV2ItemById: { item: { id: string } } }>(
    token,
    "mutation($project: ID!, $content: ID!) { addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } } }",
    { project: BUSINESS_IT_PROJECT_ID, content: issueNodeId },
  );
  await githubGraphql(
    token,
    "mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) { updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { projectV2Item { id } } }",
    {
      project: BUSINESS_IT_PROJECT_ID,
      item: added.addProjectV2ItemById.item.id,
      field: BUSINESS_IT_STATUS_FIELD_ID,
      option: BUSINESS_IT_BACKLOG_OPTION_ID,
    },
  );
}
