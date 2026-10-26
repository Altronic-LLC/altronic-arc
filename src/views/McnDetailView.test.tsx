import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { __resetMcnMockStore, getMcn } from "@/api/mcns";
import { __resetMcnRoleMockStores } from "@/api/mcnRoles";

const who = vi.hoisted(() => ({ email: "demo.user@altronic-llc.com" }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: who.email }),
  useCurrentUserEmails: () => [who.email],
}));

vi.mock("@/hooks/useAttachments", () => ({
  useAttachments: () => ({ data: [], isLoading: false, error: null }),
  useUploadAttachment: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
  useCommentFileUpload: () => vi.fn(async () => ({ name: "f.png", webUrl: "u" })),
}));

import { McnDetailView } from "./McnDetailView";

beforeEach(() => {
  __resetMcnMockStore();
  __resetMcnRoleMockStores();
  who.email = "demo.user@altronic-llc.com";
});

async function open(id: number) {
  renderWithProviders(<McnDetailView />, { route: `/operations/mcns/${id}`, routePattern: "/operations/mcns/:id" });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
}

describe("a draft", () => {
  it("can't be submitted until it is complete, and says what's missing", async () => {
    await open(4); // no priority, engineer or description
    const submit = screen.getByRole("button", { name: "Submit for approval" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/Add a priority, an assigned engineer and a description before submitting/)).toBeInTheDocument();
  });

  it("is editable card by card", async () => {
    await open(4);
    expect(screen.getByRole("button", { name: "Edit Departments, processes and equipment" })).toBeInTheDocument();
  });
});

describe("an approved MCN", () => {
  it("locks the content but not the implementation, and says why", async () => {
    await open(2);
    expect(screen.queryByRole("button", { name: "Edit Departments, processes and equipment" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Implementation" })).toBeInTheDocument();
    expect(screen.getAllByText(/the content is locked/).length).toBeGreaterThan(0);
  });

  it("shows who it was sent to", async () => {
    await open(2);
    expect(screen.getByText("Sent to (2)")).toBeInTheDocument();
  });
});

describe("approving", () => {
  it("prefills the ticked groups' people, lets the approver add someone, and sends", async () => {
    const user = userEvent.setup();
    await open(3); // Submitted, ticked: Logistics, Sales, Purchasing Manager, SHE Coordinator
    await user.click(screen.getByRole("button", { name: "Approve and send" }));
    const dialog = await screen.findByRole("dialog", { name: /Approve MCN/ });
    // Purchasing Manager and SHE Coordinator have people in the demo groups.
    expect(within(dialog).getByText("Casey Buyer")).toBeInTheDocument();
    expect(within(dialog).getByText("Drew Safety")).toBeInTheDocument();
    // Logistics and Sales have nobody — the dialog says so.
    expect(within(dialog).getByText(/Nobody is set up to receive for Logistics Manager, Sales/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /Approve and send to 2/ }));
    await waitFor(async () => expect((await getMcn(3))?.status).toBe("Approved"));
    expect((await getMcn(3))?.distributedTo.map((p) => p.displayName)).toEqual(["Casey Buyer", "Drew Safety"]);
  });

  it("isn't offered to a team member who isn't an approver", async () => {
    who.email = "morgan.example@example.com";
    await open(3);
    expect(screen.getByRole("button", { name: "Approve and send" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText("Only an MCN approver can approve, reject or reopen an MCN.").length).toBeGreaterThan(0);
  });
});

describe("rejecting", () => {
  it("needs a reason, and records it", async () => {
    const user = userEvent.setup();
    await open(3);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog", { name: /Reject MCN/ });
    const confirm = within(dialog).getByRole("button", { name: "Reject" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "Needs a trial first");
    await user.click(confirm);
    await waitFor(async () => expect((await getMcn(3))?.status).toBe("Rejected"));
    expect((await getMcn(3))?.rejectionReason).toBe("Needs a trial first");
  });
});
