import { describe, expect, it } from "vitest";
import type { FeatureRequest } from "@/types/task";
import {
  buildIssueFromFeatureRequest,
  canManageFeatureRequestIssues,
  featureRequestIdsInIssue,
  featureRequestMarker,
  findLinkedIssue,
  featureRequestProductionUrl,
  findSimilarIssues,
  issueMatchScore,
  issueNamesRequester,
  issueTitleKey,
  labelsForFeatureRequest,
  linkedIssueFooter,
  significantWords,
  type GitHubIssue,
} from "./featureRequestIssues";

function request(over: Partial<FeatureRequest> = {}): FeatureRequest {
  return {
    id: 12,
    title: "Dark mode for print",
    description: "Line one\nLine two",
    department: "Engineering",
    requestedBy: { displayName: "Jerrod Waldron" },
    priority: "Medium",
    status: "Pending Review",
    targetVersion: "",
    comments: [],
    watchers: [],
    hasAttachments: false,
    createdAt: new Date("2026-08-01"),
    modifiedAt: new Date("2026-08-01"),
    author: null,
    ...over,
  };
}

function issue(over: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 1,
    nodeId: "I_1",
    title: "Something",
    state: "open",
    htmlUrl: "https://github.com/x/y/issues/1",
    body: "",
    ...over,
  };
}

describe("canManageFeatureRequestIssues", () => {
  it("lets Ray and Tim in, by any address their account carries", () => {
    expect(canManageFeatureRequestIssues(["ray.white@altronic-llc.com"])).toBe(true);
    expect(canManageFeatureRequestIssues(["Tim.Webster@altronic-llc.com"])).toBe(true);
    expect(canManageFeatureRequestIssues(["tw@upn.example", "tim.webster@altronic-llc.com"])).toBe(true);
  });

  it("keeps everybody else out, including nobody-signed-in", () => {
    expect(canManageFeatureRequestIssues(["sheila.horn@altronic-llc.com"])).toBe(false);
    expect(canManageFeatureRequestIssues([])).toBe(false);
  });
});

describe("featureRequestIdsInIssue", () => {
  it("reads the hidden marker ARC writes", () => {
    expect(featureRequestIdsInIssue(`text\n${featureRequestMarker(12)}`)).toEqual([12]);
  });

  it("reads an ARC link pasted into a hand-made issue", () => {
    expect(
      featureRequestIdsInIssue("See https://altronic-llc.github.io/altronic-arc/feature-request/7 please"),
    ).toEqual([7]);
  });

  it("never reads request 12 out of a link to request 123", () => {
    expect(featureRequestIdsInIssue("/feature-request/123")).toEqual([123]);
    expect(featureRequestIdsInIssue("/feature-request/123")).not.toContain(12);
  });

  it("reports each id once, however often it appears", () => {
    expect(featureRequestIdsInIssue(`/feature-request/4 ${featureRequestMarker(4)}`)).toEqual([4]);
  });

  it("finds nothing in an unrelated body", () => {
    expect(featureRequestIdsInIssue("Work with Alex on notifications.")).toEqual([]);
  });
});

describe("findLinkedIssue", () => {
  it("finds the issue carrying this request's marker", () => {
    const linked = issue({ number: 31, body: featureRequestMarker(12) });
    expect(findLinkedIssue(12, [issue({ number: 2 }), linked])).toBe(linked);
  });

  it("is null when nothing points at the request", () => {
    expect(findLinkedIssue(12, [issue({ body: featureRequestMarker(13) })])).toBeNull();
  });

  it("prefers an open issue over a newer closed one", () => {
    const open = issue({ number: 5, state: "open", body: featureRequestMarker(12) });
    const closed = issue({ number: 9, state: "closed", body: featureRequestMarker(12) });
    expect(findLinkedIssue(12, [closed, open])).toBe(open);
  });

  it("prefers the newest when both are open", () => {
    const older = issue({ number: 5, body: featureRequestMarker(12) });
    const newer = issue({ number: 9, body: featureRequestMarker(12) });
    expect(findLinkedIssue(12, [older, newer])).toBe(newer);
  });
});

