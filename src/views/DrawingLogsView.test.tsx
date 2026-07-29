import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { DrawingLogsView } from "./DrawingLogsView";

// USE_MOCK is true under Vitest. The mock user is a bootstrap admin, so admin is
// the default; the non-admin suite overrides the hook.

const adminAccess = vi.hoisted(() => ({ isAdmin: true, isResolving: false }));
vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => adminAccess,
  useIsAdmin: () => adminAccess.isAdmin,
}));

beforeEach(() => {
  vi.restoreAllMocks();
  adminAccess.isAdmin = true;
  adminAccess.isResolving = false;
});

async function renderView(route = "/drawing-logs?log=ccc") {
  const result = renderWithProviders(<DrawingLogsView />, { route });
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  return result;
}

/**
 * Open a row's detail panel. Targets the row by its aria-label rather than by
 * text, because a drawing number shows in BOTH the Drawing No. and Part No.
 * columns and `getByText` would be ambiguous.
 */
async function openRow(title: string) {
  await userEvent.click(screen.getByRole("row", { name: new RegExp("Open " + title) }));
  return screen.findByRole("dialog", { name: /drawing details/i });
}

/** The open detail panel, for assertions that would otherwise hit the table too. */
function dialog() {
  return screen.getByRole("dialog", { name: /drawing details/i });
}

