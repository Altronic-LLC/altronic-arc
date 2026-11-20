import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_TASKS } from "@/data/mockData";

// BusinessIT#33 — the edit form shows the task's number beside the title (so
// editing the title can't change it), says what a project change will
// renumber it to, and sends a title change WITH the project move, so the two
// writes never each rebuild NumberedTitle from a different half.

const writes = vi.hoisted(() => ({ calls: [] as Array<{ hook: string; vars: unknown }> }));

vi.mock("@/hooks/useTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useTasks")>();
  const recorder = (hook: string) => () => ({
    mutateAsync: async (vars: unknown) => {
      writes.calls.push({ hook, vars });
      return undefined;
    },
    isPending: false,
  });
  return {
    ...actual,
    useUpdateTaskFields: recorder("fields"),
    useSetParentProject: recorder("project"),
    useSetParentTask: recorder("parentTask"),
    useSetRelatedProjects: recorder("related"),
    useSetAssigned: recorder("assigned"),
    useSetWatchers: recorder("watchers"),
  };
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
}));

import { TaskFormModal } from "./TaskFormModal";

// "T48-0003-Missing Comments in the Task", in 0003-Engineering Task List.
const task = MOCK_TASKS.find((t) => t.numberedTitle.startsWith("T48-0003-"))!;

async function open() {
  renderWithProviders(<TaskFormModal mode="edit" task={task} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument());
}

async function pickProject(title: string) {
  // The Parent Project picker, once the projects have loaded into it.
  const trigger = await waitFor(() => {
    const found = screen
      .getAllByRole("button")
      .find(
        (b) =>
          b.getAttribute("aria-haspopup") === "listbox" &&
          b.textContent?.trim() === "0003-Engineering Task List",
      );
    expect(found).toBeDefined();
    return found!;
  });
  await userEvent.click(trigger);
  const listbox = await screen.findByRole("listbox");
  await userEvent.click(within(listbox).getByRole("option", { name: title }));
}

describe("TaskFormModal — editing a task's number (BusinessIT#33)", () => {
  beforeEach(() => {
    writes.calls = [];
  });

  it("shows the number beside the title, outside the editable box", async () => {
    await open();
    expect(screen.getByTestId("numbered-title-prefix")).toHaveTextContent("T48-0003-");
    expect(screen.getByDisplayValue(task.title)).toBeInTheDocument();
  });

  it("says what a project change will renumber the task to", async () => {
    await open();
    await pickProject("0017-AMP-5000 Refresh");

    const note = await screen.findByRole("status");
    expect(note).toHaveTextContent(task.numberedTitle);
    expect(note).toHaveTextContent(/T\d+-0017-Missing Comments in the Task/);
    expect(screen.getByTestId("numbered-title-prefix").textContent).toMatch(/^T\d+-0017-$/);
  });

  it("sends a title change WITH the project move, not as a separate Title write", async () => {
    await open();
    const titleBox = screen.getByDisplayValue(task.title);
    await userEvent.clear(titleBox);
    await userEvent.type(titleBox, "Comments go missing");
    await pickProject("0017-AMP-5000 Refresh");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(writes.calls.some((c) => c.hook === "project")).toBe(true));
    expect(writes.calls.find((c) => c.hook === "project")!.vars).toEqual({
      id: task.id,
      projectLookupId: 501,
      title: "Comments go missing",
    });
    expect(
      writes.calls.some(
        (c) => c.hook === "fields" && "Title" in ((c.vars as { fields: object }).fields ?? {}),
      ),
    ).toBe(false);
  });

  it("a title-only edit still goes through the fields write", async () => {
    await open();
    const titleBox = screen.getByDisplayValue(task.title);
    await userEvent.clear(titleBox);
    await userEvent.type(titleBox, "Comments go missing");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(writes.calls.length).toBeGreaterThan(0));
    expect(writes.calls).toEqual([
      { hook: "fields", vars: { id: task.id, fields: { Title: "Comments go missing" } } },
    ]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
