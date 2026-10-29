import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { PanelTask, PanelTimeOff, Person } from "@/types/task";

// The view's wiring over the pure rules (lib/panelCapacity.test.ts has the
// maths). The clock is pinned: the grid opens on the current week.

const ANA: Person = { displayName: "Ana Engineer", email: "ana@example.com", lookupId: 1 };
const BOB: Person = { displayName: "Bob Builder", email: "bob@example.com", lookupId: 2 };
const d = (k: string) => new Date(`${k}T12:00:00Z`);
const BASE_ACCESS = {
  canOpen: true,
  canEdit: true,
  canManageTemplates: false,
  templatesHint: "",
  canManageCapacity: false,
  capacityHint: "",
  resolving: false,
  hint: "",
};

const state = vi.hoisted(() => ({
  tasks: [] as PanelTask[],
  timeOff: [] as PanelTimeOff[],
  access: {
    canOpen: true,
    canEdit: true,
    canManageTemplates: false,
    templatesHint: "",
    canManageCapacity: false,
    capacityHint: "",
    resolving: false,
    hint: "",
  },
  roles: [] as Array<{ id: number; user: Person; role: string; note: string }>,
}));

const scheduleMutate = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/usePanelTasks", () => ({
  usePanelTasks: () => ({ data: state.tasks, isLoading: false, error: null }),
  useSavePanelTaskPlan: () => ({ mutateAsync: scheduleMutate }),
}));
vi.mock("@/hooks/usePanelTimeOff", () => ({
  usePanelTimeOff: () => ({ data: state.timeOff, isLoading: false, error: null }),
}));
vi.mock("@/hooks/usePanelRoles", () => ({
  usePanelRoles: () => ({ data: state.roles }),
  usePanelTeamAccess: () => state.access,
  useRequirePanelCapacityManager: () => async () => {},
}));

import { PanelCapacityView } from "./PanelCapacityView";
import { resetPanelSettingsMockStore } from "@/api/panelSettings";

function task(over: Partial<PanelTask> & { id: number }): PanelTask {
  return {
    title: `Task ${over.id}`,
    status: "In Progress",
    taskType: null,
    workType: null,
    priority: null,
    projectRef: null,
    orderRef: null,
    assigned: [ANA],
    description: "",
    startDate: d("2026-11-02"),
    dueDate: d("2026-11-03"),
    estimatedHours: 20,
    watchers: [],
    comments: [],
    hasAttachments: false,
    createdAt: d("2026-10-01"),
    modifiedAt: d("2026-10-01"),
    author: null,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T15:00:00")); // a Wednesday
  resetPanelSettingsMockStore();
  state.access = { ...BASE_ACCESS };
  state.roles = [
    { id: 1, user: ANA, role: "Engineer", note: "" },
    { id: 2, user: BOB, role: "Engineer", note: "" },
  ];
  state.timeOff = [];
  state.tasks = [
    task({ id: 1, title: "Enclosure drawing" }), // 10h a day Mon–Tue: red
    task({ id: 2, title: "Write SOO", assigned: [BOB], estimatedHours: 6 }), // 3h a day
    task({ id: 3, title: "Quote rebuild", assigned: [] }),
  ];
});
afterEach(() => vi.useRealTimers());

