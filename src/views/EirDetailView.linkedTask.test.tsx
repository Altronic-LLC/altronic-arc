import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS } from "@/data/mockData";
import type { Task } from "@/types/task";
import { updateEirFields } from "@/api/eirs";
import { EirDetailView } from "./EirDetailView";

// The Linked Task card must never GUESS between tasks that share a T-number.
// Task numbers restart in every project, so "T115" can be several tasks; the
// old prefix-only match linked whichever came first, which is how
// EIR_2026-0270 showed the wrong task (reported 2026-10-08).

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

vi.mock("@/hooks/useEirRoles", () => ({
  useMyEirRoles: () => ({ isEngineer: true, isSupplyChain: true, enforced: false }),
}));

// Two tasks numbered T115, in different projects — the shape that broke.
function task(id: number, numberedTitle: string, status: string): Task {
  return { id, numberedTitle, title: numberedTitle, status, assigned: [], watchers: [] } as unknown as Task;
}
const T115_A = task(9001, "T115-0017-AMP-5000 bracket", "In Progress");
const T115_B = task(9002, "T115-0335-Jenbacher harness", "BACKLOG");
let tasks: Task[] = [T115_A, T115_B];

vi.mock("@/hooks/useTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useTasks")>();
  return { ...actual, useTasks: () => ({ data: tasks, isLoading: false, error: null }) };
});

const writes = vi.hoisted(() => [] as Array<{ id: number; fields: Record<string, unknown> }>);
vi.mock("@/api/eirs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/eirs")>();
  return {
    ...actual,
    updateEirFields: (id: number, fields: Record<string, unknown>) => {
      writes.push({ id, fields });
      return actual.updateEirFields(id, fields);
    },
  };
});

// MOCK_EIRS[0] carries the short reference "T115".
const EIR = MOCK_EIRS[0];

async function renderEir() {
  renderWithProviders(<EirDetailView />, { route: `/eir/${EIR.id}`, routePattern: "/eir/:id" });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  return screen.getByText("Linked Task").closest("div")!.parentElement as HTMLElement;
}

describe("EirDetailView — Linked Task never guesses between repeated T-numbers", () => {
  beforeEach(() => {
    tasks = [T115_A, T115_B];
    writes.length = 0;
  });

  // The mock EIR store is module state: a test that SAVES a reference would
  // otherwise leak it into the next one.
  afterEach(async () => {
    await updateEirFields(EIR.id, { TaskReference: "T115" });
  });

  it("links nothing for an ambiguous reference, and offers every match", async () => {
    expect(EIR.taskReference).toBe("T115");
    const card = await renderEir();
    expect(within(card).getByText(/matches 2 tasks/i)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "T115-0017-AMP-5000 bracket" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "T115-0335-Jenbacher harness" })).toBeInTheDocument();
  });

  it("picking one saves that task's FULL numbered title, so the link is exact", async () => {
    const card = await renderEir();
    await userEvent.click(within(card).getByRole("button", { name: "T115-0335-Jenbacher harness" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ id: EIR.id, fields: { TaskReference: "T115-0335-Jenbacher harness" } });
  });

  it("links straight to the task when only one carries the number", async () => {
    tasks = [T115_A];
    const card = await renderEir();
    expect(within(card).queryByText(/matches \d+ tasks/i)).toBeNull();
    expect(within(card).getByText("T115-0017-AMP-5000 bracket")).toBeInTheDocument();
  });

  // The reported case: a promoted EIR stores the FULL title, and the card must
  // show THAT task — not the first task sharing its T-number.
  it("shows the exact task a promoted EIR stored, not another with the same T-number", async () => {
    await updateEirFields(EIR.id, { TaskReference: "T115-0335-Jenbacher harness" });
    const card = await renderEir();
    expect(within(card).getByText("T115-0335-Jenbacher harness")).toBeInTheDocument();
    expect(within(card).queryByText("T115-0017-AMP-5000 bracket")).toBeNull();
  });
});
