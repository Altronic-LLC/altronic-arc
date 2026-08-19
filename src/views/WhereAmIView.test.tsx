import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { WhereAmIView } from "./WhereAmIView";

// The whole point of this screen is that it renders TWO ways from one route:
// a month grid on a computer, an upcoming agenda on a phone. Both are tested.

const viewport = vi.hoisted(() => ({ gridAvailable: true }));

vi.mock("@/hooks/useIsPhone", () => ({
  useKanbanAvailable: () => viewport.gridAvailable,
  useIsPhone: () => !viewport.gridAvailable,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Ray White",
    email: "ray.white@altronic-llc.com",
    lookupId: 22,
  }),
}));

async function renderCalendar(search = "") {
  const result = renderWithProviders(<WhereAmIView />, {
    route: `/engineering/where-am-i${search}`,
    routePattern: "/engineering/where-am-i",
  });
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Where Am I?", level: 1 })).toBeInTheDocument(),
  );
  return result;
}

beforeEach(() => {
  viewport.gridAvailable = true;
});

describe("WhereAmIView — on a computer", () => {
  it("draws the month grid with today's entries on it", async () => {
    await renderCalendar();
    await screen.findByText("Wed"); // the weekday header row means the grid is up
    // Ray is out twice this week, so the same title appears on two days —
    // which is what a one-row-per-day calendar looks like.
    expect(screen.getAllByText("Ray - in the field, Keystone").length).toBeGreaterThan(0);
    expect(screen.getByText("Sarah - half day vacation (PM)")).toBeInTheDocument();
  });

  it("moves between months", async () => {
    await renderCalendar();
    await screen.findByText("Wed");
    const heading = screen.getByRole("heading", { level: 2 }).textContent;

    await userEvent.click(screen.getByRole("button", { name: /next month/i }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).not.toBe(heading),
    );
  });

  it("opens the add form on the day that was clicked", async () => {
    await renderCalendar();
    await screen.findByText("Wed");

    const addButtons = screen.getAllByRole("button", { name: /^Add to / });
    await userEvent.click(addButtons[0]);

    expect(
      await screen.findByRole("dialog", { name: /add to the calendar/i }),
    ).toBeInTheDocument();
  });

  it("opens an entry for editing, with a way to remove it", async () => {
    await renderCalendar();
    await screen.findByText("Wed");

    await userEvent.click(screen.getByText("Sarah - half day vacation (PM)"));

    const dialog = await screen.findByRole("dialog", { name: /edit calendar entry/i });
    // Plans change, so this list — unlike the record-style ones — has a delete.
    expect(within(dialog).getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });
});

describe("WhereAmIView — on a phone", () => {
  beforeEach(() => {
    viewport.gridAvailable = false;
  });

  it("shows an agenda instead of the grid", async () => {
    await renderCalendar();
    await waitFor(() => expect(screen.getByText("Today")).toBeInTheDocument());
    // No seven-column month grid at phone width.
    expect(screen.queryByText("Wed")).not.toBeInTheDocument();
  });

  it("heads each day with Today / Tomorrow rather than a bare date", async () => {
    await renderCalendar();
    await waitFor(() => expect(screen.getByText("Today")).toBeInTheDocument());
    expect(screen.getByText("Tomorrow")).toBeInTheDocument();
  });

  it("leaves out what has already happened", async () => {
    await renderCalendar();
    await waitFor(() => expect(screen.getByText("Today")).toBeInTheDocument());
    // The fixture has an entry four days ago; the agenda looks forward.
    expect(screen.queryByText("Steven - conference (Houston)")).not.toBeInTheDocument();
  });

  it("still lets you add and edit", async () => {
    await renderCalendar();
    await waitFor(() => expect(screen.getByText("Today")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(
      await screen.findByRole("dialog", { name: /add to the calendar/i }),
    ).toBeInTheDocument();
  });
});

describe("WhereAmIView — searching", () => {
  it("narrows to matching entries", async () => {
    await renderCalendar();
    await screen.findByText("Wed");

    await userEvent.type(screen.getByPlaceholderText(/search names/i), "vacation");

    await waitFor(() =>
      expect(screen.queryByText("Ray - in the field, Keystone")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Sarah - half day vacation (PM)")).toBeInTheDocument();
  });
});
