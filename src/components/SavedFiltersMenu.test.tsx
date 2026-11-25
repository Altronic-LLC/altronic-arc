import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { SavedFiltersMenu } from "./SavedFiltersMenu";
import { TASK_SAVED_FILTER_SPEC } from "@/hooks/useFilters";
import {
  SAVED_FILTERS_STORAGE_KEY,
  readDefaultSavedFilter,
  saveCurrentFilters,
} from "@/hooks/useSavedFilters";

// Mock mode: the signed-in user is demo.user@altronic-llc.com.
const ME = "demo.user%40altronic-llc.com";

function Loc() {
  return <div data-testid="loc">{useLocation().search}</div>;
}

function render(route: string, exclude?: readonly string[]) {
  return renderWithProviders(
    <>
      <SavedFiltersMenu spec={TASK_SAVED_FILTER_SPEC} exclude={exclude} />
      <Loc />
    </>,
    { route },
  );
}

function storedTasks() {
  return JSON.parse(localStorage.getItem(SAVED_FILTERS_STORAGE_KEY) ?? "{}").lists?.tasks ?? [];
}

const search = () => new URLSearchParams(screen.getByTestId("loc").textContent ?? "");

describe("SavedFiltersMenu", () => {
  it("saves what's on screen under a name, with your own address as @me", async () => {
    const user = userEvent.setup();
    render(`/list?assigned=${ME}&status=Blocked&scope=all`);
    await user.click(screen.getByRole("button", { name: "Saved filters" }));
    expect(screen.getByText(/Nothing saved yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save current filters/ }));
    await user.type(screen.getByLabelText("Name for these filters"), "My blocked{Enter}");
    expect(storedTasks()).toEqual([
      expect.objectContaining({ name: "My blocked", query: "assigned=%40me&status=Blocked" }),
    ]);
    // The button now names the saved filter that's on screen.
    expect(screen.getByTitle("Saved filter: My blocked")).toBeInTheDocument();
  });

  it("applies a saved filter, replacing the list's filters and keeping the rest", async () => {
    saveCurrentFilters("tasks", "Everyone's PCB", "assigned=&category=PCB");
    const user = userEvent.setup();
    render(`/list?assigned=${ME}&q=harness&status=Blocked&scope=all`);
    await user.click(screen.getByRole("button", { name: "Saved filters" }));
    await user.click(screen.getByRole("button", { name: "Everyone's PCB" }));
    const p = search();
    expect(p.get("assigned")).toBe("");
    expect(p.get("category")).toBe("PCB");
    expect(p.get("q")).toBeNull();
    expect(p.get("status")).toBeNull();
    expect(p.get("scope")).toBe("all");
    // The panel closes once it's applied.
    expect(screen.queryByRole("dialog", { name: "Saved filters" })).toBeNull();
  });

  it("offers Replace for a name already saved, and updates it in place", async () => {
    saveCurrentFilters("tasks", "Mine", "assigned=%40me");
    const user = userEvent.setup();
    render(`/list?assigned=${ME}&status=Complete`);
    await user.click(screen.getByRole("button", { name: "Saved filters" }));
    await user.click(screen.getByRole("button", { name: /Save current filters/ }));
    await user.type(screen.getByLabelText("Name for these filters"), "mine");
    expect(screen.getByText(/Replaces the saved filter “Mine”/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(storedTasks()).toHaveLength(1);
    expect(storedTasks()[0]).toMatchObject({ name: "mine", query: "assigned=%40me&status=Complete" });
  });

  it("stars one as the list's default, and unstars it", async () => {
    saveCurrentFilters("tasks", "Mine", "assigned=%40me");
    const user = userEvent.setup();
    render("/list?assigned=");
    await user.click(screen.getByRole("button", { name: "Saved filters" }));
    const star = screen.getByRole("button", { name: "Open the list on Mine" });
    await user.click(star);
    expect(readDefaultSavedFilter("tasks")?.name).toBe("Mine");
    const unstar = screen.getByRole("button", { name: "Stop opening the list on Mine" });
    expect(unstar).toHaveAttribute("aria-pressed", "true");
    await user.click(unstar);
    expect(readDefaultSavedFilter("tasks")).toBeNull();
  });

  it("renames and deletes", async () => {
    saveCurrentFilters("tasks", "Mine", "assigned=%40me");
    saveCurrentFilters("tasks", "Blocked", "assigned=&status=Blocked");
    const user = userEvent.setup();
    render("/list?assigned=");
    await user.click(screen.getByRole("button", { name: "Saved filters" }));
    await user.click(screen.getByRole("button", { name: "Rename Mine" }));
    const box = screen.getByLabelText("New name for Mine");
    await user.clear(box);
    await user.type(box, "blocked{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Another saved filter already has that name.");
    await user.clear(box);
    await user.type(box, "My tasks{Enter}");
    expect(storedTasks().map((f: { name: string }) => f.name)).toEqual(["My tasks", "Blocked"]);
    await user.click(screen.getByRole("button", { name: "Delete Blocked" }));
    expect(storedTasks().map((f: { name: string }) => f.name)).toEqual(["My tasks"]);
  });

  it("on a board, saves and compares without the status", async () => {
    saveCurrentFilters("tasks", "Blocked anyone", "assigned=&status=Blocked");
    const user = userEvent.setup();
    render("/kanban?assigned=", ["status"]);
    // The board shows "assigned=" — a match once the status is left out.
    const trigger = screen.getByTitle("Saved filter: Blocked anyone");
    await user.click(trigger);
    const panel = screen.getByRole("dialog", { name: "Saved filters" });
    await user.click(within(panel).getByRole("button", { name: /Save current filters/ }));
    // Starts on the name of the filter on screen, so saving updates it.
    const box = screen.getByLabelText("Name for these filters");
    expect(box).toHaveValue("Blocked anyone");
    await user.clear(box);
    await user.type(box, "Board{Enter}");
    expect(storedTasks().find((f: { name: string }) => f.name === "Board")?.query).toBe("assigned=");
  });
});