describe("PanelCapacityView", () => {
  it("shows a row per person, over-capacity days in words, and opens on this week", () => {
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity" });
    expect(screen.getByText("Nov 2, 2026 – Nov 15, 2026")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Ana Engineer, Monday, Nov 2: 10h of 8h, over capacity/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Bob Builder, Monday, Nov 2: 3h of 8h, within capacity/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 person is over capacity in these weeks.")).toBeInTheDocument();
  });

  it("lists the tasks behind a cell when it's clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity" });
    await user.click(screen.getByRole("button", { name: /Ana Engineer, Monday, Nov 2/ }));
    const detail = screen.getByRole("region", { name: "Tasks behind the selected cell" });
    expect(within(detail).getByRole("link", { name: "Enclosure drawing" })).toHaveAttribute(
      "href",
      "/panels/task/1",
    );
  });

  it("puts a task it can't place in the backlog with the reason", () => {
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity" });
    const backlog = screen.getByRole("region", { name: /Backlog/ });
    expect(within(backlog).getByText("Quote rebuild")).toBeInTheDocument();
    expect(within(backlog).getByText("Nobody assigned")).toBeInTheDocument();
  });

  it("shows a whole day off and moves the hours around it", () => {
    state.timeOff = [
      { id: 1, person: ANA, reason: "", startDate: d("2026-11-02"), endDate: d("2026-11-02"), hoursPerDay: null, companyHoliday: false },
    ];
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity" });
    expect(screen.getByRole("button", { name: /Ana Engineer, Monday, Nov 2: 0h of 0h, nothing scheduled, off/ })).toHaveTextContent("Off");
    expect(screen.getByRole("button", { name: /Ana Engineer, Tuesday, Nov 3: 20h of 8h/ })).toBeInTheDocument();
  });

  it("sums weeks in week view, from the URL", () => {
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity?view=week" });
    expect(
      screen.getByRole("button", { name: /Ana Engineer, week of Nov 2: 20h of 40h, over capacity/ }),
    ).toBeInTheDocument();
  });

  it("expands a person into their task bars", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity" });
    expect(screen.queryByRole("link", { name: /Write SOO/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Bob Builder/, expanded: false }));
    expect(screen.getByRole("link", { name: "Write SOO, 3h a day" })).toHaveAttribute("href", "/panels/task/2");
  });

  it("gives a team member drag handles on the bars", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity" });
    await user.click(screen.getByRole("button", { name: /Bob Builder/, expanded: false }));
    expect(screen.getByTestId("bar-end-panelTask:2")).toBeInTheDocument();
  });

  it("gives a Viewer no drag handles", async () => {
    state.access = { ...BASE_ACCESS, canEdit: false, hint: "Viewers can look." };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity" });
    await user.click(screen.getByRole("button", { name: /Bob Builder/, expanded: false }));
    expect(screen.getByTestId("bar-panelTask:2")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-end-panelTask:2")).not.toBeInTheDocument();
  });

  it("keeps out anybody not on the panel team", () => {
    state.access = { ...BASE_ACCESS, canOpen: false, canEdit: false, hint: "Ask an ARC admin." };
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity" });
    expect(screen.getByText("Panel team only")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("gives only Engineers a row; anyone else's work waits in the backlog, saying why", () => {
    state.roles = [{ id: 1, user: ANA, role: "Engineer", note: "" }];
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity" });
    expect(screen.queryByRole("button", { name: /Bob Builder, Monday/ })).not.toBeInTheDocument();
    const backlog = screen.getByRole("region", { name: /Backlog/ });
    expect(within(backlog).getByText("Write SOO")).toBeInTheDocument();
    expect(
      within(backlog).getByText("Assigned to Bob Builder, who isn't an Engineer on Panel User Roles"),
    ).toBeInTheDocument();
  });

  it("splits a task's hours between its assignees", () => {
    state.tasks = [task({ id: 9, title: "Shared drawing", assigned: [ANA, BOB], estimatedHours: 20 })];
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity" });
    // 20h over Mon–Tue, split two ways: 5h a day each.
    expect(screen.getByRole("button", { name: /Ana Engineer, Monday, Nov 2: 5h of 8h/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bob Builder, Monday, Nov 2: 5h of 8h/ })).toBeInTheDocument();
  });

  it("takes a company holiday off everyone", () => {
    state.timeOff = [
      {
        id: 1,
        person: null,
        reason: "Plant shutdown",
        startDate: d("2026-11-02"),
        endDate: d("2026-11-02"),
        hoursPerDay: null,
        companyHoliday: true,
      },
    ];
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity" });
    for (const who of ["Ana Engineer", "Bob Builder"]) {
      expect(screen.getByRole("button", { name: new RegExp(`${who}, Monday, Nov 2: 0h of 0h, nothing scheduled, off`) })).toBeInTheDocument();
    }
  });

  it("shows the amber threshold, and lets only a Super User or ARC admin change it", () => {
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity" });
    expect(screen.getByText(/Amber above 85%/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  });

  it("offers a Super User the amber threshold to change", async () => {
    state.access = { ...BASE_ACCESS, canManageCapacity: true };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<PanelCapacityView />, { route: "/panels/capacity" });
    await user.click(screen.getByRole("button", { name: "Change" }));
    const box = screen.getByRole("textbox", { name: "Amber threshold percent" });
    await user.clear(box);
    await user.type(box, "40");
    expect(screen.getByText(/whole percentage from 50 to 100/)).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "90");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Amber above 90%/)).toBeInTheDocument();
  });
});
