import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_PROJECTS, MOCK_TASKS } from "@/data/mockData";
import { DetailView } from "./DetailView";

// Related Projects used to render EVERY project as its own pill behind a
// "+ Add related project" disclosure — unusable once the Projects list is
// longer than a screen. These pin the replacement: a searchable dropdown,
// which also gives the field a way to REMOVE a project (the pill cloud only
// ever added, since selected projects were filtered out of the candidates).

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
}));

async function renderTask(id: number) {
  const result = renderWithProviders(<DetailView />, {
    route: `/task/${id}`,
    routePattern: "/task/:id",
  });
  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument(),
  );
  return result;
}

/** The whole Related Projects block in the sidebar, found via its label. */
function relatedProjectsField(): HTMLElement {
  return screen.getByText("Related Projects").parentElement as HTMLElement;
}

/**
 * The picker's trigger, once the Projects query has landed. The task heading
 * renders before that query resolves and the field renders nothing until it
 * does, so querying straight after the heading appears is a race — it passed
 * locally and failed in CI.
 */
async function pickerTrigger(): Promise<HTMLButtonElement> {
  return waitFor(() => {
    const trigger = relatedProjectsField().querySelector<HTMLButtonElement>(
      '[aria-haspopup="listbox"]',
    );
    expect(trigger).not.toBeNull();
    return trigger!;
  });
}

/** Open the picker and return its option panel. */
async function openPicker(): Promise<HTMLElement> {
  await userEvent.click(await pickerTrigger());
  return screen.getByRole("listbox");
}

const taskWithProject = () => MOCK_TASKS.find((t) => t.parentProject !== null)!;

describe("DetailView — Related Projects picker", () => {
  it("offers the projects behind a search box, not a wall of pills", async () => {
    await renderTask(taskWithProject().id);

    // A dropdown that lists nothing until it's opened…
    await pickerTrigger();
    // …in place of the old "+ Add related project" pill cloud.
    expect(relatedProjectsField().querySelector("summary")).toBeNull();

    const panel = await openPicker();
    expect(
      within(panel).getByPlaceholderText("Search projects…"),
    ).toBeInTheDocument();
  });

  it("narrows the options as you type", async () => {
    await renderTask(taskWithProject().id);
    const panel = await openPicker();

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

  it("leaves the parent project out of the options", async () => {
    const task = taskWithProject();
    await renderTask(task.id);
    const panel = await openPicker();

    expect(
      within(panel).queryByRole("option", { name: task.parentProject!.title }),
    ).toBeNull();

    const other = MOCK_PROJECTS.find(
      (p) => p.lookupId !== task.parentProject!.lookupId,
    )!;
    expect(
      within(panel).getByRole("option", { name: other.title }),
    ).toBeInTheDocument();
  });

  it("ticks the projects already on the task", async () => {
    const task = MOCK_TASKS.find(
      (t) => t.relatedProjects.length > 0 && t.parentProject !== null,
    );
    if (!task) return; // no fixture with related projects — nothing to assert
    await renderTask(task.id);
    const panel = await openPicker();

    expect(
      within(panel).getByRole("option", { name: task.relatedProjects[0].title }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the selected projects as chips that open the project", async () => {
    const task = MOCK_TASKS.find((t) => t.relatedProjects.length > 0);
    if (!task) return;
    await renderTask(task.id);

    const field = relatedProjectsField();
    // The chip is a plain button (the dropdown trigger carries aria-haspopup).
    const chips = within(field)
      .getAllByRole("button", { name: task.relatedProjects[0].title })
      .filter((b) => !b.hasAttribute("aria-haspopup"));
    expect(chips.length).toBeGreaterThan(0);
  });
});
