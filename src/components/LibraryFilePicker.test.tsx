import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { LibraryFilePicker } from "./LibraryFilePicker";

// The library browser (BusinessIT#62), in demo mode over the mock project-
// folder tree: it opens AT the task's folder, goes into subfolders and back
// up, hands back the ticked files with the folders they sit in, and uploads
// into the folder on screen.

const AMP = { id: "mf-amp", name: "0017-AMP-5000 Refresh" };

function open(props: Partial<Parameters<typeof LibraryFilePicker>[0]> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <LibraryFilePicker startFolder={AMP} onPick={onPick} onClose={onClose} {...props} />,
  );
  return { onPick, onClose };
}

describe("LibraryFilePicker", () => {
  it("opens at the task's project folder", async () => {
    open();
    expect(await screen.findByText("AMP-5000 Test Plan.pdf")).toBeInTheDocument();
    const path = screen.getByRole("navigation", { name: "Folder path" });
    expect(path).toHaveTextContent("Project Folders");
    expect(path).toHaveTextContent("0017-AMP-5000 Refresh");
  });

  it("hands back ticked files from a subfolder, with the folders they sit in", async () => {
    const user = userEvent.setup();
    const { onPick } = open();
    await user.click(await screen.findByRole("button", { name: /Drawings/ }));
    await user.click(await screen.findByRole("checkbox", { name: /driver-board-revD\.dwg/ }));
    await user.click(screen.getByRole("button", { name: /Link 1 file/ }));
    expect(onPick).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "mf-amp-draw-1",
        name: "driver-board-revD.dwg",
        folderPath: "0017-AMP-5000 Refresh / Drawings",
      }),
    ]);
  });

  it("keeps ticks across folders, and can go up to Project Folders", async () => {
    const user = userEvent.setup();
    const { onPick } = open();
    await user.click(await screen.findByRole("checkbox", { name: /BOM\.xlsx/ }));
    await user.click(screen.getByRole("button", { name: "Project Folders" }));
    await user.click(await screen.findByRole("button", { name: /0000-Engineering Apps/ }));
    await user.click(await screen.findByRole("checkbox", { name: /App Backlog\.docx/ }));
    await user.click(screen.getByRole("button", { name: /Link 2 files/ }));
    const picked = onPick.mock.calls[0][0];
    expect(picked.map((p: { name: string }) => p.name)).toEqual(["BOM.xlsx", "App Backlog.docx"]);
    expect(picked[1].folderPath).toBe("0000-Engineering Apps");
  });

  it("shows a file that's already linked as linked, and won't pick it again", async () => {
    open({ alreadyLinked: new Set(["mf-amp-1"]) });
    const box = await screen.findByRole("checkbox", { name: /AMP-5000 Test Plan\.pdf/ });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(screen.getByRole("button", { name: /Link files/ })).toBeDisabled();
  });

  it("won't upload at Project Folders itself — only into a folder", async () => {
    open({ startFolder: null });
    await screen.findByRole("button", { name: /0017-AMP-5000 Refresh/ });
    expect(screen.getByRole("button", { name: /Upload here/ })).toBeDisabled();
  });

  it("uploads into the folder on screen and ticks the new file", async () => {
    const user = userEvent.setup();
    const { onPick } = open();
    await user.click(await screen.findByRole("button", { name: /Drawings/ }));
    await screen.findByText("driver-board-revD.dwg");
    const file = new File(["x"], "actuator-spec.pdf", { type: "application/pdf" });
    await user.upload(screen.getByTestId("library-picker-file-input"), file);
    await waitFor(() => expect(screen.getByRole("button", { name: /Link 1 file/ })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /Link 1 file/ }));
    expect(onPick.mock.calls[0][0][0]).toMatchObject({
      name: "actuator-spec.pdf",
      folderPath: "0017-AMP-5000 Refresh / Drawings",
    });
  });

  it("closes on Escape and on Cancel", async () => {
    const user = userEvent.setup();
    const { onClose } = open();
    await screen.findByText("AMP-5000 Test Plan.pdf");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
