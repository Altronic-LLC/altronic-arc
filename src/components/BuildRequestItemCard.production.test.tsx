import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_BUILD_REQUEST_ITEMS } from "@/data/buildRequestMockData";

// The Part Status dropdown is replaced by production buttons beside Print part
// (Ray, 2026-10-05). The rules are pinned in lib/buildRequestPartProduction.test.ts;
// this pins the wiring: the dropdown is gone, the button writes Part Status,
// and a greyed button writes nothing and says why on screen.

const mutate = vi.hoisted(() => vi.fn());
const access = vi.hoisted(() => ({ isAdmin: false }));

vi.mock("@/hooks/useBuildRequests", () => {
  const noop = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    useUpdateBuildRequestItemFields: () => ({ mutate, isPending: false }),
    useAddBuildRequestItemComment: noop,
    useEditBuildRequestItemComment: noop,
    useDeleteBuildRequestItem: noop,
    useSetBuildRequestItemWatchers: noop,
    useBuildRequestPartStatusChoices: () => ({ data: [] }),
  };
});
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => ({ isAdmin: access.isAdmin, isResolving: false }),
  useIsAdmin: () => access.isAdmin,
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Eng Ineer", email: "eng.ineer@altronic-llc.com", lookupId: 5 }),
  useCurrentUserEmails: () => ["eng.ineer@altronic-llc.com"],
}));

import { BuildRequestItemCard } from "./BuildRequestItemCard";

const part = (id: number) => MOCK_BUILD_REQUEST_ITEMS.find((i) => i.id === id)!;
const renderPart = (id: number) =>
  renderWithProviders(<BuildRequestItemCard item={part(id)} mentionCandidates={[]} defaultExpanded />);

beforeEach(() => {
  mutate.mockClear();
  access.isAdmin = false;
});

describe("BuildRequestItemCard — production buttons", () => {
  it("has no Part Status dropdown", () => {
    renderPart(45);
    expect(screen.queryByText("Part Status")).not.toBeInTheDocument();
  });

  it("marks a ready part Ready for Production", () => {
    renderPart(45);
    fireEvent.click(screen.getByRole("button", { name: "Mark as Ready for Production" }));
    expect(mutate).toHaveBeenCalledWith({ id: 45, fields: { Part_x0020_Status: "Ready for Production" } });
  });

  it("greys the button for an unfinished checklist, says why, and writes nothing", () => {
    renderPart(62);
    const btn = screen.getByRole("button", { name: "Mark as Ready for Production" });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/checklist items? left/)).toBeInTheDocument();
    fireEvent.click(btn);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows the production approver In Production once the part is ready", () => {
    access.isAdmin = true;
    renderPart(60);
    fireEvent.click(screen.getByRole("button", { name: "Mark as In Production" }));
    expect(mutate).toHaveBeenCalledWith({ id: 60, fields: { Part_x0020_Status: "In Production" } });
  });
});
