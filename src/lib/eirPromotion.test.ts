import { describe, it, expect } from "vitest";
import type { Comment, Eir } from "@/types/task";
import {
  appendEngineeringResponse,
  buildPromotedCommunication,
  escapeHtml,
} from "./eirPromotion";
import { parseCommunication } from "./communicationParser";

function comment(over: Partial<Comment>): Comment {
  return {
    timestamp: new Date("2026-05-11T09:15:00"),
    authorName: "Sarah Shaffer",
    authorEmail: "sarah@x.com",
    bodyHtml: "<p>Body</p>",
    attachments: [],
    ...over,
  };
}

function eir(over: Partial<Eir>): Eir {
  return {
    id: 1,
    eirNo: "EIR_2026-0042",
    title: "Replacement coil",
    description: "desc",
    requestType: "EIR",
    status: "Under Review",
    resolution: "Pending",
    requestedPriority: "High",
    reporter: null,
    assignedEngineers: [],
    watchers: [],
    parentProjects: [],
    taskReference: "",
    engineeringResponse: "",
    whereUsed: "",
    eau: "",
    currentStock: "",
    mfg: "",
    mfgPartNumber: "",
    currentPrice: "",
    altronicPartNumber: "",
    requestedCompletionDate: null,
    ltbDate: null,
    priorityDate: null,
    priorityNumber: null,
    priorityCount: null,
    technicalPriority: null,
    riskPart: null,
    riskPartLevel: null,
    eirMeetingRelevant: null,
    buyerCode: "",
    taskPromotedFlag: false,
    createdAt: new Date("2026-05-10"),
    modifiedAt: new Date("2026-05-10"),
    author: null,
    comments: [],
    hasAttachments: false,
    ...over,
  };
}

const PROMOTER = { displayName: "Ray White", email: "ray@x.com" };
const NOW = new Date("2026-07-08T10:00:00");

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`<a & "b" 'c'>`)).toBe("&lt;a &amp; &quot;b&quot; &#39;c&#39;&gt;");
  });
});

describe("buildPromotedCommunication", () => {
  it("emits a header note plus every EIR comment, tagged, newest-first when parsed", () => {
    const e = eir({
      comments: [
        comment({ timestamp: new Date("2026-05-13T14:40:00"), bodyHtml: "<p>Second</p>" }),
        comment({ timestamp: new Date("2026-05-11T09:15:00"), bodyHtml: "<p>First</p>" }),
      ],
    });
    const raw = buildPromotedCommunication({ eir: e, promotedBy: PROMOTER, now: NOW });
    const parsed = parseCommunication(raw);

    // Header (now) + 2 carried = 3 records, header newest.
    expect(parsed).toHaveLength(3);
    expect(parsed[0].timestamp.getTime()).toBe(NOW.getTime());
    expect(parsed[0].authorName).toBe("Ray White");
    expect(parsed[0].bodyHtml).toContain("Promoted from EIR");
    expect(parsed[0].bodyHtml).toContain("EIR_2026-0042");

    // Carried comments keep their author + get the origin tag.
    const carried = parsed.filter((c) => c.bodyHtml.includes("carried over from EIR"));
    expect(carried).toHaveLength(2);
    expect(carried.every((c) => c.authorName === "Sarah Shaffer")).toBe(true);
  });

  it("still writes the header when the EIR has no comments", () => {
    const raw = buildPromotedCommunication({ eir: eir({ comments: [] }), promotedBy: PROMOTER, now: NOW });
    const parsed = parseCommunication(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].bodyHtml).toContain("Promoted from EIR");
    expect(parsed[0].bodyHtml).not.toContain("carried over");
  });

  it("falls back to EIR #id when eirNo is blank", () => {
    const raw = buildPromotedCommunication({
      eir: eir({ eirNo: "", id: 99, comments: [] }),
      promotedBy: PROMOTER,
      now: NOW,
    });
    expect(parseCommunication(raw)[0].bodyHtml).toContain("EIR #99");
  });
});

describe("appendEngineeringResponse", () => {
  it("returns only the dated block when there is no existing response", () => {
    const out = appendEngineeringResponse("", {
      taskLabel: "T5-0017-Coil",
      resolutionText: "Swapped to C-450-221.",
      now: NOW,
    });
    expect(out).toBe("— Resolved via task T5-0017-Coil on 2026-07-08:\nSwapped to C-450-221.");
  });

  it("appends beneath existing text with a blank line", () => {
    const out = appendEngineeringResponse("Prior note.", {
      taskLabel: "T5",
      resolutionText: "Done.",
      now: NOW,
    });
    expect(out).toBe("Prior note.\n\n— Resolved via task T5 on 2026-07-08:\nDone.");
  });

  it("tolerates null/undefined existing values", () => {
    expect(appendEngineeringResponse(null, { taskLabel: "T5", resolutionText: "x", now: NOW })).toContain(
      "— Resolved via task T5",
    );
  });
});
