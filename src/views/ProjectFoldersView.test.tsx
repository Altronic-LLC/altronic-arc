import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { ProjectFoldersView } from "./ProjectFoldersView";

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

async function renderBrowser() {
  const result = renderWithProviders(<ProjectFoldersView />, {
    route: "/project-folders",
    routePattern: "/project-folders",
  });
  await waitFor(() =>
    expect(screen.getByText("0017-AMP-5000 Refresh")).toBeInTheDocument(),
  );
  return result;
}

describe("ProjectFoldersView", () => {
  it("lists the top-level project folders", async () => {
    await renderBrowser();
    expect(screen.getByText("Miscellaneous")).toBeInTheDocument();
  });

  // Only top-level folders carry the Project Reference tag, so creating one is
  // only meaningful at the root — inside a folder the action is Upload.
  it("offers New project folder at the root, and Upload inside a folder", async () => {
    await renderBrowser();
    expect(screen.getByRole("button", { name: /new project folder/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upload file/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("0017-AMP-5000 Refresh"));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /upload file/i })).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /new project folder/i }),
    ).not.toBeInTheDocument();
  });

  it("opens the new-folder form", async () => {
    await renderBrowser();
    await userEvent.click(screen.getByRole("button", { name: /new project folder/i }));
    expect(
      await screen.findByRole("dialog", { name: /new project folder/i }),
    ).toBeInTheDocument();
  });

  it("creates a folder and shows it in the listing", async () => {
    await renderBrowser();
    await userEvent.click(screen.getByRole("button", { name: /new project folder/i }));
    const dialog = await screen.findByRole("dialog", { name: /new project folder/i });

    await userEvent.click(screen.getByRole("button", { name: "Project" }));
    await userEvent.click(await screen.findByRole("option", { name: /0021-CleanBurn Telemetry/ }));
    await userEvent.click(
      within(dialog).getByRole("button", { name: /create folder/i }),
    );

    // The row shows the folder name and, beneath it, the linked project's
    // title — same text twice — so match the row's button rather than the text.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /0021-CleanBurn Telemetry/ }),
      ).toBeInTheDocument(),
    );
  });
});
