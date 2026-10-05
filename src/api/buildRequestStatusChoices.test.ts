import { describe, it, expect, vi, beforeEach } from "vitest";
import { BUILD_REQUEST_PART_STATUSES, BUILD_REQUEST_STATUSES } from "@/types/task";
import { toBuildRequest, toBuildRequestItem } from "@/lib/buildRequestMapper";

// =============================================================================
// Build request Status AND Part Status follow SharePoint, not a hardcoded list
// (Ray, 2026-10-05: "part status choices is not live to what the choices are in
// sharepoint" — then "also added to the build request status").
//
// Two halves for each, both needed:
//   1. the PICKERS read the column's live choices off its definition;
//   2. the READ isn't clamped, so a status added in SharePoint renders as
//      itself rather than "No status" / "Submitted".
// Real mode — mock mode never asks SharePoint for anything.
// =============================================================================

const graphFetch = vi.hoisted(() => vi.fn());

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll: vi.fn(async () => []),
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  USE_MOCK: false,
  SP_SITE_ID: "site-1",
  SP_BUILD_REQUESTS_LIST_ID: "requests-list",
  SP_BUILD_REQUEST_ITEMS_LIST_ID: "items-list",
}));

import { listBuildRequestPartStatusChoices } from "./buildRequestItems";
import { listBuildRequestStatusChoices } from "./buildRequests";
import { withCurrentChoice } from "./columnChoices";

beforeEach(() => {
  graphFetch.mockReset();
});

const LIVE = ["Submitted", "In-process", "Awaiting Parts", "Complete"];

describe.each([
  ["Part Status", listBuildRequestPartStatusChoices, "items-list", "Part_x0020_Status", BUILD_REQUEST_PART_STATUSES],
  ["request Status", listBuildRequestStatusChoices, "requests-list", "BRStatus", BUILD_REQUEST_STATUSES],
] as const)("%s choices", (_label, read, listId, column, fallback) => {
  it("are the column's live choices, in SharePoint's order", async () => {
    graphFetch.mockResolvedValue({
      value: [
        { name: "Other", choice: { choices: ["x"] } },
        { name: column, choice: { choices: LIVE } },
      ],
    });
    expect(await read()).toEqual(LIVE);
    expect(graphFetch.mock.calls[0][0]).toBe(`/sites/site-1/lists/${listId}/columns?$select=name,choice`);
  });

  it("fall back to the built-in list when the column can't be read", async () => {
    graphFetch.mockRejectedValue(new Error("Graph 403"));
    expect(await read()).toEqual([...fallback]);
  });

  it("fall back when the column isn't in the answer", async () => {
    graphFetch.mockResolvedValue({ value: [{ name: "Other", choice: { choices: ["x"] } }] });
    expect(await read()).toEqual([...fallback]);
  });
});

const graphItem = (fields: Record<string, unknown>) =>
  ({
    id: "7",
    fields: { Title: "t", ...fields },
    createdDateTime: "2026-01-01T00:00:00Z",
    lastModifiedDateTime: "2026-01-01T00:00:00Z",
  }) as never;

describe("reading a status ARC's built-in list doesn't know", () => {
  it("a part keeps it", () => {
    expect(toBuildRequestItem(graphItem({ Part_x0020_Status: "In Build" })).partStatus).toBe("In Build");
    expect(toBuildRequestItem(graphItem({ Part_x0020_Status: "" })).partStatus).toBeNull();
  });

  it("a request keeps it, and a blank still reads as Submitted", () => {
    expect(toBuildRequest(graphItem({ BRStatus: "Awaiting Parts" })).status).toBe("Awaiting Parts");
    expect(toBuildRequest(graphItem({})).status).toBe("Submitted");
  });
});

describe("withCurrentChoice", () => {
  it("offers exactly the live choices when the current value is among them", () => {
    expect(withCurrentChoice(LIVE, "Complete")).toEqual(LIVE);
    expect(withCurrentChoice(LIVE, null)).toEqual(LIVE);
  });

  it("keeps a current value SharePoint no longer offers", () => {
    expect(withCurrentChoice(LIVE, "On Hold")).toEqual([...LIVE, "On Hold"]);
  });
});
