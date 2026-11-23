import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { SourceBuildRequestsCard } from "./SourceBuildRequestsCard";
import type { BuildRequestSource } from "@/lib/buildRequestFromSource";

// =============================================================================
// The "Build requests" card on an EIR / Gray Market request / FAIT
// (BusinessIT#68/#69/#65), in mock mode: the list is DERIVED from the
// requests' own link column (mock BR 7 names EIR 3, BR 16 names GMR 2).
// =============================================================================

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Ray White", email: "ray.white@altronic-llc.com", lookupId: 22 }),
}));

function source(kind: BuildRequestSource["kind"], id: number): BuildRequestSource {
  return { kind, id, label: `Rec ${id}`, title: "From the record", projectLookupIds: [], taskId: null, comments: [], part: null };
}

describe("SourceBuildRequestsCard", () => {
  it("lists the requests raised from this record, and only those", async () => {
    renderWithProviders(<SourceBuildRequestsCard kind="eir" id={3} makeSource={() => source("eir", 3)} />);
    expect(await screen.findByText("BR_2026-1018")).toBeInTheDocument();
    expect(screen.queryByText("BR_2026-1015")).not.toBeInTheDocument();
    expect(screen.getByText("BR_2026-1018").closest("a")).toHaveAttribute("href", "/build-request/7");
  });

  it("doesn't confuse a Gray Market id with an EIR id", async () => {
    renderWithProviders(<SourceBuildRequestsCard kind="grayMarket" id={2} makeSource={() => source("grayMarket", 2)} />);
    expect(await screen.findByText("BR_2026-1015")).toBeInTheDocument();
    expect(screen.queryByText("BR_2026-1018")).not.toBeInTheDocument();
  });

  it("says when nothing has been raised yet", async () => {
    renderWithProviders(<SourceBuildRequestsCard kind="fait" id={1} makeSource={() => source("fait", 1)} />);
    expect(await screen.findByText("None raised from or linked to this FAIT yet.")).toBeInTheDocument();
  });

  it("opens the form built from the record", async () => {
    const make = vi.fn(() => source("fait", 1));
    renderWithProviders(<SourceBuildRequestsCard kind="fait" id={1} makeSource={make} />);
    await userEvent.click(await screen.findByRole("button", { name: /Create Build Request/ }));
    expect(make).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "New Build Request from Rec 1" })).toBeInTheDocument();
  });
});

// Linking an EXISTING request (#65). Each case uses its own record and request:
// the mock store is module state, so a link made in one case is still there in
// the next.
async function pick(label: RegExp) {
  await userEvent.click(await screen.findByRole("button", { name: /Link existing/ }));
  await userEvent.click(screen.getByRole("button", { name: "Build request to link" }));
  await userEvent.click(await screen.findByRole("option", { name: label }));
  await userEvent.click(screen.getByRole("button", { name: "Link" }));
}

describe("SourceBuildRequestsCard — Link existing", () => {
  it("links a request that isn't linked anywhere, and tells the page", async () => {
    const onLinked = vi.fn();
    renderWithProviders(
      <SourceBuildRequestsCard kind="fait" id={2} makeSource={() => source("fait", 2)} onLinked={onLinked} />,
    );
    await pick(/^BR_2026-1009/);
    // No confirm: nothing is being moved.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /BR_2026-1009/ })).toHaveAttribute("href", "/build-request/2");
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(expect.objectContaining({ id: 2, faitReferenceLookupId: 2 })));
  });

  it("asks before MOVING a request off another record", async () => {
    renderWithProviders(<SourceBuildRequestsCard kind="eir" id={1} makeSource={() => source("eir", 1)} />);
    await pick(/^BR_2026-1018.*linked to EIR_2026-0044/);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("BR_2026-1018 is linked to EIR_2026-0044");
    await userEvent.click(within(dialog).getByRole("button", { name: "Move it here" }));
    expect(await screen.findByRole("link", { name: /BR_2026-1018/ })).toBeInTheDocument();
  });

  it("cancelling the move changes nothing", async () => {
    renderWithProviders(<SourceBuildRequestsCard kind="grayMarket" id={1} makeSource={() => source("grayMarket", 1)} />);
    await pick(/^BR_2026-1015.*linked to Gray Market request #2/);
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("None raised from or linked to this Gray Market request yet.")).toBeInTheDocument();
  });

  it("unlinks after a confirm", async () => {
    renderWithProviders(<SourceBuildRequestsCard kind="grayMarket" id={2} makeSource={() => source("grayMarket", 2)} />);
    await userEvent.click(await screen.findByRole("button", { name: "Unlink BR_2026-1015" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Unlink" }));
    expect(await screen.findByText("None raised from or linked to this Gray Market request yet.")).toBeInTheDocument();
  });
});
