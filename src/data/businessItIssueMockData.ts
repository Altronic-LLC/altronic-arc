import type { GitHubIssue } from "@/lib/featureRequestIssues";

// Sample BusinessIT issues for mock mode. One is linked to mock feature request
// #2 by its marker; one shares mock request #1's title without a link (the
// "possible match" case — an issue raised by hand before ARC could do it).
export const MOCK_BUSINESS_IT_ISSUES: GitHubIssue[] = [
  {
    number: 31,
    nodeId: "I_mock_31",
    title: "Bulk status change on the EIR board",
    state: "open",
    htmlUrl: "https://github.com/Altronic-LLC/BusinessIT/issues/31",
    body: "**From ARC Feature Request #2:** …\n\n<!-- arc-feature-request:2 -->",
  },
  {
    number: 12,
    nodeId: "I_mock_12",
    title: "ARC: Dark mode for the print views",
    state: "open",
    htmlUrl: "https://github.com/Altronic-LLC/BusinessIT/issues/12",
    body: "Raised by hand in the standup.",
  },
  {
    number: 9,
    nodeId: "I_mock_9",
    title: "Clean up component data",
    state: "closed",
    htmlUrl: "https://github.com/Altronic-LLC/BusinessIT/issues/9",
    body: "",
  },
];

/** Board Status by issue number. #9 is closed and was never put on the board. */
export const MOCK_BUSINESS_IT_BOARD_STATUSES: Record<number, string> = {
  31: "In progress",
  12: "Backlog",
};

export const MOCK_BUSINESS_IT_LABELS = [
  "ARC",
  "enhancement",
  "bug",
  "dept: Engineering",
  "dept: Operations",
  "dept: Cross-department",
  "dept: Supply Chain",
  "priority: high",
  "priority: medium",
  "priority: low",
];
