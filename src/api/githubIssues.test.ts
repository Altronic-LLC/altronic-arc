import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// REAL mode: the request shapes GitHub sees. The mock branch reads nothing
// from the wire, so none of this is visible from mock mode.
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false };
});

import {
  GitHubError,
  addIssueToBusinessItProject,
  createBusinessItIssue,
  getBusinessItIssue,
  listBusinessItBoardStatuses,
  listBusinessItIssues,
  listBusinessItLabels,
  toGitHubError,
  updateBusinessItIssueBody,
} from "./githubIssues";

const fetchMock = vi.fn();

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function rawIssue(number: number, extra: Record<string, unknown> = {}) {
  return {
    number,
    node_id: `I_${number}`,
    title: `Issue ${number}`,
    state: "open",
    html_url: `https://github.com/Altronic-LLC/BusinessIT/issues/${number}`,
    body: null,
    ...extra,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listBusinessItIssues", () => {
  it("lists open AND closed issues with the person's token, and drops pull requests", async () => {
    fetchMock.mockReturnValueOnce(
      ok([rawIssue(1), rawIssue(2, { state: "closed" }), rawIssue(3, { pull_request: {} })]),
    );
    const issues = await listBusinessItIssues("tok");
    expect(issues.map((i) => i.number)).toEqual([1, 2]);
    expect(issues[1].state).toBe("closed");
    expect(issues[0].body).toBe("");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/Altronic-LLC/BusinessIT/issues?state=all&per_page=100&page=1",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("follows pages until one comes back short", async () => {
    const full = Array.from({ length: 100 }, (_, i) => rawIssue(i + 1));
    fetchMock.mockReturnValueOnce(ok(full)).mockReturnValueOnce(ok([rawIssue(101)]));
    const issues = await listBusinessItIssues("tok");
    expect(issues).toHaveLength(101);
    expect(fetchMock.mock.calls[1][0]).toContain("page=2");
  });

  it("refuses to call GitHub with no token at all", async () => {
    await expect(listBusinessItIssues("")).rejects.toMatchObject({ isAuth: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns a 401 into a reconnect message", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve(new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })),
    );
    await expect(listBusinessItIssues("tok")).rejects.toMatchObject({
      isAuth: true,
      message: expect.stringMatching(/reconnect/i),
    });
  });
});

describe("toGitHubError", () => {
  it("names SSO when the org enforces it", () => {
    const err = toGitHubError(403, "Resource protected by organization SAML enforcement.");
    expect(err.isAuth).toBe(true);
    expect(err.message).toMatch(/SSO/);
  });

  it("explains a 404 as the token not reaching the private repo", () => {
    expect(toGitHubError(404, "Not Found").message).toMatch(/BusinessIT/);
  });

  it("does not ask for a new token over a rate limit", () => {
    expect(toGitHubError(403, "API rate limit exceeded").isAuth).toBe(false);
  });

  it("keeps an unrecognised error's own words", () => {
    expect(toGitHubError(500, "boom").message).toBe("GitHub 500: boom");
  });
});

describe("listBusinessItLabels", () => {
  it("returns the label names", async () => {
    fetchMock.mockReturnValueOnce(ok([{ name: "ARC" }, { name: "bug" }]));
    expect(await listBusinessItLabels("tok")).toEqual(["ARC", "bug"]);
  });
});

describe("createBusinessItIssue", () => {
  it("POSTs title, body and labels to the BusinessIT repo", async () => {
    fetchMock.mockReturnValueOnce(ok(rawIssue(27, { title: "T", body: "B" })));
    const issue = await createBusinessItIssue("tok", { title: "T", body: "B", labels: ["ARC"] });
    expect(issue).toMatchObject({ number: 27, nodeId: "I_27", body: "B" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/Altronic-LLC/BusinessIT/issues");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ title: "T", body: "B", labels: ["ARC"] });
  });
});

describe("addIssueToBusinessItProject", () => {
  it("adds the issue to the Business IT Tasks board, then sets it to Backlog", async () => {
    fetchMock
      .mockReturnValueOnce(ok({ data: { addProjectV2ItemById: { item: { id: "PVTI_1" } } } }))
      .mockReturnValueOnce(ok({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } } } }));
    await addIssueToBusinessItProject("tok", "I_27");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/graphql");
    const add = JSON.parse(init.body as string);
    expect(add.query).toContain("addProjectV2ItemById");
    expect(add.variables).toEqual({ project: "PVT_kwDOBlqe584Bld8C", content: "I_27" });

    const status = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(status.query).toContain("updateProjectV2ItemFieldValue");
    expect(status.variables).toEqual({
      project: "PVT_kwDOBlqe584Bld8C",
      item: "PVTI_1",
      field: "PVTSSF_lADOBlqe584Bld8CzhkKt3I",
      option: "f75ad846", // Backlog
    });
  });

  it("treats a 200 carrying GraphQL errors as a failure, and sets no status", async () => {
    fetchMock.mockReturnValueOnce(ok({ errors: [{ message: "Resource not accessible" }] }));
    await expect(addIssueToBusinessItProject("tok", "I_27")).rejects.toBeInstanceOf(GitHubError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a refused status write", async () => {
    fetchMock
      .mockReturnValueOnce(ok({ data: { addProjectV2ItemById: { item: { id: "PVTI_1" } } } }))
      .mockReturnValueOnce(ok({ errors: [{ message: "Field not found" }] }));
    await expect(addIssueToBusinessItProject("tok", "I_27")).rejects.toThrow("Field not found");
  });
});

describe("listBusinessItBoardStatuses", () => {
  function item(number: number | undefined, status: string | null, repo = "BusinessIT", owner = "Altronic-LLC") {
    return {
      fieldValueByName: status ? { name: status } : null,
      content: number ? { number, repository: { name: repo, owner: { login: owner } } } : {},
    };
  }
  function page(nodes: unknown[], hasNextPage = false, endCursor: string | null = null) {
    return ok({ data: { node: { items: { pageInfo: { hasNextPage, endCursor }, nodes } } } });
  }

  it("maps each BusinessIT issue on the board to its Status, skipping other repos, drafts and no-status items", async () => {
    fetchMock.mockReturnValueOnce(
      page([
        item(12, "On Hold"),
        item(16, "In review"),
        item(3, "Backlog", "OtherRepo"),
        item(undefined, "Backlog"), // a draft item
        item(7, null),
      ]),
    );
    expect(await listBusinessItBoardStatuses("tok")).toEqual({ 12: "On Hold", 16: "In review" });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.variables).toEqual({ project: "PVT_kwDOBlqe584Bld8C", after: null });
  });

  it("follows the cursor across pages", async () => {
    fetchMock
      .mockReturnValueOnce(page([item(1, "Done")], true, "CUR1"))
      .mockReturnValueOnce(page([item(2, "Backlog")]));
    expect(await listBusinessItBoardStatuses("tok")).toEqual({ 1: "Done", 2: "Backlog" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).variables.after).toBe("CUR1");
  });
});

describe("linking: getBusinessItIssue / updateBusinessItIssueBody", () => {
  it("reads one issue fresh", async () => {
    fetchMock.mockReturnValueOnce(ok(rawIssue(5, { body: "old" })));
    expect((await getBusinessItIssue("tok", 5)).body).toBe("old");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.github.com/repos/Altronic-LLC/BusinessIT/issues/5");
  });

  it("PATCHes only the body", async () => {
    fetchMock.mockReturnValueOnce(ok(rawIssue(5, { body: "new" })));
    await updateBusinessItIssueBody("tok", 5, "new");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/Altronic-LLC/BusinessIT/issues/5");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ body: "new" });
  });
});
