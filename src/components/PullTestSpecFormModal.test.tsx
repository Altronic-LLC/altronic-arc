import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MOCK_PULL_SPECS } from "@/data/pullTestMockData";
import { PullTestSpecFormModal } from "./PullTestSpecFormModal";

// =============================================================================
// The pull test spec form: the pulls a test needs at Start / In process /
// End, and starting a new spec from a copy of an existing one (Duplicate).
// =============================================================================

const spec910330 = MOCK_PULL_SPECS.find((s) => s.terminal === "910330")!;
const spec910101 = MOCK_PULL_SPECS.find((s) => s.terminal === "910101" && s.wireGauge === "18")!;

describe("PullTestSpecFormModal", () => {
  it("saves a pull count for each point in the run, blank as the default", async () => {
    const onSave = vi.fn(async () => {});
    renderWithProviders(<PullTestSpecFormModal busy={false} onClose={vi.fn()} onSave={onSave} />);
    const dialog = screen.getByRole("dialog", { name: "Add pull test spec" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Manufacturer" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Terminal part # *" }), "910999");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Wire gauge (AWG) *" }), "20");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Pulls at Start" }), "5");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Pulls at End" }), "4");
    expect(within(dialog).getByText(/A test needs 5 \/ 3 \/ 4 pulls/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: "910999", pullsRequired: { Start: 5, "In process": null, End: 4 } }),
    );
  });

  it("refuses a pull count the test can't hold", async () => {
    const onSave = vi.fn(async () => {});
    renderWithProviders(<PullTestSpecFormModal spec={spec910101} busy={false} onClose={vi.fn()} onSave={onSave} />);
    const dialog = screen.getByRole("dialog", { name: "Edit pull test spec" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Pulls at In process" }), "7");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Pulls at In process must be a whole number from 1 to 5.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Duplicate opens the add form filled from the spec, saved as a NEW active spec", async () => {
    const onSave = vi.fn(async () => {});
    renderWithProviders(
      <PullTestSpecFormModal
        copyFrom={{ ...spec910330, active: false }}
        specs={MOCK_PULL_SPECS}
        busy={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Duplicate pull test spec" });
    expect(within(dialog).getByText(/Copied from 910330 · 22 AWG/)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Terminal part # *" })).toHaveValue("910330");
    expect(within(dialog).getByRole("textbox", { name: "Pulls at Start" })).toHaveValue("5");

    const gauge = within(dialog).getByRole("textbox", { name: "Wire gauge (AWG) *" });
    await userEvent.clear(gauge);
    await userEvent.type(gauge, "20");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        terminal: "910330",
        wireGauge: "20",
        minimumForce: 35,
        unit: "N",
        reference: "DEMO-DS-330",
        pullsRequired: { Start: 5, "In process": 3, End: 5 },
        active: true,
      }),
    );
  });

  it("an existing spec can be picked to start from when adding", async () => {
    renderWithProviders(
      <PullTestSpecFormModal specs={MOCK_PULL_SPECS} busy={false} onClose={vi.fn()} onSave={vi.fn(async () => {})} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Add pull test spec" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Start from an existing spec" }));
    await userEvent.click(await screen.findByRole("option", { name: /^910330 · 22 AWG/ }));
    expect(screen.getByRole("dialog", { name: "Duplicate pull test spec" })).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Minimum pull force" })).toHaveValue("35");
    expect(within(dialog).getByRole("textbox", { name: "Pulls at End" })).toHaveValue("5");
  });

  it("editing offers no copy picker", () => {
    renderWithProviders(
      <PullTestSpecFormModal spec={spec910101} specs={MOCK_PULL_SPECS} busy={false} onClose={vi.fn()} onSave={vi.fn(async () => {})} />,
    );
    expect(screen.queryByRole("button", { name: "Start from an existing spec" })).not.toBeInTheDocument();
  });
});
