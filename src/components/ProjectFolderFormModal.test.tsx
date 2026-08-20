import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_PROJECTS } from "@/data/mockData";
import { ProjectFolderFormModal } from "./ProjectFolderFormModal";

// A project folder is only useful once it's tagged with its Project Reference
// — that tag is what routes a task's uploads into it instead of Miscellaneous.
// These cover the form that captures both halves.

function open(taken: number[] = [], onClose = vi.fn(), onCreated = vi.fn()) {
  renderWithProviders(
    <ProjectFolderFormModal
      projects={MOCK_PROJECTS}
      takenLookupIds={new Set(taken)}
      onClose={onClose}
      onCreated={onCreated}
    />,
    { route: "/project-folders", routePattern: "/project-folders" },
  );
  return { onClose, onCreated };
}

async function pickProject(title: string) {
  await userEvent.click(screen.getByRole("button", { name: "Project" }));
  await userEvent.click(await screen.findByRole("option", { name: new RegExp(title) }));
}

describe("ProjectFolderFormModal", () => {
  it("asks for a project", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: /create folder/i }));
    expect(await screen.findByText(/Pick the project this folder is for/i)).toBeInTheDocument();
  });

  // The folders already in the library are named after their project, so the
  // form starts there rather than making people retype it.
  it("names the folder after the project by default", async () => {
    open();
    await pickProject("0017-AMP-5000 Refresh");
    await waitFor(() =>
      expect(screen.getByLabelText(/folder name/i)).toHaveValue("0017-AMP-5000 Refresh"),
    );
  });

  it("stops following the project once the name is typed in", async () => {
    open();
    await pickProject("0017-AMP-5000 Refresh");
    const name = screen.getByLabelText(/folder name/i);
    await userEvent.clear(name);
    await userEvent.type(name, "AMP-5000 — drawings only");

    await pickProject("0000-Engineering Apps");
    expect(name).toHaveValue("AMP-5000 — drawings only");
  });

  // Two folders for one project would make task uploads land arbitrarily,
  // since the router picks the first match.
  it("refuses a project that already has a folder, and says which", async () => {
    const amp = MOCK_PROJECTS.find((p) => p.title === "0017-AMP-5000 Refresh")!;
    open([amp.lookupId]);
    await userEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(
      await screen.findByRole("option", { name: /0017-AMP-5000 Refresh — has a folder/ }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("option", { name: /0017-AMP-5000 Refresh/ }));
    await waitFor(() =>
      expect(screen.getByText(/already has a folder/i)).toBeInTheDocument(),
    );
  });

  it("creates the folder and hands back its name", async () => {
    const { onClose, onCreated } = open();
    await pickProject("0003-Engineering Task List");
    await userEvent.click(screen.getByRole("button", { name: /create folder/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("0003-Engineering Task List"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const { onClose } = open();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
