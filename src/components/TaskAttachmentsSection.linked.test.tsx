import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { TaskAttachmentsSection } from "./TaskAttachmentsSection";
import { __resetLinkedFilesMock } from "@/api/taskLinkedFiles";
import { MOCK_TASKS } from "@/data/mockData";
import type { Task } from "@/types/task";

// Linked files on the task's Attachments card (BusinessIT#62), demo mode end
// to end: the links show beside the uploads, From library links a file
// without copying it, and Unlink only removes the link.

const base = MOCK_TASKS[0];
const task: Task = {
  ...base,
  id: 15,
  parentProject: { lookupId: 501, title: "0017-AMP-5000 Refresh" },
};

beforeEach(() => {
  __resetLinkedFilesMock();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("TaskAttachmentsSection — linked files", () => {
  it("lists the task's linked files, with the folder each sits in", async () => {
    renderWithProviders(<TaskAttachmentsSection task={task} />);
    expect(await screen.findByText(/Linked from the library \(1\)/)).toBeInTheDocument();
    const row = screen.getByRole("link", { name: "driver-board-revD.dwg" }).closest("li") as HTMLElement;
    expect(within(row).getByText(/0017-AMP-5000 Refresh \/ Drawings/)).toBeInTheDocument();
    expect(within(row).getByText(/linked by Demo User/)).toBeInTheDocument();
  });

  it("links a file from the library — no upload, no copy", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TaskAttachmentsSection task={task} />);
    await screen.findByText(/Linked from the library \(1\)/);
    await user.click(screen.getByRole("button", { name: /From library/ }));
    const picker = await screen.findByRole("dialog", { name: "Attach from library" });
    await user.click(await within(picker).findByRole("checkbox", { name: /BOM\.xlsx/ }));
    await user.click(within(picker).getByRole("button", { name: /Link 1 file/ }));
    expect(await screen.findByText(/Linked from the library \(2\)/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "BOM.xlsx" }).length).toBeGreaterThan(0);
  });

  it("unlinks without deleting the file", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TaskAttachmentsSection task={task} />);
    await screen.findByText(/Linked from the library \(1\)/);
    await user.click(screen.getByRole("button", { name: "Unlink driver-board-revD.dwg" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/stays where it is in SharePoint/));
    await waitFor(() => expect(screen.queryByText(/Linked from the library/)).not.toBeInTheDocument());
    // The file is still in the library — the picker still lists it.
    await user.click(screen.getByRole("button", { name: /From library/ }));
    const picker = await screen.findByRole("dialog", { name: "Attach from library" });
    await user.click(await within(picker).findByRole("button", { name: /Drawings/ }));
    expect(await within(picker).findByText("driver-board-revD.dwg")).toBeInTheDocument();
  });

  it("says a linked file is gone when SharePoint no longer has it", async () => {
    __resetLinkedFilesMock({
      15: JSON.stringify([
        { id: "not-in-library", name: "old-spec.pdf", webUrl: "#", folderPath: "Somewhere" },
      ]),
    });
    renderWithProviders(<TaskAttachmentsSection task={task} />);
    expect(await screen.findByText(/No longer in SharePoint/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "old-spec.pdf" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlink old-spec.pdf" })).toBeEnabled();
  });

  it("won't change links it can't read, and says why", async () => {
    __resetLinkedFilesMock({ 15: "{broken" });
    renderWithProviders(<TaskAttachmentsSection task={task} />);
    expect(await screen.findByText(/couldn't be read, so ARC won't change them/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /From library/ })).toBeDisabled();
  });
});
