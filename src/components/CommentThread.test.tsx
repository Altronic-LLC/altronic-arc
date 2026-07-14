import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentThread } from "./CommentThread";
import type { Comment } from "@/types/task";

const OWN_COMMENT: Comment = {
  timestamp: new Date("2026-01-01T12:00:00"),
  authorName: "Ray White",
  authorEmail: "ray.white@altronic-llc.com",
  bodyHtml: "<p>hello there</p>",
};

const OTHERS_COMMENT: Comment = {
  timestamp: new Date("2026-01-02T12:00:00"),
  authorName: "Sarah Shaffer",
  authorEmail: "sarah.shaffer@altronic-llc.com",
  bodyHtml: "<p>a different comment</p>",
};

describe("CommentThread — empty state", () => {
  it("shows a placeholder when there are no comments", () => {
    render(<CommentThread comments={[]} />);
    expect(screen.getByText(/no comments yet/i)).toBeInTheDocument();
  });
});

describe("CommentThread — edit permissions", () => {
  it("only shows the Edit button on the current user's own comment", () => {
    render(
      <CommentThread
        comments={[OWN_COMMENT, OTHERS_COMMENT]}
        currentUserEmail="ray.white@altronic-llc.com"
        onEdit={() => {}}
      />,
    );
    expect(screen.getAllByRole("button", { name: /^edit$/i })).toHaveLength(1);
  });

  it("hides every Edit button when onEdit is omitted", () => {
    render(
      <CommentThread comments={[OWN_COMMENT]} currentUserEmail="ray.white@altronic-llc.com" />,
    );
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });
});

describe("CommentThread — editing with the renotify checkbox", () => {
  async function openEditor(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
  }

  it("defaults the 'Notify everyone again' checkbox to unchecked and passes false on save", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(
      <CommentThread
        comments={[OWN_COMMENT]}
        currentUserEmail="ray.white@altronic-llc.com"
        onEdit={onEdit}
      />,
    );

    await openEditor(user);
    const checkbox = screen.getByRole("checkbox", { name: /notify everyone again/i });
    expect(checkbox).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(OWN_COMMENT, expect.any(String), false);
  });

  it("passes true when the author checks 'Notify everyone again' before saving", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(
      <CommentThread
        comments={[OWN_COMMENT]}
        currentUserEmail="ray.white@altronic-llc.com"
        onEdit={onEdit}
      />,
    );

    await openEditor(user);
    await user.click(screen.getByRole("checkbox", { name: /notify everyone again/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onEdit).toHaveBeenCalledWith(OWN_COMMENT, expect.any(String), true);
  });

  it("closes the editor without calling onEdit when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <CommentThread
        comments={[OWN_COMMENT]}
        currentUserEmail="ray.white@altronic-llc.com"
        onEdit={onEdit}
      />,
    );

    await openEditor(user);
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });
});
