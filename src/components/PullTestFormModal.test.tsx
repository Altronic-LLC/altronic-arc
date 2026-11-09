import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { listPullTests, resetPullTestMockStore } from "@/api/pullTests";
import { resetPullTestSpecMockStore } from "@/api/pullTestSpecs";
import { MOCK_PULL_SPECS, MOCK_PULL_TESTS } from "@/data/pullTestMockData";
import { nextPullSlot, PullTestFormModal, pullSpecOptions } from "./PullTestFormModal";

// =============================================================================
// The pull test form. The tester is a fake standing in for api/mark10Serial
// (jsdom has no serial port): the test hands it lines exactly as the WT-205
// sends them, and asserts what lands in the boxes and what is saved.
// =============================================================================

const adminAccess = vi.hoisted(() => ({ isAdmin: false, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));

const serial = vi.hoisted(() => ({
  supported: true,
  granted: [] as unknown[],
  onLine: null as null | ((line: string) => void),
  requested: 0,
  closed: 0,
}));
vi.mock("@/api/mark10Serial", () => ({
  serialSupported: () => serial.supported,
  grantedPorts: async () => serial.granted,
  choosePort: async () => ({}),
  openTester: async (_port: unknown, _baud: number, handlers: { onLine: (l: string) => void }) => {
    serial.onLine = handlers.onLine;
    return {
      requestReading: async () => {
        serial.requested++;
      },
      close: async () => {
        serial.closed++;
      },
    };
  },
}));

beforeEach(() => {
  resetPullTestMockStore();
  resetPullTestSpecMockStore();
  serial.supported = true;
  serial.granted = [];
  serial.onLine = null;
  serial.requested = 0;
  serial.closed = 0;
  try {
    localStorage.clear();
  } catch {
    // jsdom always has it.
  }
});

async function pickSpec(name: RegExp) {
  await userEvent.click(screen.getByRole("button", { name: "Spec" }));
  await userEvent.click(await screen.findByRole("option", { name }));
}

function send(line: string) {
  act(() => serial.onLine!(line));
}

describe("pullSpecOptions / nextPullSlot", () => {
  it("offers active specs only, and keeps a test's retired one", () => {
    const labels = pullSpecOptions(MOCK_PULL_SPECS, null).map((o) => o.label);
    expect(labels.some((l) => l.startsWith("910550"))).toBe(false);
    expect(labels).toContain("Any terminal · 18 AWG · DEMO-STD Table 1 — At least 15.0 lbF");
    const retired = { specId: 7, specTerminal: "910550", wireGauge: "16", minimumForce: 22, specUnit: "lbF" as const, reference: "" };
    expect(pullSpecOptions(MOCK_PULL_SPECS, retired).some((o) => o.label.endsWith("(retired)"))).toBe(true);
  });

  it("fills the first empty box, then grows, then stops at five", () => {
    const box = (raw: string) => ({ raw, fromTester: false });
    expect(nextPullSlot([box("1"), box(""), box("")])).toEqual({ index: 1, grow: false });
    expect(nextPullSlot([box("1"), box("2"), box("3")])).toEqual({ index: 3, grow: true });
    expect(nextPullSlot([box("1"), box("2"), box("3"), box("4"), box("5")])).toBeNull();
  });
});

describe("PullTestFormModal — typed", () => {
  it("judges each pull against the minimum and records the test", async () => {
    const onClose = vi.fn();
    renderWithProviders(<PullTestFormModal onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "New pull test" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Record test" }));
    expect(within(dialog).getByText("Pick the spec this test is judged by.")).toBeInTheDocument();

    await pickSpec(/^910101 · 18 AWG/);
    expect(within(dialog).getByText("At least 18.0 lbF")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Terminal pulled")).toHaveTextContent("910101");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Start" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Clock number" }), "342");

    await userEvent.type(within(dialog).getByRole("textbox", { name: "Pull 1" }), "20.4");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Pull 2" }), "18");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Pull 3" }), "17.9");
    expect(within(dialog).getAllByText("Holds")).toHaveLength(2);
    expect(within(dialog).getByText("Below minimum")).toBeInTheDocument();
    expect(within(dialog).getByText(/Failed — saving emails/)).toBeInTheDocument();

    // How it failed: the standard answers on open, picked with a click.
    const howFailed = within(dialog).getByRole("textbox", { name: "How it failed" });
    await userEvent.click(howFailed);
    await userEvent.click(await screen.findByRole("option", { name: "Wire pulled out of crimp" }));
    expect(howFailed).toHaveValue("Wire pulled out of crimp");

    await userEvent.click(within(dialog).getByRole("button", { name: "Record test" }));
    expect(within(dialog).getByText("Enter the work order this run is for.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Work order *" }), "1000209528");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record test" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const saved = (await listPullTests()).find((t) => t.id > MOCK_PULL_TESTS.length)!;
    expect(saved).toMatchObject({
      terminal: "910101",
      failed: true,
      lowest: 17.9,
      readingSource: "Typed",
      unit: "lbF",
      howFailed: "Wire pulled out of crimp",
    });
    expect(saved.readings).toEqual([20.4, 18, 17.9, null, null]);
  });

  it("asks which terminal was pulled on an any-terminal spec", async () => {
    renderWithProviders(<PullTestFormModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "New pull test" });
    await pickSpec(/^Any terminal · 18 AWG/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Record test" }));
    expect(within(dialog).getByText("Enter the terminal or pin you pulled.")).toBeInTheDocument();
  });
});

