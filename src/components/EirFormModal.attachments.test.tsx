import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/render";

// Attachments on the NEW EIR form (2026-10-22). There's no item to attach to
// until the EIR exists, so files are staged and uploaded after the create —
// and a file that won't upload must never make the EIR look unsaved.

const mutateAsync = vi.hoisted(() => vi.fn());
const uploadAttachments = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useEirs", () => ({
  useCreateEir: () => ({ mutateAsync, isPending: false }),
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

import { EirFormModal } from "./EirFormModal";

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderForm() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<EirFormModal mode="create" onClose={() => {}} />} />
      <Route path="*" element={<Where />} />
    </Routes>,
  );
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("Enter Subject"), "Obsolete regulator");
  await user.type(screen.getByLabelText("Description"), "Needs a replacement part.");
}

beforeEach(() => {
  mutateAsync.mockReset();
  uploadAttachments.mockReset();
  pushToast.mockReset();
  mutateAsync.mockResolvedValue({ id: 501, eirNo: "EIR_2026-0999", title: "Obsolete regulator" });
});

describe("EirFormModal — attachments on a new EIR", () => {
  it("uploads the staged files to the new EIR once it exists, then opens it", async () => {
    uploadAttachments.mockResolvedValue({ uploaded: ["datasheet.pdf", "photo.jpg"], failed: [] });
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);

    await user.upload(screen.getByLabelText("Add attachments"), [
      new File(["a"], "datasheet.pdf"),
      new File(["b"], "photo.jpg"),
    ]);
    expect(screen.getByText("datasheet.pdf")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/eir/501"));
    // Created FIRST, then the files go to that id.
    expect(mutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      uploadAttachments.mock.invocationCallOrder[0],
    );
    const [parent, id, files] = uploadAttachments.mock.calls[0];
    expect([parent, id]).toEqual(["eir", 501]);
    expect((files as File[]).map((f) => f.name)).toEqual(["datasheet.pdf", "photo.jpg"]);
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("renames a second file of the same name instead of losing it", async () => {
    uploadAttachments.mockResolvedValue({ uploaded: [], failed: [] });
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
    const input = screen.getByLabelText("Add attachments");
    await user.upload(input, new File(["a"], "image.jpg"));
    await user.upload(input, new File(["b"], "image.jpg"));
    expect(screen.getByText("image (2).jpg")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(uploadAttachments).toHaveBeenCalled());
    expect((uploadAttachments.mock.calls[0][2] as File[]).map((f) => f.name)).toEqual([
      "image.jpg",
      "image (2).jpg",
    ]);
  });

  it("a file that won't upload still opens the EIR, and says which file to re-add", async () => {
    uploadAttachments.mockResolvedValue({ uploaded: [], failed: ["huge.zip"] });
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
    await user.upload(screen.getByLabelText("Add attachments"), new File(["z"], "huge.zip"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/eir/501"));
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: expect.stringMatching(/EIR_2026-0999 was created.*huge\.zip/),
      }),
    );
  });

  it("holds the person on the form until SharePoint confirms every upload", async () => {
    // The EIR must not open — and nothing can be pressed — until the uploads
    // have actually been answered. No timer: the hold IS the confirmation.
    let finish!: (v: { uploaded: string[]; failed: string[] }) => void;
    uploadAttachments.mockImplementation(
      (_p: string, _id: number, files: File[], onProgress?: (i: number, f: File) => void) => {
        onProgress?.(1, files[1]);
        return new Promise((r) => (finish = r));
      },
    );
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
    await user.upload(screen.getByLabelText("Add attachments"), [
      new File(["a"], "a.pdf"),
      new File(["b"], "b.pdf"),
    ]);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /Uploading 2 of 2: b\.pdf\. It opens once SharePoint confirms everything/,
      ),
    );
    expect(screen.getByRole("button", { name: /Uploading 2 of 2/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(screen.queryByTestId("where")).toBeNull();

    // A refresh or tab close mid-save would drop the files — the browser asks.
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);

    await act(async () => finish({ uploaded: ["a.pdf", "b.pdf"], failed: [] }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/eir/501"));

    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("doesn't pull the person into the EIR if they left (Back) while it was saving", async () => {
    let finish!: (v: { uploaded: string[]; failed: string[] }) => void;
    uploadAttachments.mockImplementation(() => new Promise((r) => (finish = r)));
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(false)}>Leave</button>
          <Where />
          {open && <EirFormModal mode="create" onClose={() => setOpen(false)} />}
        </>
      );
    }
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await fillRequired(user);
    await user.upload(screen.getByLabelText("Add attachments"), new File(["a"], "a.pdf"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(uploadAttachments).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Leave" }));
    await act(async () => finish({ uploaded: ["a.pdf"], failed: [] }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
  });

  it("a removed file isn't uploaded, and no files means no upload at all", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
    await user.upload(screen.getByLabelText("Add attachments"), new File(["a"], "wrong.pdf"));
    await user.click(screen.getByRole("button", { name: "Remove wrong.pdf" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/eir/501"));
    expect(uploadAttachments).not.toHaveBeenCalled();
  });
});
