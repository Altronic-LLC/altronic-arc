import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS } from "@/data/mockData";
import { EIR_WORKFLOW_HINT } from "@/lib/eirWorkflowEditors";
import { EirDetailView } from "./EirDetailView";

// BusinessIT#45: an EIR's Status and Assigned engineers are editable only by
// the workflow editors (Glenn, Brandon, Sheila, Ray). Everybody else sees the
// values, read-only, with a padlock and the reason.

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

const access = vi.hoisted(() => ({ canEdit: true }));
vi.mock("@/hooks/useEirWorkflowAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useEirWorkflowAccess")>()),
  useCanEditEirWorkflow: () => access.canEdit,
}));

const EIR = MOCK_EIRS.find((e) => e.assignedEngineers.length > 0)!;

async function renderEir() {
  renderWithProviders(<EirDetailView />, {
    route: `/eir/${EIR.id}`,
    routePattern: "/eir/:id",
  });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
}

/** A sidebar row: the label and its control share a parent. */
function sidebarRow(label: string): HTMLElement {
  return screen.getByText(label, { selector: "span, label, div" }).closest("div")!
    .parentElement as HTMLElement;
}

function statusSelect(): HTMLSelectElement {
  return screen.getAllByRole("combobox").find((el) =>
    Array.from((el as HTMLSelectElement).options).some((o) => o.value === "Closed"),
  ) as HTMLSelectElement;
}

beforeEach(() => {
  access.canEdit = true;
});

describe("EirDetailView — Status and Assigned are gated", () => {
  it("lets a workflow editor change both", async () => {
    await renderEir();
    expect(statusSelect()).toBeEnabled();
    const assigned = sidebarRow("Assigned");
    expect(within(assigned).getByRole("button", { name: /add|edit/i })).toBeInTheDocument();
    expect(within(assigned).queryByLabelText("Locked")).not.toBeInTheDocument();
  });

  it("locks Status for anybody else, saying who can change it", async () => {
    access.canEdit = false;
    await renderEir();
    const select = statusSelect();
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute("title", EIR_WORKFLOW_HINT);
    expect(select.value).toBe(EIR.status);
  });

  it("shows the assigned engineers read-only for anybody else", async () => {
    access.canEdit = false;
    await renderEir();
    const assigned = sidebarRow("Assigned");
    expect(within(assigned).getByLabelText("Locked")).toBeInTheDocument();
    for (const person of EIR.assignedEngineers) {
      expect(within(assigned).getByText(person.displayName)).toBeInTheDocument();
    }
    expect(within(assigned).queryByRole("button", { name: /add|edit/i })).not.toBeInTheDocument();
  });
});
