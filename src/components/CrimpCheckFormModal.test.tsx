import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { listCrimpChecks, resetCrimpCheckMockStore } from "@/api/crimpChecks";
import { resetCrimpSpecMockStore } from "@/api/crimpSpecs";
import { MOCK_CRIMP_CHECKS, MOCK_CRIMP_SPECS } from "@/data/crimpMockData";
import { CrimpCheckFormModal, crimpSpecOptions } from "./CrimpCheckFormModal";

const adminAccess = vi.hoisted(() => ({ isAdmin: false, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));

beforeEach(() => {
  resetCrimpCheckMockStore();
  resetCrimpSpecMockStore();
  window.localStorage.clear();
});

describe("crimpSpecOptions", () => {
  it("offers active specs only", () => {
    const labels = crimpSpecOptions(MOCK_CRIMP_SPECS, null).map((o) => o.label);
    expect(labels.some((l) => l.startsWith("900660"))).toBe(false);
    expect(labels).toContain("900330 · 18 AWG · BLUE — 0.040 ± 0.002");
  });

  it("with a press picked, offers that press's specs, then the unassigned ones — never another press's", () => {
    const options = crimpSpecOptions(MOCK_CRIMP_SPECS, null, 903);
    expect(options.map((o) => o.label)).toEqual([
      "900330 · 18 AWG · BLUE — 0.040 ± 0.002",
      "900550 · 16 AWG · A1004 — No crimp height · no machine set",
    ]);
  });

  it("keeps an edited check's own spec even when it doesn't run on the press picked", () => {
    const own = { specId: 4, terminal: "900215", wireGauge: "18", applicator: "A1002", crimpHeight: 0.042, tolerance: 0.002 };
    expect(crimpSpecOptions(MOCK_CRIMP_SPECS, own, 903).map((o) => o.value)).toContain("4");
  });

  it("keeps a check's retired spec, and a stand-in for one that has gone", () => {
    const retired = { specId: 8, terminal: "900660", wireGauge: "20", applicator: "A1005", crimpHeight: 0.047, tolerance: 0.002 };
    expect(crimpSpecOptions(MOCK_CRIMP_SPECS, retired).some((o) => o.label.endsWith("(retired)"))).toBe(true);
    expect(crimpSpecOptions(MOCK_CRIMP_SPECS, { ...retired, specId: 99 })[0]).toEqual({
      value: "99",
      label: "900660 · 20 AWG · A1005 (no longer on the list)",
    });
  });
});

async function pickMachine(name: string) {
  await userEvent.click(await screen.findByRole("button", { name: "Machine" }));
  await userEvent.click(await screen.findByRole("option", { name }));
}

async function pickSpec(name: RegExp) {
  await userEvent.click(screen.getByRole("button", { name: "Terminal" }));
  await userEvent.click(await screen.findByRole("option", { name }));
}

describe("CrimpCheckFormModal", () => {
  it("judges each reading as it's entered, and records the check", async () => {
    const onClose = vi.fn();
    renderWithProviders(<CrimpCheckFormModal onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "New crimp height check" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Record check" }));
    expect(within(dialog).getByText("Pick the machine this check was taken on.")).toBeInTheDocument();
    await pickMachine("DEMO COLOUR PRESS");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record check" }));
    expect(within(dialog).getByText(/Pick the terminal, gauge and applicator/)).toBeInTheDocument();
    await pickSpec(/^900330 · 18 AWG · BLUE/);
    expect(within(dialog).getByText(/0\.038 – 0\.042/)).toBeInTheDocument();
    expect(within(dialog).getByText("Runs on: DEMO COLOUR PRESS")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Start" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Clock number" }), "342");

    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reading 1" }), ".038");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reading 2" }), ".040");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reading 3" }), ".043");
    expect(within(dialog).getAllByText("In spec")).toHaveLength(2);
    expect(within(dialog).getByText("High")).toBeInTheDocument();
    expect(within(dialog).getByText(/Out of spec — saving emails/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Record check" }));
    expect(within(dialog).getByText("Enter the work order this run is for.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Work order *" }), "1000209528");

    await userEvent.click(within(dialog).getByRole("button", { name: "Record check" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const saved = (await listCrimpChecks()).find((c) => c.id > MOCK_CRIMP_CHECKS.length)!;
    expect(saved).toMatchObject({
      terminal: "900330",
      clockNumber: "342",
      checkPoint: "Start",
      outOfSpec: true,
      workOrder: "1000209528",
      machine: { id: 903, name: "DEMO COLOUR PRESS" },
    });
    expect(saved.readings).toEqual([0.038, 0.04, 0.043]);
  });

  it("refuses a reading that looks like millimetres", async () => {
    renderWithProviders(<CrimpCheckFormModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    await pickMachine("DEMO COLOUR PRESS");
    await pickSpec(/^900330 · 18 AWG · BLUE/);
    await userEvent.click(within(dialog).getByRole("radio", { name: "End" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Clock number" }), "342");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reading 1" }), "0.99");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reading 2" }), ".040");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reading 3" }), ".040");
    expect(within(dialog).getByText(/Looks like mm/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Record check" }));
    expect(within(dialog).getByText(/looks like millimetres/)).toBeInTheDocument();
    expect((await listCrimpChecks()).length).toBe(MOCK_CRIMP_CHECKS.length);
  });

  it("moves to the next reading on Enter — the micrometer's transmitter sends one", () => {
    renderWithProviders(<CrimpCheckFormModal onClose={vi.fn()} />);
    const first = screen.getByRole("textbox", { name: "Reading 1" });
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "Reading 2" })).toHaveFocus();
  });

  it("says when the spec has no crimp height to judge against", async () => {
    renderWithProviders(<CrimpCheckFormModal onClose={vi.fn()} />);
    await pickMachine("DEMO PRESS #1");
    await pickSpec(/^900550/);
    expect(screen.getByText("No machine set on this spec yet.")).toBeInTheDocument();
    expect(screen.getByText(/can't be judged/)).toBeInTheDocument();
  });

  it("asks for the press first, and offers only the presses in a Harness location", async () => {
    renderWithProviders(<CrimpCheckFormModal onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Terminal" })).toBeDisabled();
    await userEvent.click(await screen.findByRole("button", { name: "Machine" }));
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toEqual(["DEMO COLOUR PRESS", "DEMO PRESS #1", "DEMO PRESS #2"]);
  });

  it("drops a picked spec that doesn't run on the press picked next", async () => {
    renderWithProviders(<CrimpCheckFormModal onClose={vi.fn()} />);
    await pickMachine("DEMO PRESS #1");
    await pickSpec(/^900101 · 14 AWG/);
    expect(screen.getByRole("button", { name: "Terminal" })).toHaveTextContent("900101");
    await pickMachine("DEMO COLOUR PRESS");
    expect(screen.getByRole("button", { name: "Terminal" })).toHaveTextContent("Pick the terminal");
  });

  it("remembers the press for the next new check on this browser", async () => {
    const first = renderWithProviders(<CrimpCheckFormModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    await pickMachine("DEMO PRESS #2");
    await pickSpec(/^900215/);
    await userEvent.click(within(dialog).getByRole("radio", { name: "Start" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Clock number" }), "342");
    for (const [i, v] of [".042", ".042", ".042"].entries()) {
      await userEvent.type(within(dialog).getByRole("textbox", { name: `Reading ${i + 1}` }), v);
    }
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Work order *" }), "1000209528");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record check" }));
    await waitFor(() => expect(window.localStorage.getItem("arc-crimp-machine")).toBe("902"));
    first.unmount();

    renderWithProviders(<CrimpCheckFormModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Machine" })).toHaveTextContent("DEMO PRESS #2"));
    expect(screen.getByRole("button", { name: "Terminal" })).toBeEnabled();
  });

  it("doesn't ask for a press on an older check that never had one", async () => {
    const onClose = vi.fn();
    const check = { ...MOCK_CRIMP_CHECKS[0], machine: null };
    renderWithProviders(<CrimpCheckFormModal check={check} onClose={onClose} />);
    expect(await screen.findByText("Machine")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps an edited check's own spec figures", async () => {
    const check = { ...MOCK_CRIMP_CHECKS[0], crimpHeight: 0.05, tolerance: 0.001 };
    renderWithProviders(<CrimpCheckFormModal check={check} onClose={vi.fn()} />);
    expect(screen.getByText("0.050 ± 0.001")).toBeInTheDocument();
    expect(await screen.findByText(/The spec has changed since this check/)).toBeInTheDocument();
  });

  it("won't let a check's work order be cleared", async () => {
    const onClose = vi.fn();
    const check = { ...MOCK_CRIMP_CHECKS[0], workOrder: "1000209528" };
    renderWithProviders(<CrimpCheckFormModal check={check} onClose={onClose} />);
    const box = screen.getByRole("textbox", { name: "Work order *" });
    await userEvent.clear(box);
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(screen.getByText("Enter the work order this run is for.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still saves an older check that never had a work order", async () => {
    const onClose = vi.fn();
    const check = { ...MOCK_CRIMP_CHECKS[0], workOrder: "" };
    renderWithProviders(<CrimpCheckFormModal check={check} onClose={onClose} />);
    expect(screen.getByRole("textbox", { name: "Work order" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
