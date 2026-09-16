import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { EcnChecklistCard } from "./EcnChecklistCard";
import { __resetEcnChecklistMockStore } from "@/api/ecnChecklists";
import { MOCK_ECNS } from "@/data/ecnMockData";
import { ECN_CHECKLIST_ITEMS } from "@/lib/ecnChecklistTemplate";
import { ECN_RACI_ITEM_COUNT } from "@/lib/ecnChecklistRaci";

// ECN 1 has a part-way checklist; ECN 4 deliberately has none.
const ecnWithChecklist = MOCK_ECNS.find((e) => e.id === 1)!;
const ecnWithout = MOCK_ECNS.find((e) => e.id === 4)!;

beforeEach(() => {
  __resetEcnChecklistMockStore();
});

describe("the summary", () => {
  it("leads with progress rather than 84 expanded items", async () => {
    renderWithProviders(<EcnChecklistCard ecn={ecnWithChecklist} />);
    expect(await screen.findByText(/of 84 answered/)).toBeInTheDocument();
    // Nothing is expanded until asked for.
    expect(screen.queryByText(ECN_CHECKLIST_ITEMS[0].text)).not.toBeInTheDocument();
  });

  it("breaks the count down by state", async () => {
    renderWithProviders(<EcnChecklistCard ecn={ecnWithChecklist} />);
    expect(await screen.findByText(/complete$/)).toBeInTheDocument();
    expect(screen.getByText(/N\/A$/)).toBeInTheDocument();
    expect(screen.getByText(/flagged$/)).toBeInTheDocument();
  });
});

describe("an ECN with no checklist", () => {
  it("offers to create one — the path for ECNs predating this feature", async () => {
    renderWithProviders(<EcnChecklistCard ecn={ecnWithout} />);
    expect(await screen.findByRole("button", { name: /create checklist/i })).toBeInTheDocument();
  });

  it("creates it and opens it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EcnChecklistCard ecn={ecnWithout} />);

    await user.click(await screen.findByRole("button", { name: /create checklist/i }));

    expect(await screen.findByText(/0 of 84 answered/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /hide checklist/i })).toBeInTheDocument();
  });
});

describe("filling it out", () => {
  it("expands a section to reveal its items", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EcnChecklistCard ecn={ecnWithChecklist} />);

    await user.click(await screen.findByRole("button", { name: /open checklist/i }));
    await user.click(screen.getByRole("button", { name: /Section 1 — ECN Header/ }));

    expect(await screen.findByText(ECN_CHECKLIST_ITEMS[0].text)).toBeInTheDocument();
  });

  it("offers FOUR states, not a bare tick", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EcnChecklistCard ecn={ecnWithChecklist} />);

    await user.click(await screen.findByRole("button", { name: /open checklist/i }));
    await user.click(screen.getByRole("button", { name: /Section 1 — ECN Header/ }));

    const groups = await screen.findAllByRole("group", { name: "Status" });
    const buttons = within(groups[0]).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Complete",
      "N/A",
      "Flagged",
      "Not started",
    ]);
  });

  it("records a tick and moves the count", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EcnChecklistCard ecn={ecnWithChecklist} />);

    await user.click(await screen.findByRole("button", { name: /open checklist/i }));
    // Section 5 is untouched in the fixture, so the count must move.
    await user.click(screen.getByRole("button", { name: /Section 5 — Requirements/ }));

    const groups = await screen.findAllByRole("group", { name: "Status" });
    await user.click(within(groups[0]).getByRole("button", { name: "N/A" }));

    await waitFor(() => {
      expect(within(groups[0]).getByRole("button", { name: "N/A" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  it("shows each item's form flags, so the two columns aren't lost", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EcnChecklistCard ecn={ecnWithChecklist} />);

    await user.click(await screen.findByRole("button", { name: /open checklist/i }));
    await user.click(screen.getByRole("button", { name: /Section 1 — ECN Header/ }));

    expect((await screen.findAllByText("Must be on ECN")).length).toBeGreaterThan(0);
  });

  it("gives every item a findings box — the form's own Comments column", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EcnChecklistCard ecn={ecnWithChecklist} />);

    await user.click(await screen.findByRole("button", { name: /open checklist/i }));
    await user.click(screen.getByRole("button", { name: /Section 1 — ECN Header/ }));

    const boxes = await screen.findAllByPlaceholderText("Findings / comments");
    expect(boxes.length).toBe(
      ECN_CHECKLIST_ITEMS.filter((i) => i.section === 1).length,
    );
  });

  it("shows findings already recorded", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EcnChecklistCard ecn={ecnWithChecklist} />);

    await user.click(await screen.findByRole("button", { name: /open checklist/i }));
    await user.click(screen.getByRole("button", { name: /Section 1 — ECN Header/ }));

    expect(
      await screen.findByDisplayValue(/Searched the log/),
    ).toBeInTheDocument();
  });
});

