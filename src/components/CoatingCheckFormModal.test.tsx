import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { listCoatingChecks, resetCoatingCheckMockStore } from "@/api/coatingChecks";
import { resetCoatingSpecMockStore } from "@/api/coatingSpecs";
import { MOCK_COATING_CHECKS, MOCK_COATING_SPECS } from "@/data/coatingMockData";
import {
  COATING_UNIT_STORAGE_KEY,
  CoatingCheckFormModal,
  coatingSpecOptions,
  combineDateTime,
  rememberedUnit,
} from "./CoatingCheckFormModal";

const adminAccess = vi.hoisted(() => ({ isAdmin: false, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));

beforeEach(() => {
  resetCoatingCheckMockStore();
  resetCoatingSpecMockStore();
  localStorage.removeItem(COATING_UNIT_STORAGE_KEY);
});

describe("coatingSpecOptions", () => {
  it("offers active specs only, with their limits in mm", () => {
    const labels = coatingSpecOptions(MOCK_COATING_SPECS, null).map((o) => o.label);
    expect(labels.some((l) => l.startsWith("Urethane"))).toBe(false);
    expect(labels).toContain("Acrylic — standard — 0.025 – 0.075 mm");
    // An inch spec is offered in inches.
    expect(labels).toContain("Silicone — one side — 0.002 – 0.008 in");
  });

  it("keeps a check's retired spec, and a stand-in for one that has gone", () => {
    const retired = { specId: 3, specName: "Urethane (old line)", minMm: 0.025, maxMm: 0.075, specUnit: "mm" as const, coatedSides: 2 as const };
    expect(coatingSpecOptions(MOCK_COATING_SPECS, retired).some((o) => o.label.endsWith("(retired)"))).toBe(true);
    expect(coatingSpecOptions(MOCK_COATING_SPECS, { ...retired, specId: 99 })[0]).toEqual({
      value: "99",
      label: "Urethane (old line) (no longer on the list)",
    });
  });
});

describe("rememberedUnit", () => {
  it("is millimetres by default, and inches only once this browser chose inches", () => {
    expect(rememberedUnit()).toBe("mm");
    localStorage.setItem(COATING_UNIT_STORAGE_KEY, "in");
    expect(rememberedUnit()).toBe("in");
  });
});

describe("combineDateTime", () => {
  it("builds a LOCAL instant, and refuses what it can't read", () => {
    expect(combineDateTime("2026-11-04", "07:15")?.getHours()).toBe(7);
    expect(combineDateTime("", "07:15")).toBeNull();
    expect(combineDateTime("2026-11-04", "")).toBeNull();
  });
});

async function pickSpec(name: RegExp) {
  await userEvent.click(screen.getByRole("button", { name: "Spec" }));
  await userEvent.click(await screen.findByRole("option", { name }));
}

async function typeReadings(dialog: HTMLElement, side: "Uncoated" | "Coated", values: string[]) {
  for (let i = 0; i < 3; i++) {
    await userEvent.type(within(dialog).getByRole("textbox", { name: `${side} reading ${i + 1}` }), values[i]);
  }
}

describe("CoatingCheckFormModal", () => {
  it("opens with the cursor on the Spec picker and no dropdown open — new and edit alike", async () => {
    const suggestions = ["DEMO-SPRAY-1", "DEMO-SPRAY-2"];
    renderWithProviders(<CoatingCheckFormModal machineSuggestions={suggestions} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "New coating check" });
    expect(within(dialog).getByRole("button", { name: "Spec" })).toHaveFocus();
    expect(within(dialog).queryByText("DEMO-SPRAY-1")).toBeNull();
    expect(within(dialog).getByRole("textbox", { name: "Machine" })).not.toHaveFocus();
    cleanup();

    renderWithProviders(
      <CoatingCheckFormModal check={MOCK_COATING_CHECKS[0]} machineSuggestions={suggestions} onClose={vi.fn()} />,
    );
    const edit = screen.getByRole("dialog", { name: "Edit coating check" });
    expect(within(edit).queryByText("DEMO-SPRAY-2")).toBeNull();
    expect(within(edit).getByRole("textbox", { name: "Machine" })).not.toHaveFocus();
  });

  it("offers every suggestion when Operator is opened on the name filled in for you", async () => {
    renderWithProviders(
      <CoatingCheckFormModal operatorSuggestions={["Floor Op A", "Floor Op B"]} machineSuggestions={["OVEN 3"]} onClose={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Operator" })).not.toHaveValue("");
    await userEvent.click(within(dialog).getByRole("textbox", { name: "Operator" }));
    expect(within(dialog).getByRole("option", { name: "Floor Op A" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Floor Op B" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("textbox", { name: "Machine" }));
    expect(within(dialog).getByRole("option", { name: "OVEN 3" })).toBeInTheDocument();
  });

  it("starts in millimetres, judges mm readings against an INCH spec, and records the check", async () => {
    const onClose = vi.fn();
    renderWithProviders(<CoatingCheckFormModal onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "New coating check" });
    expect(within(dialog).getByRole("radio", { name: "Millimetres" })).toBeChecked();

    await pickSpec(/^Silicone — one side/);
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Machine" }), "SPRAY-2");
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Operator" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Operator" }), "Floor Op");

    await typeReadings(dialog, "Uncoated", ["1.575", "1.577", "1.576"]);
    await typeReadings(dialog, "Coated", ["1.64", "1.642", "1.641"]);
    // The Silicone spec was entered in inches, so it's judged — and shown first — in inches.
    expect(within(dialog).getByText("Coating thickness 0.00256 in (0.065 mm · 2.56 mils)")).toBeInTheDocument();
    expect(within(dialog).getByText("In spec.")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Record check" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const saved = (await listCoatingChecks()).find((c) => c.id > MOCK_COATING_CHECKS.length)!;
    expect(saved).toMatchObject({
      machine: "SPRAY-2",
      operator: "Floor Op",
      unit: "mm",
      specId: 2,
      thicknessMm: 0.065,
      thicknessIn: 0.002559,
      thicknessMils: 2.56,
      specUnit: "in",
      outOfSpec: false,
    });
  });

  it("halves the difference for a both-sides spec and says when it's out", async () => {
    renderWithProviders(<CoatingCheckFormModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    await pickSpec(/^Acrylic — standard/);
    await typeReadings(dialog, "Uncoated", ["1.5", "1.5", "1.5"]);
    await typeReadings(dialog, "Coated", ["1.7", "1.7", "1.7"]);
    // 0.2 mm across both faces = 0.1 mm a side, over 0.075.
    expect(within(dialog).getByText("Coating thickness 0.100 mm (0.00394 in · 3.94 mils)")).toBeInTheDocument();
    expect(within(dialog).getByText(/Above the 0\.075 mm maximum/)).toBeInTheDocument();
  });

  it("refuses a reading that looks like inches while millimetres is picked", async () => {
    const onClose = vi.fn();
    renderWithProviders(<CoatingCheckFormModal onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    await pickSpec(/^Acrylic — standard/);
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Machine" }), "SPRAY-1");
    await typeReadings(dialog, "Uncoated", [".0621", ".0621", ".0621"]);
    await typeReadings(dialog, "Coated", [".0661", ".0661", ".0661"]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Record check" }));
    expect(within(dialog).getByText(/looks like inches, not millimetres/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // Switching to inches is the fix — and the maths converts them to mm.
    await userEvent.click(within(dialog).getByRole("radio", { name: "Inches" }));
    expect(within(dialog).getByText("Coating thickness 0.0508 mm (0.0020 in · 2.00 mils)")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Record check" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(localStorage.getItem(COATING_UNIT_STORAGE_KEY)).toBe("in");
  });

  it("asks for the spec, the machine and all six readings", async () => {
    renderWithProviders(<CoatingCheckFormModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record check" }));
    expect(within(dialog).getByText("Pick the spec this check is judged against.")).toBeInTheDocument();
    await pickSpec(/^Acrylic — standard/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Record check" }));
    expect(within(dialog).getByText("Enter the machine.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Machine" }), "SPRAY-1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record check" }));
    expect(within(dialog).getByText("Enter uncoated reading 1.")).toBeInTheDocument();
  });
});
