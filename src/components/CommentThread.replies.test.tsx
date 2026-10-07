import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { CommentThread } from "./CommentThread";
import { readReplyRef, withReplyMarker } from "@/lib/commentReplies";
import type { Comment } from "@/types/task";

// =============================================================================
// Threaded replies (BusinessIT#9): a Reply button on each comment, an inline
// reply box, and replies shown indented under the comment they answer.
// =============================================================================

function render(ui: React.ReactElement) {
  return rtlRender(<MemoryRouter>{ui}</MemoryRouter>);
}

const MATT: Comment = {
  timestamp: new Date("2026-10-01T13:00:00Z"),
  authorName: "Matthew Traina",
  authorEmail: "matthew.traina@altronic-llc.com",
  bodyHtml: "<p>We need the rev B drawing.</p>",
};
const NEWER: Comment = {
  timestamp: new Date("2026-10-02T13:00:00Z"),
  authorName: "Sarah Shaffer",
  authorEmail: "sarah.shaffer@altronic-llc.com",
  bodyHtml: "<p>Newest top-level comment.</p>",
};
const REPLY: Comment = {
  timestamp: new Date("2026-10-03T09:00:00Z"),
  authorName: "Ray White",
  authorEmail: "ray.white@altronic-llc.com",
  bodyHtml: withReplyMarker("<p>Drawing attached.</p>", MATT),
};

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe("CommentThread — showing replies", () => {
  it("puts a reply under its parent, indented, not at the top of the thread", () => {
    // Newest first, as the page hands them over: the reply is the newest of all.
    render(<CommentThread comments={[REPLY, NEWER, MATT]} />);
    const replies = screen.getByTestId("comment-replies");
    expect(within(replies).getByText("Drawing attached.")).toBeInTheDocument();
    // Its quote line says what it answers.
    expect(within(replies).getByText(/Replying to Matthew Traina/)).toBeInTheDocument();

    // Order on the page: Sarah's comment, then Matthew's, then the reply.
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Newest top-level")).toBeLessThan(text.indexOf("rev B drawing"));
    expect(text.indexOf("rev B drawing.”")).toBeLessThan(text.indexOf("Drawing attached."));
  });

  it("a thread with no replies renders no reply area", () => {
    render(<CommentThread comments={[NEWER, MATT]} />);
    expect(screen.queryByTestId("comment-replies")).toBeNull();
  });
});

describe("CommentThread — the Reply button", () => {
  it("isn't offered when the page passes no onReply", () => {
    render(<CommentThread comments={[MATT]} />);
    expect(screen.queryByRole("button", { name: /^reply$/i })).toBeNull();
  });

  it("is offered on every comment, replies included", () => {
    render(<CommentThread comments={[REPLY, MATT]} onReply={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /^reply$/i })).toHaveLength(2);
  });

  it("posts the reply through onReply with a marker naming the parent", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn(async () => {});
    render(<CommentThread comments={[NEWER, MATT]} onReply={onReply} />);

    // Matthew's comment is the second top-level comment.
    await user.click(screen.getAllByRole("button", { name: /^reply$/i })[1]);
    const box = screen.getByRole("group", { name: "Reply to Matthew Traina" });
    await user.type(within(box).getByRole("textbox"), "On it");
    await user.click(within(box).getByRole("button", { name: /send|post/i }));

    expect(onReply).toHaveBeenCalledTimes(1);
    const [bodyHtml] = onReply.mock.calls[0] as unknown as [string];
    expect(bodyHtml).toContain("On it");
    expect(readReplyRef(bodyHtml)).toMatchObject({
      timestampMs: MATT.timestamp.getTime(),
      authorEmail: MATT.authorEmail,
    });
    // The box closes once the reply is saved.
    expect(screen.queryByRole("group", { name: /reply to/i })).toBeNull();
  });

  it("replying to a reply names the REPLY as the parent, and opens in the same thread", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn(async () => {});
    render(<CommentThread comments={[REPLY, MATT]} onReply={onReply} />);

    // The second Reply button belongs to Ray's reply.
    await user.click(screen.getAllByRole("button", { name: /^reply$/i })[1]);
    const box = screen.getByRole("group", { name: "Reply to Ray White" });
    expect(within(screen.getByTestId("comment-replies")).getByRole("group")).toBe(box);

    await user.type(within(box).getByRole("textbox"), "Thanks");
    await user.click(within(box).getByRole("button", { name: /send|post/i }));
    const [bodyHtml] = onReply.mock.calls[0] as unknown as [string];
    expect(readReplyRef(bodyHtml)?.authorEmail).toBe(REPLY.authorEmail);
  });

  it("Cancel closes the reply box without posting", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    render(<CommentThread comments={[MATT]} onReply={onReply} />);
    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("group", { name: /reply to/i })).toBeNull();
    expect(onReply).not.toHaveBeenCalled();
  });

  it("a reply that fails to save stays in the box", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn(async () => {
      throw new Error("SharePoint said no");
    });
    render(<CommentThread comments={[MATT]} onReply={onReply} />);
    await user.click(screen.getByRole("button", { name: /^reply$/i }));
    const box = screen.getByRole("group", { name: "Reply to Matthew Traina" });
    await user.type(within(box).getByRole("textbox"), "On it");
    await user.click(within(box).getByRole("button", { name: /send|post/i }));
    // The composer puts the text back once the save's promise rejects.
    await waitFor(() => expect(within(box).getByRole("textbox")).toHaveValue("On it"));
    expect(screen.getByRole("group", { name: "Reply to Matthew Traina" })).toBeInTheDocument();
  });
});

describe("CommentThread — editing a reply", () => {
  it("keeps the reply threaded: the marker is put back on save", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn(async () => {});
    render(
      <CommentThread
        comments={[REPLY, MATT]}
        currentUserEmail={REPLY.authorEmail}
        onEdit={onEdit}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    const box = screen.getByDisplayValue("Drawing attached.");
    // The marker isn't in the edit box to be flattened or deleted by accident.
    expect((box as HTMLTextAreaElement).value).not.toContain("Replying to");
    await user.clear(box);
    await user.type(box, "Drawing attached, rev B.");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    const [, newBody] = onEdit.mock.calls[0] as unknown as [Comment, string];
    expect(newBody).toContain("Drawing attached, rev B.");
    expect(readReplyRef(newBody)?.timestampMs).toBe(MATT.timestamp.getTime());
  });
});
