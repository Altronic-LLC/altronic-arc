import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_PROJECTS } from "@/data/mockData";
import { TaskFormModal } from "./TaskFormModal";

// The form's Related Projects field was a bespoke checkbox panel with NO
// search — the one picker in the modal that CLAUDE.md's "every dropdown in a
// form is searchable" rule had missed. It now uses the shared MultiSelect, so
// these pin the search box and the chips that come with it.

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

/** Renders the create form and returns the Related Projects field, once the
 *  Projects query has landed (before that the field says "No projects"). */
async function openCreateForm() {
  renderWithProviders(<TaskFormModal mode="create" onClose={vi.fn()} />);
  const field = await waitFor(() => {
    const label = screen
      .getByText("Related Projects")
      .closest("label") as HTMLElement;
    expect(label.querySelector('[aria-haspopup="listbox"]')).not.toBeNull();
    return label;
  });
  return field;
}

describe("TaskFormModal — Related Projects", () => {
  it("is a searchable dropdown", async () => {
    const field = await openCreateForm();

    await userEvent.click(
      field.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!,
    );

    const panel = screen.getByRole("listbox");
    expect(
      within(panel).getByPlaceholderText("Search projects…"),
    ).toBeInTheDocument();
  });

  it("narrows the options as you type", async () => {
    const field = await openCreateForm();
    await userEvent.click(
      field.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!,
    );
    const panel = screen.getByRole("listbox");

    await userEvent.type(
      within(panel).getByPlaceholderText("Search projects…"),
      "Telemetry",
    );

    expect(
      within(panel).getByRole("option", { name: /CleanBurn Telemetry/ }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("option", { name: /Field Trial Tooling/ }),
    ).toBeNull();
  });

  it("shows each pick as a removable chip", async () => {
    const field = await openCreateForm();
    await userEvent.click(
      field.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!,
    );

    const project = MOCK_PROJECTS[1];
    await userEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: project.title,
      }),
    );

    expect(
      within(field).getByRole("button", { name: `Remove ${project.title}` }),
    ).toBeInTheDocument();
  });
});
