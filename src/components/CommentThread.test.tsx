import { describe, it, expect, vi, beforeAll } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentThread } from "./CommentThread";
import type { Comment } from "@/types/task";

// jsdom has no object-URL implementation; the editor makes one per
// attachment for the preview thumbnail, same as CommentComposer.
beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  }
});

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

describe("CommentThread — ownership by name (older / imported comments)", () => {
  // Imported from the previous app: the saved email doesn't equal the current
  // login, but the saved name does — should still be editable.
  const LEGACY_OWN: Comment = {
    timestamp: new Date("2026-01-04T12:00:00"),
    authorName: "Ray White",
    authorEmail: "rwhite@legacy-domain.com",
    bodyHtml: "<p>an imported comment</p>",
  };

  it("shows Edit when the saved NAME matches, even if the email doesn't", () => {
    render(
      <CommentThread
        comments={[LEGACY_OWN]}
        currentUserEmail="ray.white@altronic-llc.com"
        currentUserName="Ray White"
        onEdit={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it("matches the name case-insensitively", () => {
    render(
      <CommentThread
        comments={[LEGACY_OWN]}
        currentUserEmail=""
        currentUserName="  ray white  "
        onEdit={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it("still hides Edit when neither email nor name matches", () => {
    render(
      <CommentThread
        comments={[OTHERS_COMMENT]}
        currentUserEmail="ray.white@altronic-llc.com"
        currentUserName="Ray White"
        onEdit={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("does not treat blank name/email as a match (empty author stays locked)", () => {
    render(
      <CommentThread
        comments={[{ ...OTHERS_COMMENT, authorName: "", authorEmail: "" }]}
        currentUserEmail=""
        currentUserName=""
        onEdit={() => {}}
      />,
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

describe("CommentThread — editing preserves and adds real @-mentions", () => {
  async function openEditor(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
  }

  it("keeps an existing mention chip when the comment is saved unchanged", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    const mentioned: Comment = {
      timestamp: new Date("2026-01-03T12:00:00"),
      authorName: "Ray White",
      authorEmail: "ray.white@altronic-llc.com",
      bodyHtml:
        '<p><span class="mention" data-email="sarah.shaffer@altronic-llc.com">@Sarah Shaffer</span> check this out</p>',
    };
    render(
      <CommentThread
        comments={[mentioned]}
        currentUserEmail="ray.white@altronic-llc.com"
        mentionablePeople={[{ displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com" }]}
        onEdit={onEdit}
      />,
    );

    await openEditor(user);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onEdit).toHaveBeenCalledWith(
      mentioned,
      expect.stringContaining('data-email="sarah.shaffer@altronic-llc.com"'),
      false,
    );
  });

  it("turns a newly picked @-mention into a real chip on save", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(
      <CommentThread
        comments={[OWN_COMMENT]}
        currentUserEmail="ray.white@altronic-llc.com"
        mentionablePeople={[{ displayName: "Matthew Traina", email: "matthew.traina@altronic-llc.com" }]}
        onEdit={onEdit}
      />,
    );

    await openEditor(user);
    const textarea = screen.getByDisplayValue("hello there");
    await user.type(textarea, " @Matthew");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onEdit).toHaveBeenCalledWith(
      OWN_COMMENT,
      expect.stringContaining('data-email="matthew.traina@altronic-llc.com"'),
      false,
    );
  });
});

describe("CommentThread — CommentEditor supports drag-and-drop attachments", () => {
  async function openEditor(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
  }

  const txt = (name: string) => new File(["hello"], name, { type: "text/plain" });

  function filesDataTransfer(files: File[]) {
    return {
      types: ["Files"],
      files: files as unknown as FileList,
      dropEffect: "",
    } as unknown as DataTransfer;
  }

  function editorContainer() {
    // The editor's own bordered wrapper — the textarea's direct parent —
    // same relationship as CommentComposer's drop target.
    return screen.getByRole("textbox").parentElement as HTMLElement;
  }

  it("shows an Attach button on the editor", async () => {
    const user = userEvent.setup();
    render(
      <CommentThread
        comments={[OWN_COMMENT]}
        currentUserEmail="ray.white@altronic-llc.com"
        onEdit={() => {}}
      />,
    );
    await openEditor(user);
    expect(screen.getByRole("button", { name: /^attach$/i })).toBeInTheDocument();
  });

  it("highlights the editor on dragenter and clears it on drop", async () => {
    const user = userEvent.setup();
    render(
      <CommentThread
        comments={[OWN_COMMENT]}
        currentUserEmail="ray.white@altronic-llc.com"
        onEdit={() => {}}
      />,
    );
    await openEditor(user);
    const zone = editorContainer();
    fireEvent.dragEnter(zone, { dataTransfer: filesDataTransfer([txt("a.txt")]) });
    expect(zone.className).toContain("bg-accent/5");
    fireEvent.drop(zone, { dataTransfer: filesDataTransfer([txt("a.txt")]) });
    expect(zone.className).not.toContain("bg-accent/5");
  });

  it("attaches a dropped file onto the editor", async () => {
    const user = userEvent.setup();
    render(
      <CommentThread
        comments={[OWN_COMMENT]}
        currentUserEmail="ray.white@altronic-llc.com"
        onEdit={() => {}}
      />,
    );
    await openEditor(user);
    const zone = editorContainer();
    fireEvent.drop(zone, { dataTransfer: filesDataTransfer([txt("dropped.txt")]) });
    expect(screen.getByText("dropped.txt")).toBeInTheDocument();
  });

  it("uploads a dropped file through uploadFile and inlines a link when saving", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    const uploadFile = vi.fn().mockResolvedValue({
      name: "dropped.txt",
      webUrl: "https://example.sharepoint.com/dropped.txt",
    });
    render(
      <CommentThread
        comments={[OWN_COMMENT]}
        currentUserEmail="ray.white@altronic-llc.com"
        onEdit={onEdit}
        uploadFile={uploadFile}
      />,
    );
    await openEditor(user);
    const zone = editorContainer();
    fireEvent.drop(zone, { dataTransfer: filesDataTransfer([txt("dropped.txt")]) });
    expect(screen.getByText("dropped.txt")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(
      OWN_COMMENT,
      expect.stringContaining("https://example.sharepoint.com/dropped.txt"),
      false,
    );
  });

  it("falls back to the legacy blob attachment shape when no uploadFile is supplied (matches CommentComposer's default)", async () => {
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
    const zone = editorContainer();
    fireEvent.drop(zone, { dataTransfer: filesDataTransfer([txt("dropped.txt")]) });

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onEdit).toHaveBeenCalledWith(
      OWN_COMMENT,
      expect.not.stringContaining("dropped.txt"),
      false,
    );
  });
});
