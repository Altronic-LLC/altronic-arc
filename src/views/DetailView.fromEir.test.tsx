import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS, MOCK_TASKS } from "@/data/mockData";
import type { Eir } from "@/types/task";

// =============================================================================
// The task page's "From EIR" button (2026-10-27).
//
// Graph can't write the task's EIRReference Hyperlink column, so no ARC
// promotion ever saved one, and the old Power App wrote a SharePoint FORM
// link the button didn't read. Both now work: a task with no link finds its
// EIR through the EIR's Task Reference, and a form link opens the EIR in ARC
// with its number shown instead of the SharePoint address.
// =============================================================================

const FORM = (id: number) =>
  `https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering/Lists/EIREngineering%20Information%20Request/DispForm.aspx?ID=${id}`;

const UNLINKED = MOCK_TASKS.find((t) => !t.eirReference && t.numberedTitle)!;
const FORM_LINKED = MOCK_TASKS.find((t) => t.id !== UNLINKED.id && !t.eirReference && t.numberedTitle)!;

const eirs: Eir[] = [
  { ...MOCK_EIRS[0], id: 9001, eirNo: "EIR_2026-9001", taskReference: UNLINKED.numberedTitle },
  { ...MOCK_EIRS[0], id: 9002, eirNo: "EIR_2026-9002", taskReference: "" },
];
const tasks = MOCK_TASKS.map((t) =>
  t.id === FORM_LINKED.id ? { ...t, eirReference: { url: FORM(9002), label: FORM(9002) } } : t,
);

vi.mock("@/hooks/useEirs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useEirs")>()),
  useEirs: () => ({ data: eirs, isLoading: false }),
}));
vi.mock("@/hooks/useTasks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useTasks")>();
  return {
    ...real,
    useTasks: () => ({ data: tasks, isLoading: false }),
    useTask: (id: number) => ({ data: tasks.find((t) => t.id === id), isLoading: false }),
  };
});
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ displayName: "Demo User", email: "demo.user@altronic-llc.com", lookupId: 0 }),
}));

import { DetailView } from "./DetailView";

async function renderTask(id: number) {
  renderWithProviders(<DetailView />, { route: `/task/${id}`, routePattern: "/task/:id" });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
}

describe("DetailView — From EIR", () => {
  it("finds the EIR through its Task Reference when the task has no link of its own", async () => {
    await renderTask(UNLINKED.id);
    const pill = screen.getByTitle("Open the EIR this task was promoted from");
    expect(pill).toHaveTextContent("EIR_2026-9001");
  });

  it("reads the old Power App's SharePoint form link, and shows the EIR number", async () => {
    await renderTask(FORM_LINKED.id);
    const pill = screen.getByTitle("Open the EIR this task was promoted from");
    expect(pill).toHaveTextContent("EIR_2026-9002");
    expect(pill).not.toHaveTextContent("DispForm");
  });
});
