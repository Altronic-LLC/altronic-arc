import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { Comment } from "@/types/task";
import { LinkedDiscussion } from "./LinkedDiscussion";

// =============================================================================
// The other record's earlier comments, read-only (BusinessIT#58): shown, not
// copied, and collapsed until asked for.
// =============================================================================

const COMMENTS: Comment[] = [
  {
    timestamp: new Date("2026-10-01T12:00:00Z"),
    authorName: "Glenn Terry",
    authorEmail: "glenn.terry@altronic-llc.com",
    bodyHtml: "<p>Rev C boards are in stock.</p>",
  },
  {
    timestamp: new Date("2026-09-30T12:00:00Z"),
    authorName: "Ray White",
    authorEmail: "ray.white@altronic-llc.com",
    bodyHtml: "<p>Waiting on the connector.</p>",
  },
];

function renderPanel(comments = COMMENTS) {
  return renderWithProviders(
    <LinkedDiscussion
      recordLabel="T4-0017-HUB V4"
      to="/task/12"
      comments={comments}
      currentUserEmail="ray.white@altronic-llc.com"
      currentUserName="Ray White"
    />,
  );
}

describe("LinkedDiscussion", () => {
  it("renders nothing when there is nothing earlier", () => {
    const { container } = renderPanel([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("is collapsed, naming the record and the count", () => {
    renderPanel();
    const toggle = screen.getByRole("button", { name: /Earlier discussion on T4-0017-HUB V4/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("2 comments");
    expect(screen.queryByText("Rev C boards are in stock.")).toBeNull();
  });

  it("opens to the comments, saying they are shown, not copied, with a link to reply there", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /Earlier discussion/ }));
    expect(screen.getByText("Rev C boards are in stock.")).toBeInTheDocument();
    expect(screen.getByText("Waiting on the connector.")).toBeInTheDocument();
    expect(screen.getByText(/shown here, not copied/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "T4-0017-HUB V4" })).toHaveAttribute("href", "/task/12");
  });

  it("is read-only — no Edit and no Reply, even on your own comment", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /Earlier discussion/ }));
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reply/i })).toBeNull();
  });
});
