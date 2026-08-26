import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS, MOCK_PROJECTS } from "@/data/mockData";
import { PromoteEirModal } from "./PromoteEirModal";

// =============================================================================
// A promoted task's number is T{n}-{project code}-{title}. With no project
// chosen, that silently fell back to "0000" — indistinguishable from a real
// project that happens to be numbered 0000, and exactly what New Task already
// requires a project to prevent. Reported 2026-08-26: EIR_2026-0069 promoted
// to "T3-0000-…" because nothing forced a project pick first.
// =============================================================================

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({ accounts: [], instance: {} }),
}));

const TASKS_KEY = ["tasks", "list"] as const;
const PROJECTS_KEY = ["projects"] as const;

function renderModal(eirId: number) {
  const eir = MOCK_EIRS.find((e) => e.id === eirId)!;
  return renderWithProviders(
    <PromoteEirModal eir={eir} onClose={vi.fn()} />,
    {
      seedQueryData: [
        { key: TASKS_KEY, data: [] },
        { key: PROJECTS_KEY, data: MOCK_PROJECTS },
      ],
    },
  );
}

describe("PromoteEirModal — project is required", () => {
  it("keeps Create task disabled when the EIR has no project and none is picked", async () => {
    // EIR_2026-0057 (id 5) has parentProjects: [].
    renderModal(5);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /create task/i })).toBeDisabled(),
    );
  });

  it("enables Create task once a project is picked", async () => {
    renderModal(5);
    const createButton = await screen.findByRole("button", { name: /create task/i });
    expect(createButton).toBeDisabled();

    await userEvent.click(screen.getByText("Select a project…"));
    await userEvent.click(await screen.findByText(MOCK_PROJECTS[0].title));

    expect(createButton).not.toBeDisabled();
  });

  it("defaults to the EIR's own project and starts enabled", async () => {
    // EIR_2026-0042 (id 1) has parentProjects: [0017-AMP-5000 Refresh].
    renderModal(1);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /create task/i })).not.toBeDisabled(),
    );
  });
});
