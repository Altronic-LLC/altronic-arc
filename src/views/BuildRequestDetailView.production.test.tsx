import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_BUILD_REQUESTS, MOCK_BUILD_REQUEST_ITEMS } from "@/data/buildRequestMockData";
import type { BuildRequest, BuildRequestItem } from "@/types/task";

// The production hand-off button on the build request page. The RULES are
// pinned in lib/buildRequestProduction.test.ts; this file pins the wiring:
// label per status, the on-screen reason, hidden when done, greyed for
// somebody who may not press it, and that a press writes the right status.

const ENGINEER_EMAIL = "nick.sirianni@altronic-llc.com";

const state = vi.hoisted(() => ({
  br: null as unknown as BuildRequest,
  items: [] as BuildRequestItem[],
  myEmails: [] as string[],
  isAdmin: false,
  adminResolving: false,
  mutate: vi.fn(),
}));

vi.mock("@/hooks/useBuildRequests", () => {
  const noop = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    useBuildRequest: () => ({ data: state.br, isLoading: false }),
    useBuildRequests: () => ({ data: [state.br] }),
    useBuildRequestItems: () => ({ data: state.items }),
    useUpdateBuildRequestFields: () => ({ mutate: state.mutate, isPending: false }),
    useAddBuildRequestComment: noop,
    useEditBuildRequestComment: noop,
    useSetBuildRequestEngineer: noop,
    useSetBuildRequestProjects: noop,
    useSetBuildRequestRequestor: noop,
    useSetBuildRequestWatchers: noop,
  };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Signed In", email: state.myEmails[0] ?? "", lookupId: 1 }),
  useCurrentUserEmails: () => state.myEmails,
}));

vi.mock("@/hooks/useIsAdmin", () => ({
  useIsAdmin: () => state.isAdmin,
  useAdminAccess: () => ({ isAdmin: state.isAdmin, isResolving: state.adminResolving }),
}));

