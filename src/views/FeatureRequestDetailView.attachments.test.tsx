import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { listAttachments } from "@/api/attachments";
import { FeatureRequestDetailView } from "./FeatureRequestDetailView";

// A file attached to a feature request comment was shown in the composer, then
// dropped when the comment posted: the page passed no `uploadFile`, and there
// was no attachment store for feature requests at all (reported 2026-11-05).
// Nothing here is mocked but the signed-in user — the upload runs through the
// real hook and the mock attachment store.

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

function filesDataTransfer(files: File[]) {
  return { types: ["Files"], files: files as unknown as FileList, dropEffect: "" } as unknown as DataTransfer;
}

describe("FeatureRequestDetailView — comment attachments", () => {
  it("uploads a file attached to a comment, links it in the comment and lists it under Attachments", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeatureRequestDetailView />, {
      route: "/feature-request/1",
      routePattern: "/feature-request/:id",
    });
    const composer = await screen.findByPlaceholderText(/write a comment/i);

    const file = new File(["mock-up"], "board-mockup.txt", { type: "text/plain" });
    fireEvent.drop(composer.parentElement as HTMLElement, { dataTransfer: filesDataTransfer([file]) });
    await user.type(composer, "Something like this");
    const send = screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-send"));
    await user.click(send!);

    // The file is really stored against the request…
    await waitFor(async () => {
      const stored = await listAttachments("featureRequest", 1);
      expect(stored.map((a) => a.fileName)).toContain("board-mockup.txt");
    });
    // …the comment names it (in mock mode the link's blob: href is stripped by
    // sanitiseHtml, so it's the file name in the comment body, not a link)…
    await waitFor(() => {
      const inComment = screen
        .getAllByText("board-mockup.txt")
        .some((el) => el.closest(".comment-html")?.textContent?.includes("Something like this"));
      expect(inComment).toBe(true);
    });
    // …and the page's Attachments card shows it, as well as the comment.
    await waitFor(() => {
      const outside = screen
        .getAllByText("board-mockup.txt")
        .filter((el) => !el.closest(".comment-html"));
      expect(outside.length).toBeGreaterThan(0);
    });
  });
});
