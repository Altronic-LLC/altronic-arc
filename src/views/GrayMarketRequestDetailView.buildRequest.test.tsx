import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { BuildRequestSource } from "@/lib/buildRequestFromSource";

// =============================================================================
// A Gray Market request raising a build request (BusinessIT#69): the source it
// hands the form, and the write-back of the new request's number into the
// request's own "Build Request No" column — never over a number already there.
//
// The form is stubbed: it has its own tests, and what's pinned here is the
// page's half (which source, and what it writes when the request exists).
// =============================================================================

const seen = vi.hoisted(() => ({ source: null as BuildRequestSource | null }));

vi.mock("@/components/BuildRequestFormModal", () => ({
  BuildRequestFormModal: ({
    fromSource,
    onCreated,
  }: {
    fromSource: BuildRequestSource;
    onCreated?: (br: { id: number; brNo: string }) => void;
  }) => {
    seen.source = fromSource;
    return (
      <button type="button" onClick={() => onCreated?.({ id: 900, brNo: "BR_2026-1200" })}>
        stub create
      </button>
    );
  },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 }),
}));

vi.mock("@/hooks/useAttachments", () => ({
  useAttachments: () => ({ data: [], isLoading: false, error: null }),
  useUploadAttachment: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
  useCommentFileUpload: () => vi.fn(async () => ({ name: "f.png", webUrl: "u" })),
}));

import { GrayMarketRequestDetailView } from "./GrayMarketRequestDetailView";

async function raiseFrom(id: number) {
  renderWithProviders(<GrayMarketRequestDetailView />, {
    route: `/supply-chain/gray-market-request/${id}`,
    routePattern: "/supply-chain/gray-market-request/:id",
  });
  const card = await screen.findByTestId("source-build-requests");
  await userEvent.click(within(card).getByRole("button", { name: /Create Build Request/ }));
  await userEvent.click(await screen.findByRole("button", { name: "stub create" }));
}

function buildRequestNoField(): HTMLElement {
  const engineering = screen.getByRole("heading", { name: "Engineering", level: 2 }).closest("section")!;
  return within(engineering as HTMLElement).getByText("Build Request No").parentElement as HTMLElement;
}

describe("GrayMarketRequestDetailView — Create Build Request", () => {
  it("hands the form this request, with its part and quantity", async () => {
    await raiseFrom(1);
    expect(seen.source).toMatchObject({
      kind: "grayMarket",
      id: 1,
      label: "GMR_2026-003",
      part: { partNumber: "711232", qty: 5 },
    });
  });

  it("writes the new number into the request's Build Request No", async () => {
    await raiseFrom(3);
    await waitFor(() => expect(buildRequestNoField()).toHaveTextContent("BR_2026-1200"));
  });
});