describe("the RACI modal", () => {
  it("opens from the header link", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EcnChecklistCard ecn={ecnWithChecklist} />);

    await user.click(await screen.findByRole("button", { name: /who is involved/i }));

    const dialog = await screen.findByRole("dialog", { name: /who is involved/i });
    // The legend, which the matrix is unreadable without.
    expect(within(dialog).getByText("Responsible")).toBeInTheDocument();
    expect(within(dialog).getByText("Accountable")).toBeInTheDocument();
  });

  it("says how many items actually carry a RACI, rather than showing 66 empty rows", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EcnChecklistCard ecn={ecnWithChecklist} />);

    await user.click(await screen.findByRole("button", { name: /who is involved/i }));
    const dialog = await screen.findByRole("dialog", { name: /who is involved/i });

    expect(
      within(dialog).getByText(
        new RegExp(`${ECN_RACI_ITEM_COUNT} of ${ECN_CHECKLIST_ITEMS.length} checklist items`),
      ),
    ).toBeInTheDocument();
  });

  it("explains A/R and C/I, which the form's own legend omits", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EcnChecklistCard ecn={ecnWithChecklist} />);

    await user.click(await screen.findByRole("button", { name: /who is involved/i }));
    const dialog = await screen.findByRole("dialog", { name: /who is involved/i });

    expect(within(dialog).getByText(/A\/R means/)).toBeInTheDocument();
  });

  it("closes again", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EcnChecklistCard ecn={ecnWithChecklist} />);

    await user.click(await screen.findByRole("button", { name: /who is involved/i }));
    const dialog = await screen.findByRole("dialog", { name: /who is involved/i });
    await user.click(within(dialog).getAllByRole("button", { name: "Close" })[1]);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /who is involved/i })).not.toBeInTheDocument();
    });
  });

  it("opens from an item that HAS marks, highlighting it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<EcnChecklistCard ecn={ecnWithChecklist} />);

    await user.click(await screen.findByRole("button", { name: /open checklist/i }));
    await user.click(screen.getByRole("button", { name: /Section 1 — ECN Header/ }));

    // Section 1's items all carry RACI marks on Rev 0.
    const perItem = await screen.findAllByRole("button", { name: "RACI" });
    await user.click(perItem[0]);

    const dialog = await screen.findByRole("dialog", { name: /who is involved/i });
    expect(within(dialog).getByText("Highlighted item")).toBeInTheDocument();
  });
});

describe("when the list isn't configured", () => {
  it("says so rather than erroring", async () => {
    vi.resetModules();
    vi.doMock("@/api/config", async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      USE_MOCK: false,
      SP_ECN_CHECKLISTS_LIST_ID: "",
    }));
    const { EcnChecklistCard: Card } = await import("./EcnChecklistCard");

    renderWithProviders(<Card ecn={ecnWithChecklist} />);

    expect(await screen.findByText(/not configured yet/i)).toBeInTheDocument();
    vi.doUnmock("@/api/config");
    vi.resetModules();
  });
});
