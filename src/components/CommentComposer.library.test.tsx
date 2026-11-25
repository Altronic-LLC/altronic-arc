import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CommentComposer } from "./CommentComposer";
import type { PickedLibraryFile } from "@/lib/linkedFiles";

// "From library" in the comment box (BusinessIT#62): a file already in
// SharePoint is LINKED in the comment — never uploaded again — and the page
// hears which files the comment linked once it has posted.

const FILE: PickedLibraryFile = {
  id: "drive-1",
  name: "actuator-spec.pdf",
  webUrl: "https://sp.test/actuator-spec.pdf",
  folderPath: "381-MT / Misc / Actuators",
};

function setup(
  onSubmit = vi.fn(async (_html: string, _attachments: unknown[]): Promise<void> => {}),
) {
  const uploadFile = vi.fn(async (f: File) => ({ name: f.name, webUrl: "https://sp.test/up" }));
  const onLibraryFilesSent = vi.fn();
  renderWithProviders(
    <CommentComposer
      onSubmit={onSubmit}
      uploadFile={uploadFile}
      onLibraryFilesSent={onLibraryFilesSent}
      renderLibraryPicker={(done) => (
        <div role="dialog" aria-label="picker">
          <button type="button" onClick={() => done([FILE])}>
            pick it
          </button>
          <button type="button" onClick={() => done([])}>
            close
          </button>
        </div>
      )}
    />,
  );
  return { onSubmit, uploadFile, onLibraryFilesSent };
}

describe("CommentComposer — From library", () => {
  it("offers From library only when the page gives a picker", () => {
    renderWithProviders(<CommentComposer onSubmit={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /From library/ })).not.toBeInTheDocument();
  });

  it("links the picked file in the comment without uploading anything", async () => {
    const user = userEvent.setup();
    const { onSubmit, uploadFile, onLibraryFilesSent } = setup();
    await user.click(screen.getByRole("button", { name: /From library/ }));
    await user.click(screen.getByRole("button", { name: "pick it" }));
    expect(screen.queryByRole("dialog", { name: "picker" })).not.toBeInTheDocument();
    expect(screen.getByText("actuator-spec.pdf")).toBeInTheDocument();
    expect(screen.getByText(/Linked · 381-MT \/ Misc \/ Actuators/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Send/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [html, attachments] = onSubmit.mock.calls[0];
    expect(html).toContain('href="https://sp.test/actuator-spec.pdf"');
    expect(html).toContain("actuator-spec.pdf");
    expect(attachments).toEqual([]);
    expect(uploadFile).not.toHaveBeenCalled();
    await waitFor(() => expect(onLibraryFilesSent).toHaveBeenCalledWith([FILE]));
  });

  it("still uploads a dropped file beside a linked one", async () => {
    const user = userEvent.setup();
    const { onSubmit, uploadFile } = setup();
    await user.click(screen.getByRole("button", { name: /From library/ }));
    await user.click(screen.getByRole("button", { name: "pick it" }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["x"], "photo.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: /Send/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(uploadFile.mock.calls[0][0].name).toBe("photo.jpg");
    const html = onSubmit.mock.calls[0][0] as string;
    expect(html).toContain("https://sp.test/up");
    expect(html).toContain("https://sp.test/actuator-spec.pdf");
  });

  it("doesn't report linked files for a comment that failed to post", async () => {
    const user = userEvent.setup();
    const { onLibraryFilesSent } = setup(vi.fn(async (_html: string, _attachments: unknown[]): Promise<void> => Promise.reject(new Error("nope"))));
    await user.click(screen.getByRole("button", { name: /From library/ }));
    await user.click(screen.getByRole("button", { name: "pick it" }));
    await user.click(screen.getByRole("button", { name: /Send/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/didn't post/);
    // Back in the box, ready to send again.
    expect(screen.getByText("actuator-spec.pdf")).toBeInTheDocument();
    expect(onLibraryFilesSent).not.toHaveBeenCalled();
  });

  it("closing the picker with nothing picked adds nothing", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /From library/ }));
    await user.click(screen.getByRole("button", { name: "close" }));
    expect(screen.getByRole("button", { name: /Send/ })).toBeDisabled();
  });
});
