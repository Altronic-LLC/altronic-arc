import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// Attachments on the NEW MCN form. There's no item to attach to until the MCN
// exists, so files are staged and uploaded after the create — and a file that
// won't upload must never make the MCN look unsaved.

const mutateAsync = vi.hoisted(() => vi.fn());
const uploadAttachments = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useMcns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMcns")>()),
  useCreateMcn: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/api/attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/attachments")>()),
  uploadAttachments,
}));
vi.mock("@/components/Toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/Toast")>()),
  pushToast,
}));
// contenteditable is awkward in jsdom; the editor isn't what's under test.
vi.mock("@/components/RichTextEditor", () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Description" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { McnFormModal } from "./McnFormModal";

const onCreated = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  mutateAsync.mockReset();
  uploadAttachments.mockReset();
  pushToast.mockReset();
  onCreated.mockReset();
  onClose.mockReset();
  mutateAsync.mockResolvedValue({ id: 41, mcnNumber: "MCN26041", process: "Coolant change" });
});

async function stageAndSave(files: File[]) {
  const user = userEvent.setup();
  renderWithProviders(<McnFormModal onClose={onClose} onCreated={onCreated} />);
  await user.type(screen.getByPlaceholderText("e.g. Wave solder flux change"), "Coolant change");
  await user.upload(screen.getByLabelText("Add attachments"), files);
  await user.click(screen.getByRole("button", { name: "Save as draft" }));
}

describe("McnFormModal — attachments on a new MCN", () => {
  it("uploads the staged files to the new MCN once it exists, then opens it", async () => {
    uploadAttachments.mockResolvedValue({ uploaded: ["report.pdf", "photo.jpg"], failed: [] });
    await stageAndSave([new File(["a"], "report.pdf"), new File(["b"], "photo.jpg")]);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(41));
    // Created FIRST, then the files go to that id.
    expect(mutateAsync.mock.invocationCallOrder[0]).toBeLessThan(uploadAttachments.mock.invocationCallOrder[0]);
    const [parent, id, files] = uploadAttachments.mock.calls[0];
    expect([parent, id]).toEqual(["mcn", 41]);
    expect((files as File[]).map((f) => f.name)).toEqual(["report.pdf", "photo.jpg"]);
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("a file that won't upload still opens the MCN, and says which file to re-add", async () => {
    uploadAttachments.mockResolvedValue({ uploaded: [], failed: ["huge.zip"] });
    await stageAndSave([new File(["z"], "huge.zip")]);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(41));
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: expect.stringMatching(/MCN26041 was created.*huge\.zip/) }),
    );
  });

  it("uploads nothing when no file was staged", async () => {
    const user = userEvent.setup();
    renderWithProviders(<McnFormModal onClose={onClose} onCreated={onCreated} />);
    await user.type(screen.getByPlaceholderText("e.g. Wave solder flux change"), "Coolant change");
    await user.click(screen.getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(41));
    expect(uploadAttachments).not.toHaveBeenCalled();
  });
});