// The part cards and the attachments card are covered elsewhere and pull in
// their own hooks; stub them so this file tests only the hand-off.
vi.mock("@/components/BuildRequestItemCard", () => ({
  BuildRequestItemCard: ({ item }: { item: BuildRequestItem }) => <div>part {item.id}</div>,
}));
vi.mock("@/components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));

import { BuildRequestDetailView } from "./BuildRequestDetailView";

function part(id: number, partStatus: BuildRequestItem["partStatus"]): BuildRequestItem {
  return { ...MOCK_BUILD_REQUEST_ITEMS[0], id, buildRequestLookupId: 2, partStatus };
}

function setup(status: BuildRequest["status"], partStatuses: BuildRequestItem["partStatus"][]) {
  state.br = {
    ...MOCK_BUILD_REQUESTS[0],
    id: 2,
    status,
    engineerAssigned: { displayName: "Nick Sirianni", email: ENGINEER_EMAIL, lookupId: 9 },
  };
  state.items = partStatuses.map((s, i) => part(100 + i, s));
}

function renderPage() {
  return renderWithProviders(<BuildRequestDetailView />, {
    route: "/build-requests/2",
    routePattern: "/build-requests/:id",
  });
}

function handoffButton(name: RegExp) {
  return screen.getByRole("button", { name });
}

describe("BuildRequestDetailView — production hand-off button", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state.mutate.mockReset();
    state.myEmails = [ENGINEER_EMAIL];
    state.isAdmin = false;
    state.adminResolving = false;
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => confirmSpy.mockRestore());

  it("offers 'Ready for Production' while the request is in process", () => {
    setup("In-process", ["Ready for Production", "Production Complete"]);
    renderPage();
    const btn = handoffButton(/^ready for production$/i);
    expect(btn).toHaveAttribute("aria-disabled", "false");
    expect(btn).not.toBeDisabled();
  });

  it("offers 'Build Request Production Complete' once the request is Ready for Production", () => {
    setup("Ready for Production", ["Production Complete", "Production Complete"]);
    renderPage();
    expect(handoffButton(/build request production complete/i)).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("is greyed with an on-screen count when parts aren't ready, and a press writes nothing", () => {
    setup("In-process", ["Ready for Production", "Information Needed", null]);
    renderPage();
    const btn = handoffButton(/^ready for production$/i);
    expect(btn).toHaveAttribute("aria-disabled", "true");
    // aria-disabled, not disabled — the reason must stay reachable.
    expect(btn).not.toBeDisabled();
    expect(screen.getByTestId("production-handoff-reason")).toHaveTextContent(
      /2 parts still need to reach Ready for Production/,
    );
    fireEvent.click(btn);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("at Ready for Production, a part still only Ready for Production blocks the second step", () => {
    setup("Ready for Production", ["Production Complete", "Ready for Production"]);
    renderPage();
    expect(handoffButton(/build request production complete/i)).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByTestId("production-handoff-reason")).toHaveTextContent(
      /1 part still needs to reach Production Complete/,
    );
  });

  it("is greyed for a request with no parts at all", () => {
    setup("In-process", []);
    renderPage();
    expect(handoffButton(/^ready for production$/i)).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("production-handoff-reason")).toHaveTextContent(/at least one part/i);
  });

  it("shows no button at Production Complete, only a read-only note", () => {
    setup("Production Complete", ["Production Complete"]);
    renderPage();
    expect(screen.queryByRole("button", { name: /ready for production|production complete/i })).toBeNull();
    expect(screen.getByTestId("production-handoff-note")).toHaveTextContent(/waiting on review/i);
  });

  it("shows no button and no note at Complete", () => {
    setup("Complete", ["Production Complete"]);
    renderPage();
    expect(screen.queryByRole("button", { name: /ready for production|production complete/i })).toBeNull();
    expect(screen.queryByTestId("production-handoff-note")).toBeNull();
  });

  it("is greyed for somebody who is neither the engineer nor an admin, even with every part ready", () => {
    setup("In-process", ["Ready for Production"]);
    state.myEmails = ["someone.else@altronic-llc.com"];
    renderPage();
    const btn = handoffButton(/^ready for production$/i);
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("production-handoff-reason")).toHaveTextContent(
      /only the assigned engineer or an arc admin/i,
    );
    fireEvent.click(btn);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  // While the Admins list loads, a non-engineer may yet turn out to be an
  // admin — hold the button with a neutral reason, not a denial.
  it("says it's checking access, not 'only the engineer', while the Admins list loads", () => {
    setup("In-process", ["Ready for Production"]);
    state.myEmails = ["someone.else@altronic-llc.com"];
    state.adminResolving = true;
    renderPage();
    const btn = handoffButton(/^ready for production$/i);
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("production-handoff-reason")).toHaveTextContent(/checking your access/i);
    state.adminResolving = false;
  });

  it("lets an admin who isn't the engineer press it", () => {
    setup("In-process", ["Ready for Production"]);
    state.myEmails = ["someone.else@altronic-llc.com"];
    state.isAdmin = true;
    renderPage();
    fireEvent.click(handoffButton(/^ready for production$/i));
    expect(state.mutate).toHaveBeenCalledWith({ id: 2, fields: { BRStatus: "Ready for Production" } });
  });

  it("pressing 'Ready for Production' confirms who is emailed, then writes BRStatus", () => {
    setup("In-process", ["Ready for Production", "Production Complete"]);
    renderPage();
    fireEvent.click(handoffButton(/^ready for production$/i));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const msg = String(confirmSpy.mock.calls[0][0]);
    expect(msg).toMatch(/Ready for Production/);
    expect(msg).toMatch(/Amanda Hoagland/);
    expect(msg).toMatch(/Sheila Horn/);
    expect(state.mutate).toHaveBeenCalledWith({ id: 2, fields: { BRStatus: "Ready for Production" } });
  });

  it("pressing 'Build Request Production Complete' writes Production Complete", () => {
    setup("Ready for Production", ["Production Complete"]);
    renderPage();
    fireEvent.click(handoffButton(/build request production complete/i));
    expect(String(confirmSpy.mock.calls[0][0])).toMatch(/review/i);
    expect(state.mutate).toHaveBeenCalledWith({ id: 2, fields: { BRStatus: "Production Complete" } });
  });

  it("cancelling the confirm writes nothing", () => {
    setup("In-process", ["Ready for Production"]);
    confirmSpy.mockReturnValue(false);
    renderPage();
    fireEvent.click(handoffButton(/^ready for production$/i));
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("does not replace the sidebar status picker", () => {
    setup("In-process", ["Ready for Production"]);
    renderPage();
    const combo = screen.getAllByRole("combobox")[0];
    expect(within(combo).getByRole("option", { name: "Ready for Production" })).toBeInTheDocument();
  });
});
