import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_EIRS } from "@/data/mockData";
import { EirDetailView } from "./EirDetailView";

// Focused on one thing: the Assigned (engineers) field on an EIR is a
// type-to-filter dropdown, not the flat wall of every person in the company
// it used to be. Mirrors the narrow scope of DetailView.projectRef.test.tsx —
// EirDetailView has no broader harness in this repo.

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    displayName: "Demo User",
    email: "demo.user@altronic-llc.com",
    lookupId: 0,
  }),
  useCurrentUserEmails: () => ["demo.user@altronic-llc.com"],
}));

const EIR = MOCK_EIRS.find((e) => e.assignedEngineers.length > 0)!;

async function renderEir(id: number) {
  const result = renderWithProviders(<EirDetailView />, {
    route: `/eir/${id}`,
    routePattern: "/eir/:id",
  });
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  return result;
}

/** The Assigned field's dropdown trigger, scoped to its sidebar row. */
function assignedField(): HTMLElement {
  const label = screen.getByText("Assigned");
  // The sidebar row wraps the label and its control together.
  return label.closest("div")!.parentElement as HTMLElement;
}

describe("EirDetailView — Assigned engineers picker", () => {
  it("shows the engineers already assigned", async () => {
    await renderEir(EIR.id);
    const field = assignedField();
    for (const person of EIR.assignedEngineers) {
      expect(within(field).getByText(person.displayName)).toBeInTheDocument();
    }
  });

  it("opens a dropdown with a search box rather than listing everyone inline", async () => {
    const user = userEvent.setup();
    await renderEir(EIR.id);
    const field = assignedField();

    // Closed: no search box on the page for this field.
    expect(within(field).queryByPlaceholderText(/search people/i)).not.toBeInTheDocument();

    await user.click(within(field).getByRole("button", { name: /add|edit/i }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/search people/i)).toBeInTheDocument(),
    );
  });

  it("filters the list as the user types", async () => {
    const user = userEvent.setup();
    await renderEir(EIR.id);
    const field = assignedField();
    await user.click(within(field).getByRole("button", { name: /add|edit/i }));

    // Only one dropdown is open at a time, so the options on the page are
    // this field's.
    const search = await screen.findByPlaceholderText(/search people/i);
    const before = screen.getAllByRole("option").length;
    expect(before).toBeGreaterThan(1);

    const target = EIR.assignedEngineers[0].displayName;
    await user.type(search, target.split(" ")[0]);

    await waitFor(() => {
      const after = screen.getAllByRole("option");
      expect(after.length).toBeLessThan(before);
      expect(after.some((o) => o.textContent?.includes(target))).toBe(true);
    });
  });
});