// Shaped like the hand-made BusinessIT issues #5, #6 and #13 (2026-10-05):
// reworded "ARC: …" titles, a "**Requested by:**" line, no link back.
const ISSUE_5 = issue({
  number: 5,
  title: "ARC: Add due date to the task-assigned email",
  body:
    "**Requested by:** David Markovitch  \n**Department:** Engineering  \n**Priority:** Medium\n\n" +
    "Include the task's due date in the email sent when someone is assigned a task, as a quick reference to the urgency of the request.",
});
const ISSUE_6 = issue({
  number: 6,
  title: "ARC: Add task description to the task-assigned email",
  body:
    "**Requested by:** David Markovitch  \n**Department:** Engineering  \n**Priority:** Low\n\n" +
    "Include the task description in the email sent when someone is initially assigned a task, so the recipient has context without opening the link.",
});
const ISSUE_13 = issue({
  number: 13,
  title: "ARC: Due-date reminder emails",
  body:
    "**Requested by:** Thomas Terhune  \n**Department:** Cross-department  \n**Priority:** Low\n\n" +
    "Send reminders for tasks/EIRs you're assigned to when their due date is getting close.",
});
const RAY_ISSUE = issue({ number: 22, title: "HR in ARC", body: "Work with HR to create a central repository." });

describe("findSimilarIssues", () => {
  it("matches a hand-made 'ARC: …' title, ignoring case and punctuation", () => {
    const similar = issue({ number: 15, title: "ARC: Dark mode for print!" });
    expect(findSimilarIssues(request(), [similar, issue({ title: "Other" })])).toEqual([similar]);
  });

  it("finds a REWORDED issue by its title words and requester, best match first", () => {
    const req = request({
      title: "Due date in task assigned email",
      description: "Please put the due date in the email you get when assigned a task",
      requestedBy: { displayName: "David Markovitch" },
    });
    const found = findSimilarIssues(req, [ISSUE_13, ISSUE_6, ISSUE_5, RAY_ISSUE]);
    expect(found[0]).toBe(ISSUE_5);
    expect(found).not.toContain(RAY_ISSUE);
  });

  it("finds one by its description when the title says something else entirely", () => {
    const req = request({
      title: "Reminders",
      description: "Send reminders for tasks and EIRs assigned to you when the due date is getting close",
      requestedBy: { displayName: "Somebody Else" },
    });
    expect(findSimilarIssues(req, [ISSUE_5, ISSUE_13])[0]).toBe(ISSUE_13);
  });

  it("names nothing for an unrelated request", () => {
    const req = request({
      title: "Dark mode for print",
      description: "The print views ignore the dark theme setting",
      requestedBy: { displayName: "Jerrod Waldron" },
    });
    expect(findSimilarIssues(req, [ISSUE_5, ISSUE_6, ISSUE_13, RAY_ISSUE])).toEqual([]);
  });

  it("never offers an issue already linked to ANY request", () => {
    const linkedElsewhere = issue({ title: "Dark mode for print", body: featureRequestMarker(99) });
    const linkedHere = issue({ title: "Dark mode for print", body: featureRequestMarker(12) });
    expect(findSimilarIssues(request(), [linkedElsewhere, linkedHere])).toEqual([]);
  });

  it("offers at most three", () => {
    const many = Array.from({ length: 5 }, (_, i) => issue({ number: i + 1, title: "Dark mode for print" }));
    expect(findSimilarIssues(request(), many)).toHaveLength(3);
  });

  it("matches nothing for an empty title and description", () => {
    expect(
      findSimilarIssues(request({ title: "  ", description: "", requestedBy: null }), [issue({ title: "" })]),
    ).toEqual([]);
  });

  it("issueTitleKey strips the ARC prefix", () => {
    expect(issueTitleKey("ARC – Saved filters")).toBe("saved filters");
  });
});

