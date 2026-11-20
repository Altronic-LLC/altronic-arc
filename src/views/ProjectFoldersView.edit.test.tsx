import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { ProjectFoldersView } from "./ProjectFoldersView";

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// BusinessIT#25 — Sheila needs to correct typos in a folder's name and in the
// Project Reference tag it was created with.

const folder = (name: string) => screen.getByRole("button", { name });

async function renderBrowser() {
  renderWithProviders(<ProjectFoldersView />, {
    route: "/project-folders",
    routePattern: "/project-folders",
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^0017-AMP-5000 Refresh/ })).toBeInTheDocument(),
  );
}

describe("ProjectFoldersView — editing a folder", () => {
  it("offers Edit on a project folder but not on Miscellaneous", async () => {
    await renderBrowser();
    expect(folder("Edit 0017-AMP-5000 Refresh")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Miscellaneous" })).not.toBeInTheDocument();
  });

  it("opens the edit form filled in, and its own project is not taken", async () => {
    await renderBrowser();
    await userEvent.click(folder("Edit 0017-AMP-5000 Refresh"));
    const dialog = await screen.findByRole("dialog", { name: /edit project folder/i });
    expect(within(dialog).getByLabelText(/folder name/i)).toHaveValue("0017-AMP-5000 Refresh");
    expect(within(dialog).queryByText(/already has a folder/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /save changes/i })).toBeInTheDocument();
  });

  it("renames a folder and shows the new name in the listing", async () => {
    await renderBrowser();
    await userEvent.click(folder("Edit 0017-AMP-5000 Refresh"));
    const dialog = await screen.findByRole("dialog", { name: /edit project folder/i });
    const name = within(dialog).getByLabelText(/folder name/i);
    await userEvent.clear(name);
    await userEvent.type(name, "0017-AMP-5000 Refresh (fixed)");
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^0017-AMP-5000 Refresh \(fixed\)/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("refuses to re-tag onto a project that already has another folder", async () => {
    await renderBrowser();
    await userEvent.click(folder("Edit 0000-Engineering Apps"));
    const dialog = await screen.findByRole("dialog", { name: /edit project folder/i });
    await userEvent.click(within(dialog).getByRole("button", { name: "Project" }));
    await userEvent.click(await screen.findByRole("option", { name: /0017-AMP-5000 Refresh/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));
    expect(await within(dialog).findByText(/already has a folder/i)).toBeInTheDocument();
  });
});