describe("PullTestFormModal — how it failed", () => {
  it("opens on the answers earlier tests used, and keeps a new one typed in", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <PullTestFormModal
        onClose={onClose}
        howFailedSuggestions={{ options: ["Insulation crimp let go", "Wire broke"], search: ["Insulation crimp let go", "Wire broke", "Terminal broke"] }}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "New pull test" });
    const howFailed = within(dialog).getByRole("textbox", { name: "How it failed" });
    await userEvent.click(howFailed);
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Insulation crimp let go", "Wire broke"]);

    await userEvent.type(howFailed, "Barrel split");
    await pickSpec(/^910101 · 18 AWG/);
    await userEvent.click(within(dialog).getByRole("radio", { name: "Start" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Clock number" }), "342");
    for (const [i, v] of ["20", "21", "22"].entries()) {
      await userEvent.type(within(dialog).getByRole("textbox", { name: `Pull ${i + 1}` }), v);
    }
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Work order *" }), "1000209528");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record test" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const saved = (await listPullTests()).find((t) => t.id > MOCK_PULL_TESTS.length)!;
    expect(saved.howFailed).toBe("Barrel split");
  });
});

describe("PullTestFormModal — from the tester", () => {
  it("connects, fills the next empty box from each line, and saves as read by the tester", async () => {
    const onClose = vi.fn();
    renderWithProviders(<PullTestFormModal onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "New pull test" });
    const panel = within(dialog).getByRole("region", { name: "Pull tester" });

    await userEvent.click(within(panel).getByRole("button", { name: /Connect tester/ }));
    expect(await within(panel).findByText(/Connected — each pull's peak/)).toBeInTheDocument();

    send("20.4 lbF");
    send("19.8 lbF 01/20/2026 11:35:08 AM");
    send("21.0 lbF");
    expect(within(dialog).getByRole("textbox", { name: "Pull 1" })).toHaveValue("20.4");
    expect(within(dialog).getByRole("textbox", { name: "Pull 2" })).toHaveValue("19.8");
    expect(within(dialog).getByRole("textbox", { name: "Pull 3" })).toHaveValue("21");
    expect(within(dialog).getAllByText("from tester")).toHaveLength(3);

    // A fourth pull grows a box rather than overwriting one.
    send("22.2 lbF");
    expect(within(dialog).getByRole("textbox", { name: "Pull 4" })).toHaveValue("22.2");

    await userEvent.click(within(panel).getByRole("button", { name: /Read now/ }));
    expect(serial.requested).toBe(1);

    await pickSpec(/^910101 · 18 AWG/);
    await userEvent.click(within(dialog).getByRole("radio", { name: "End" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Clock number" }), "101");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Work order *" }), "1000209528");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record test" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const saved = (await listPullTests()).find((t) => t.id > MOCK_PULL_TESTS.length)!;
    expect(saved).toMatchObject({ readingSource: "Tester", failed: false });
    expect(saved.readings).toEqual([20.4, 19.8, 21, 22.2, null]);
  });

  it("moves the cursor to the next empty pull box after each reading, then to How it failed", async () => {
    renderWithProviders(<PullTestFormModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "New pull test" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Connect tester/ }));
    await within(dialog).findByText(/Connected — each pull's peak/);

    send("20.4 lbF");
    expect(within(dialog).getByRole("textbox", { name: "Pull 2" })).toHaveFocus();
    send("19.8 lbF");
    expect(within(dialog).getByRole("textbox", { name: "Pull 3" })).toHaveFocus();
    send("21.0 lbF");
    expect(within(dialog).getByRole("textbox", { name: "How it failed" })).toHaveFocus();
  });

  it("leaves the cursor alone while somebody is typing in another field", async () => {
    renderWithProviders(<PullTestFormModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "New pull test" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Connect tester/ }));
    await within(dialog).findByText(/Connected — each pull's peak/);

    const clock = within(dialog).getByRole("textbox", { name: "Clock number" });
    await userEvent.click(clock);
    send("20.4 lbF");
    expect(within(dialog).getByRole("textbox", { name: "Pull 1" })).toHaveValue("20.4");
    expect(clock).toHaveFocus();
  });

  it("takes the tester's unit when there are no pulls yet, and refuses a different one after", async () => {
    renderWithProviders(<PullTestFormModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "New pull test" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Connect tester/ }));
    await within(dialog).findByText(/Connected — each pull's peak/);

    send("88.0 N");
    expect(within(dialog).getByRole("button", { name: "Unit" })).toHaveTextContent("N");
    send("20.0 lbF");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/this test's pulls are in N/);
    expect(within(dialog).getByRole("textbox", { name: "Pull 2" })).toHaveValue("");
  });

  it("shows what the tester sent when it isn't a reading", async () => {
    renderWithProviders(<PullTestFormModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "New pull test" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Connect tester/ }));
    await within(dialog).findByText(/Connected — each pull's peak/);
    send("-12.0 lbF");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/negative reading/);
    expect(within(dialog).getByRole("textbox", { name: "Pull 1" })).toHaveValue("");
  });

  it("reconnects by itself to the one port this browser was given, and lets go of it on close", async () => {
    serial.granted = [{}];
    const { unmount } = renderWithProviders(<PullTestFormModal onClose={vi.fn()} />);
    expect(await screen.findByText(/Connected — each pull's peak/)).toBeInTheDocument();
    unmount();
    await waitFor(() => expect(serial.closed).toBe(1));
  });

  it("says when the browser can't read the tester", () => {
    serial.supported = false;
    renderWithProviders(<PullTestFormModal onClose={vi.fn()} />);
    expect(screen.getByText(/needs Chrome or Edge on a computer/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connect tester/ })).toBeNull();
  });
});
