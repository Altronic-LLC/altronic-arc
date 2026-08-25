import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_PROJECTS } from "@/data/mockData";
import type { Eir } from "@/types/task";

// =============================================================================
// At Risk Parts is a REGISTER, not a queue: every active at-risk part, whatever
// its EIR's status (Ray, 2026-08-25).
//
// The predicates are unit-tested in eirFilters.test.ts, but a reviewer showed
// that reverting the WIRING in this view left the whole suite green — the lib
// knowing the rule is worth nothing if the screen doesn't call it. So this
// drives the actual view, at the actual URL a bookmark can carry:
//
//     /eirs?view=at-risk&status=ALL_OPEN
//
// which before the change hid every closed at-risk part.
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@hoerbiger.com",
    lookupId: 122,
  }),
  useCurrentUserEmails: () => ["ray.white@hoerbiger.com"],
}));

import { EirsView } from "./EirsView";

const EIRS_KEY = ["eirs", "list"] as const;
const PROJECTS_KEY = ["projects"] as const;

function eir(over: Partial<Eir>): Eir {
  return {
    id: 1,
    eirNo: "EIR_2026-0001",
    title: "Untitled",
    description: "",
    requestType: "EIR",
    status: "Under Review",
    resolution: null,
    priority: null,
    reporter: null,
    assignedEngineers: [],
    watchers: [],
    parentProjects: [],
    engineeringResponse: "",
    whereUsed: "",
    eau: "",
    currentStock: "",
    mfg: "",
    mfgPartNo: "",
    altronicPartNumber: "",
    currentPrice: "",
    requestedCompletion: null,
    priorityScore: null,
    priorityDate: null,
    priorityCount: null,
    riskPart: null,
    riskPartLevel: null,
    technicalPriority: null,
    ltbDate: null,
    taskReference: "",
    taskPromoted: false,
    meetingRelevant: false,
    buyerCode: "",
    comments: [],
    hasAttachments: false,
    createdAt: new Date("2026-08-01T12:00:00Z"),
    modifiedAt: new Date("2026-08-01T12:00:00Z"),
    ...over,
  } as Eir;
}

const CLOSED_AT_RISK = eir({
  id: 101,
  eirNo: "EIR_2026-0101",
  title: "Closed at-risk part",
  status: "Closed",
  riskPart: "Active",
});
const OPEN_AT_RISK = eir({
  id: 102,
  eirNo: "EIR_2026-0102",
  title: "Open at-risk part",
  status: "Under Review",
  riskPart: "Active",
});
const CLOSED_NOT_AT_RISK = eir({
  id: 103,
  eirNo: "EIR_2026-0103",
  title: "Closed ordinary EIR",
  status: "Closed",
  riskPart: null,
});

function render(route: string) {
  return renderWithProviders(<EirsView />, {
    route,
    seedQueryData: [
      { key: EIRS_KEY, data: [CLOSED_AT_RISK, OPEN_AT_RISK, CLOSED_NOT_AT_RISK] },
      { key: PROJECTS_KEY, data: MOCK_PROJECTS },
    ],
  });
}

describe("At Risk Parts ignores the status pill", () => {
  // THE REGRESSION. `status=ALL_OPEN` in the URL used to hide the closed one.
  it("shows a closed at-risk part even with an open-only status in the URL", async () => {
    render("/eirs?view=at-risk&status=ALL_OPEN");
    await waitFor(() => expect(screen.getByText(/Closed at-risk part/)).toBeInTheDocument());
    expect(screen.getByText(/Open at-risk part/)).toBeInTheDocument();
  });

  it("still excludes EIRs that aren't at risk", async () => {
    render("/eirs?view=at-risk&status=ALL_OPEN");
    await waitFor(() => expect(screen.getByText(/Closed at-risk part/)).toBeInTheDocument());
    expect(screen.queryByText(/Closed ordinary EIR/)).not.toBeInTheDocument();
  });

  it("ignores a specific status too, not just the Open pill", async () => {
    render("/eirs?view=at-risk&status=Under%20Review");
    await waitFor(() => expect(screen.getByText(/Closed at-risk part/)).toBeInTheDocument());
  });

  // The pill must not claim to be filtering when it isn't.
  it("shows no pill as selected on that view", async () => {
    render("/eirs?view=at-risk&status=Closed");
    // Scoped by the hint, because an EIR row's title also starts with "Closed".
    const closedPill = await waitFor(() => {
      const pill = screen
        .getAllByRole("button", { name: /^Closed/ })
        .find((b) => b.getAttribute("title")?.includes("not a filter"));
      if (!pill) throw new Error("no inert Closed pill");
      return pill;
    });
    expect(closedPill).toHaveAttribute("aria-disabled", "true");
    // aria-disabled, NOT disabled: a `title` on a disabled control never shows
    // in Chrome, and disabled would drop the counts out of the tab order.
    expect(closedPill).not.toBeDisabled();
    expect(closedPill).toHaveAttribute("title", expect.stringContaining("not a filter"));
  });

  it("still filters by status on the other views", async () => {
    render("/eirs?status=ALL_OPEN");
    await waitFor(() => expect(screen.getByText(/Open at-risk part/)).toBeInTheDocument());
    expect(screen.queryByText(/Closed at-risk part/)).not.toBeInTheDocument();
  });
});

describe("switching into At Risk Parts", () => {
  // A parked status was invisible on that view (the pills deliberately don't
  // render as active there) and silently re-narrowed the list on the way out.
  it("clears a status the user had set, rather than parking it invisibly", async () => {
    const user = userEvent.setup();
    render("/eirs?status=ALL_OPEN");
    await waitFor(() => expect(screen.getByText(/Open at-risk part/)).toBeInTheDocument());

    await user.click(await screen.findByRole("button", { name: /At Risk Parts/i }));
    await waitFor(() => expect(screen.getByText(/Closed at-risk part/)).toBeInTheDocument());

    // Back to All: the list must NOT narrow again, because the pill was cleared.
    await user.click(await screen.findByRole("button", { name: /^All/i }));
    await waitFor(() => expect(screen.getByText(/Closed ordinary EIR/)).toBeInTheDocument());
  });
});
