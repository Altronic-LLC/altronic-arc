import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { GrayMarketRequestDetailView } from "./GrayMarketRequestDetailView";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

vi.mock("@/hooks/useAttachments", () => ({
  useAttachments: () => ({ data: [], isLoading: false, error: null }),
  useUploadAttachment: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
}));

async function renderRequest(id = 1) {
  const result = renderWithProviders(<GrayMarketRequestDetailView />, {
    route: `/supply-chain/gray-market-request/${id}`,
    routePattern: "/supply-chain/gray-market-request/:id",
  });
  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument(),
  );
  return result;
}

/** The card for one workflow section. */
function section(name: string): HTMLElement {
  return screen.getByRole("heading", { name, level: 2 }).closest("section") as HTMLElement;
}

/**
 * One field's block inside a section. The label sits in a header row next to
 * the Edit button, so the block is the header's parent — the input and the
 * rendered value are its siblings.
 */
function fieldBlock(sectionName: string, label: string): HTMLElement {
  const header = within(section(sectionName)).getByText(label).closest("div") as HTMLElement;
  return header.parentElement as HTMLElement;
}

describe("GrayMarketRequestDetailView", () => {
  it("leads with the log number and the part", async () => {
    await renderRequest();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("GMR_2026-003");
    // The part description repeats in its own field below, so read the
    // subtitle that sits with the heading.
    expect(heading.parentElement).toHaveTextContent(/TRANSISTOR, FET/);
  });

  it("lays the workflow out as one card per stage", async () => {
    await renderRequest();
    for (const name of ["Request", "Purchasing", "Engineering", "Inspection", "Production"]) {
      expect(screen.getByRole("heading", { name, level: 2 })).toBeInTheDocument();
    }
  });

  it("labels a column by what the list calls it, not its internal name", async () => {
    await renderRequest();
    // QANotes is labelled "Inspection Flag"; QtyofPartsforW.O. is "Qty of
    // Parts for BR". Showing the internal name would be gibberish to a user.
    expect(within(section("Inspection")).getByText("Inspection Flag")).toBeInTheDocument();
    expect(
      within(section("Engineering")).getByText("Qty of Parts for BR"),
    ).toBeInTheDocument();
  });

  it("edits a field in place", async () => {
    await renderRequest();
    const vendorRow = fieldBlock("Purchasing", "Vendor");

    await userEvent.click(within(vendorRow).getByRole("button", { name: "Edit" }));
    const input = within(vendorRow).getByRole("textbox", { name: "Vendor" });
    await userEvent.clear(input);
    await userEvent.type(input, "Digi-Key");
    await userEvent.click(within(vendorRow).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(within(section("Purchasing")).getByText("Digi-Key")).toBeInTheDocument(),
    );
  });

  it("renders Where Used as the rich text SharePoint stores, not as tags", async () => {
    await renderRequest();
    const request = section("Request");
    expect(within(request).getByText(/1000-7205-00/)).toBeInTheDocument();
    expect(within(request).queryByText(/<p>/)).toBeNull();
  });

  it("offers the comment thread", async () => {
    await renderRequest(2);
    expect(screen.getByRole("heading", { name: "Comments", level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/Supplier is one we've used before/)).toBeInTheDocument();
  });

  it("posts a comment", async () => {
    await renderRequest();
    const box = screen.getByPlaceholderText(/comment/i);
    await userEvent.type(box, "Chasing the vendor today.");
    await userEvent.click(screen.getByRole("button", { name: /post|send|comment/i }));

    await waitFor(() =>
      expect(screen.getByText("Chasing the vendor today.")).toBeInTheDocument(),
    );
  });

  it("offers an attachments card", async () => {
    await renderRequest();
    expect(screen.getByText("Attachments")).toBeInTheDocument();
  });

  it("has no delete control", async () => {
    await renderRequest();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("says so plainly when the request doesn't exist", async () => {
    renderWithProviders(<GrayMarketRequestDetailView />, {
      route: "/supply-chain/gray-market-request/999999",
      routePattern: "/supply-chain/gray-market-request/:id",
    });
    await waitFor(() =>
      expect(screen.getByText(/doesn't exist/i)).toBeInTheDocument(),
    );
  });
});