describe("DrawingLogsView — tabs", () => {
  it("shows one tab per register under a single heading", async () => {
    await renderView();
    expect(screen.getByRole("heading", { name: /drawing file logs/i })).toBeInTheDocument();
    for (const label of ["CAD Drawings", "CCC Drawings", "CEC Drawings", "Engineering Sketches"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("reads the active tab from the URL", async () => {
    await renderView("/drawing-logs?log=cec");
    expect(screen.getByRole("tab", { name: "CEC Drawings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("EC09002")).toBeInTheDocument();
  });

  it("switches register when a tab is clicked", async () => {
    await renderView();
    await userEvent.click(screen.getByRole("tab", { name: "Engineering Sketches" }));
    await waitFor(() =>
      expect(screen.getByText("WARTSILLA RUBBER ELEMENT (DAMPER)")).toBeInTheDocument(),
    );
  });

  it("falls back to a valid register for a nonsense log param", async () => {
    await renderView("/drawing-logs?log=banana");
    expect(screen.getByRole("tab", { name: "CAD Drawings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("CAPACITOR 66µF, 250VDC")).toBeInTheDocument();
  });
});

describe("DrawingLogsView — columns per register", () => {
  it("shows drawing columns for CCC, including a change count", async () => {
    await renderView();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("Drawing No.");
    expect(headers).toContain("Part No.");
    expect(headers).toContain("Rev");
    expect(headers).toContain("Changes");
  });

  it("swaps in the sketch columns for Engineering Sketches, with no change column", async () => {
    await renderView("/drawing-logs?log=sketches");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("Sketch No.");
    expect(headers).toContain("Ventura");
    // Sketches has no CH_ columns at all, so no Changes column and no Rev.
    expect(headers).not.toContain("Changes");
    expect(headers).not.toContain("Rev");
  });

  it("says the sketch register works differently", async () => {
    await renderView("/drawing-logs?log=sketches");
    expect(screen.getByText(/no change log/i)).toBeInTheDocument();
  });
});

describe("DrawingLogsView — search", () => {
  it("finds a drawing by an ECN buried in its change log", async () => {
    // The whole point: ECNs live in 48 columns and never appear in the table.
    await renderView("/drawing-logs?log=cec");
    await userEvent.type(screen.getByPlaceholderText(/drawing no/i), "ECN-0031");
    await waitFor(() => expect(screen.getByText(/showing 1 of/i)).toBeInTheDocument());
    expect(screen.getByText("EC09002")).toBeInTheDocument();
  });

  it("keeps the search in the URL", async () => {
    await renderView("/drawing-logs?log=ccc&q=AGV10");
    expect(screen.getByText(/showing 2 of 2/i)).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    await renderView();
    await userEvent.type(screen.getByPlaceholderText(/drawing no/i), "zzznothing");
    await waitFor(() =>
      expect(screen.getByText(/no drawings match that search/i)).toBeInTheDocument(),
    );
  });
});

describe("DrawingLogsView — the detail panel", () => {
  it("opens on a row click and shows the change log", async () => {
    await renderView();
    await openRow("50100008");

    const panel = dialog();
    expect(within(panel).getByText(/change log/i)).toBeInTheDocument();
    // The fixture drawing has two change entries.
    expect(within(panel).getByText("ECN-0142")).toBeInTheDocument();
    expect(within(panel).getByText("ECN-1187")).toBeInTheDocument();
    expect(within(panel).getByText("2/16")).toBeInTheDocument();
  });

  it("opens on Enter, for keyboard users", async () => {
    await renderView();
    const row = screen.getByRole("row", { name: /Open 50100008/ });
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: /drawing details/i })).toBeInTheDocument();
  });

  it("says when a drawing has no recorded changes", async () => {
    await renderView();
    const panel = await openRow("50100028");
    expect(within(panel).getByText(/no changes recorded/i)).toBeInTheDocument();
  });

  it("shows sketch fields instead of a change log for a sketch", async () => {
    await renderView("/drawing-logs?log=sketches");
    const panel = await openRow("GGT0065C \\+ PLENUM ASSEMBLY 2 OUTLET");

    expect(within(panel).getByText(/ventura/i)).toBeInTheDocument();
    expect(within(panel).queryByText(/change log/i)).not.toBeInTheDocument();
  });

  it("records a change into the next free slot", async () => {
    await renderView();
    await openRow("50100008");
    await userEvent.click(within(dialog()).getByRole("button", { name: /record a change/i }));

    // Slot 3 is next after the fixture's two entries.
    expect(within(dialog()).getByText(/recording into slot 03 of 16/i)).toBeInTheDocument();

    await userEvent.type(within(dialog()).getByPlaceholderText(/ECN-1187/), "ECN-9001");
    await userEvent.type(within(dialog()).getByPlaceholderText(/e\.g\. C/), "D");
    await userEvent.click(within(dialog()).getByRole("button", { name: /^record$/i }));

    await waitFor(() => expect(within(dialog()).getByText("ECN-9001")).toBeInTheDocument());
    await waitFor(() => expect(within(dialog()).getByText("3/16")).toBeInTheDocument());
  });

  it("blocks recording when all sixteen slots are used, and explains why", async () => {
    await renderView("/drawing-logs?log=cec");
    const panel = await openRow("EC09003");

    const button = within(panel).getByRole("button", { name: /record a change/i });
    expect(button).toBeDisabled();
    expect(
      within(panel).getByText(/all 16 change slots on this drawing are used/i),
    ).toBeInTheDocument();
  });
});

describe("DrawingLogsView — admin gating", () => {
  it("offers an admin New / Edit / Delete", async () => {
    await renderView();
    expect(screen.getByRole("button", { name: /new/i })).toBeInTheDocument();

    const panel = await openRow("50100008");
    expect(within(panel).getByRole("button", { name: /edit details/i })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("gives a non-admin a read-only view that still opens the change log", async () => {
    adminAccess.isAdmin = false;
    await renderView();

    expect(screen.queryByRole("button", { name: /new/i })).not.toBeInTheDocument();
    expect(screen.getByText(/limited to admins/i)).toBeInTheDocument();

    // Reading the change log is the main value — it must stay available.
    const panel = await openRow("50100008");
    expect(within(panel).getByText(/change log/i)).toBeInTheDocument();
    expect(within(panel).getByText("ECN-0142")).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: /record a change/i }),
    ).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /edit details/i })).not.toBeInTheDocument();
  });

  it("holds the restriction note back while admin status resolves", async () => {
    adminAccess.isAdmin = false;
    adminAccess.isResolving = true;
    await renderView();
    expect(screen.queryByText(/limited to admins/i)).not.toBeInTheDocument();
  });
});