describe("issueNamesRequester / significantWords", () => {
  it("reads the Requested by line in either name order", () => {
    expect(issueNamesRequester(ISSUE_13.body, "Terhune, Thomas")).toBe(true);
    expect(issueNamesRequester(ISSUE_13.body, "Thomas Terhune")).toBe(true);
    expect(issueNamesRequester(ISSUE_13.body, "Thomas")).toBe(false);
    expect(issueNamesRequester("no line here", "Thomas Terhune")).toBe(false);
  });

  it("drops stop words and short words, folds plurals, ignores tags", () => {
    expect([...significantWords("ARC: Add the filters <img src=x> to EIRs")]).toEqual(["filter", "eir"]);
  });

  it("scores an exact title as a certain match", () => {
    expect(issueMatchScore(request(), issue({ title: "ARC: Dark mode for print" }))).toBe(1);
  });
});

describe("linking an existing issue", () => {
  it("the footer carries the marker and a link, and the scan then finds it", () => {
    const footer = linkedIssueFooter(12, featureRequestProductionUrl(12, "https://arc.example/app/"));
    expect(footer).toContain("[ARC Feature Request #12](https://arc.example/app/feature-request/12)");
    const linked = { ...ISSUE_5, body: ISSUE_5.body + footer };
    expect(findLinkedIssue(12, [linked])).toEqual(linked);
  });
});

describe("labelsForFeatureRequest", () => {
  const repo = ["ARC", "enhancement", "dept: Engineering", "priority: medium", "priority: low"];

  it("asks for ARC, enhancement, the department and the priority, in the repo's spelling", () => {
    expect(labelsForFeatureRequest(request(), repo)).toEqual([
      "ARC",
      "enhancement",
      "dept: Engineering",
      "priority: medium",
    ]);
  });

  it("drops a label the repo doesn't have rather than inventing it", () => {
    expect(labelsForFeatureRequest(request({ department: "Panels" }), repo)).not.toContain(
      "dept: Panels",
    );
  });

  it("matches case-insensitively", () => {
    expect(labelsForFeatureRequest(request(), ["arc"])).toEqual(["arc"]);
  });
});

describe("buildIssueFromFeatureRequest", () => {
  const url = "https://arc.example/feature-request/12";

  it("titles the issue 'ARC: <request>' and links back to it", () => {
    const draft = buildIssueFromFeatureRequest(request(), url, ["ARC"]);
    expect(draft.title).toBe("ARC: Dark mode for print");
    expect(draft.body).toContain(`ARC Feature Request #12:** ${url}`);
    expect(draft.labels).toEqual(["ARC"]);
  });

  it("carries the marker, so the scan recognises its own issue", () => {
    const draft = buildIssueFromFeatureRequest(request(), url, []);
    expect(featureRequestIdsInIssue(draft.body)).toEqual([12]);
  });

  it("keeps the description's line breaks and lists the request's details", () => {
    const { body } = buildIssueFromFeatureRequest(request(), url, []);
    expect(body).toContain("Line one\nLine two");
    expect(body).toContain("| Department | Engineering |");
    expect(body).toContain("| Requested by | Jerrod Waldron |");
    expect(body).toContain("| Status in ARC | Pending Review |");
  });

  it("escapes a pipe so a value can't break the table, and dashes a blank", () => {
    const { body } = buildIssueFromFeatureRequest(
      request({ requestedBy: { displayName: "A | B" }, priority: null }),
      url,
      [],
    );
    expect(body).toContain("| Requested by | A \\| B |");
    expect(body).toContain("| Priority | — |");
  });

  it("never doubles the prefix", () => {
    expect(buildIssueFromFeatureRequest(request({ title: "ARC: Saved filters" }), url, []).title).toBe(
      "ARC: Saved filters",
    );
  });

  it("falls back to a numbered title and says when there's no description", () => {
    const draft = buildIssueFromFeatureRequest(request({ title: "", description: " " }), url, []);
    expect(draft.title).toBe("ARC: Feature Request #12");
    expect(draft.body).toContain("_No description was given._");
  });
});
