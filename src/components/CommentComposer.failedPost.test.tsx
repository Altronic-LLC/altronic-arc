import { describe, it, expect, vi, beforeAll } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentComposer } from "./CommentComposer";
import type { Person } from "@/types/task";

// =============================================================================
// A comment that fails to post comes BACK — text, @-mention chips and files.
//
// Thomas Terhune, 2026-09-30: a task comment with two pictures failed (a Graph
// 409). The composer had already cleared, so the comment was gone. He pasted
// the text back in, which turned "@Brandon Mirto" into plain text: no chip, so
// nobody was notified or added as a watcher. And each retry uploaded the
// pictures again, leaving "IMG_1224 (2).jpg" beside the first copy.
//
// The composer still clears at once (the next comment can be typed while this
// one saves); it restores only when the caller RETURNS the save's promise and
// that promise rejects.
// =============================================================================

beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  }
});

const brandon: Person = {
  displayName: "Brandon Mirto",
  email: "brandon.mirto@altronic-llc.com",
  lookupId: 12,
};

const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

function drop(files: File[]) {
  const zone = screen.getByRole("textbox").parentElement as HTMLElement;
  fireEvent.drop(zone, {
    dataTransfer: { types: ["Files"], files, dropEffect: "" } as unknown as DataTransfer,
  });
}

/** Type a comment that @-mentions Brandon through the picker. */
async function writeMention(user: ReturnType<typeof userEvent.setup>) {
  const textarea = screen.getByRole("textbox");
  await user.type(textarea, "Look at this @Bran");
  await user.click(await screen.findByRole("option", { name: /brandon mirto/i }));
  await user.type(textarea, "please");
}

const send = () => screen.getByRole("button", { name: /^send$/i });

const conflict = () =>
  Object.assign(new Error("Graph 409 Conflict at https://graph.microsoft.com/…: {…}"), {
    status: 409,
    body: '{"error":{"code":"resourceModified"}}',
  });

describe("CommentComposer — a failed post", () => {
  it("puts the text back, with the @-mention still a chip", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(undefined);
    render(<CommentComposer onSubmit={onSubmit} mentionablePeople={[brandon]} />);

    await writeMention(user);
    await user.click(send());

    await waitFor(() =>
      expect(screen.getByRole("textbox")).toHaveValue("Look at this @Brandon Mirto please"),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/didn't post \(network down\)/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/press send to try again/i);

    // Send again: the mention is still a chip, so it still notifies.
    await user.click(send());
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.stringContaining('data-email="brandon.mirto@altronic-llc.com"'),
      expect.anything(),
    );
  });

  it("brings the files back and does NOT upload them a second time", async () => {
    const user = userEvent.setup();
    const uploadFile = vi.fn(async (file: File) => ({
      name: file.name,
      webUrl: `https://example.sharepoint.com/${file.name}`,
    }));
    const onSubmit = vi.fn().mockRejectedValueOnce(conflict()).mockResolvedValueOnce(undefined);
    render(<CommentComposer onSubmit={onSubmit} uploadFile={uploadFile} />);

    await user.type(screen.getByRole("textbox"), "thermal pictures");
    drop([png("IR_00213.png"), png("IR_00214.png")]);
    await user.click(send());

    await waitFor(() => expect(screen.getByText("IR_00213.png")).toBeInTheDocument());
    expect(screen.getByText("IR_00214.png")).toBeInTheDocument();
    expect(uploadFile).toHaveBeenCalledTimes(2);

    await user.click(send());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    // Linked again from the first attempt's uploads — no second copy.
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.stringContaining("https://example.sharepoint.com/IR_00214.png"),
      [],
    );
  });

  it("explains a SharePoint conflict in words, not the raw Graph error", async () => {
    const user = userEvent.setup();
    render(<CommentComposer onSubmit={vi.fn().mockRejectedValue(conflict())} />);
    await user.type(screen.getByRole("textbox"), "hello");
    await user.click(send());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/still saving another change/i);
    expect(alert).not.toHaveTextContent(/graph\.microsoft\.com/);
  });

  it("does not overwrite a new comment typed while the failed one was saving", async () => {
    const user = userEvent.setup();
    let fail: (err: Error) => void = () => undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    render(<CommentComposer onSubmit={onSubmit} />);

    await user.type(screen.getByRole("textbox"), "first");
    await user.click(send());
    await user.type(screen.getByRole("textbox"), "second");
    fail(new Error("network down"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /your last comment didn't post/i,
    );
    expect(screen.getByRole("textbox")).toHaveValue("second");
  });

  it("says the UPLOAD failed when it did, and keeps the comment without posting", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const uploadFile = vi.fn().mockRejectedValue(new Error("too large"));
    render(<CommentComposer onSubmit={onSubmit} uploadFile={uploadFile} />);

    await user.type(screen.getByRole("textbox"), "see attached");
    drop([png("big.png")]);
    await user.click(send());

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't attach file: too large");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("see attached");
    expect(screen.getByText("big.png")).toBeInTheDocument();
  });

  it("still clears straight away for a fire-and-forget caller", async () => {
    const user = userEvent.setup();
    render(<CommentComposer onSubmit={() => undefined} />);
    await user.type(screen.getByRole("textbox"), "hello");
    await user.click(send());
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
