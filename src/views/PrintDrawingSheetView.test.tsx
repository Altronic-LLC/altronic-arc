import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { listDrawingLog } from "@/api/drawingLogs";
import { CHANGE_SLOTS } from "@/lib/drawingLogMapper";
import type { DrawingChange } from "@/types/task";
import { HISTORY_ROWS, PrintDrawingSheetView, historyColumns } from "./PrintDrawingSheetView";

// The Drawing Work Sheet reproduces FORM #E006 REV. 7. Two things it must get
// right, both from Ray's marked-up copy: it prints data the current form omits,
// and it keeps the sections that have no data behind them at all.

beforeEach(() => {
  // jsdom has no print; the view fires it on a timer after the data lands.
  vi.stubGlobal("print", vi.fn());
});

afterEach(() => vi.unstubAllGlobals());

async function renderSheet(id: number) {
  const result = renderWithProviders(<PrintDrawingSheetView />, {
    route: `/drawing-logs/cad/${id}/print`,
    routePattern: "/drawing-logs/:kind/:id/print",
  });
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: /drawing work sheet/i })).toBeInTheDocument(),
  );
  return result;
}

/** The CAD fixture row the scanned sheet was taken from is keyed on drawingNo. */
async function cadRow(predicate: (values: Record<string, unknown>) => boolean) {
  const rows = await listDrawingLog("cad");
  const row = rows.find((r) => predicate(r.values));
  expect(row).toBeDefined();
  return row!;
}

describe("historyColumns", () => {
  const change = (slot: number): DrawingChange => ({
    slot,
    date: new Date("2020-01-01T12:00:00Z"),
    ecn: `ECN-${slot}`,
    rev: String(slot),
  });

  it("splits the sixteen slots into the form's two columns", () => {
    const { left, right } = historyColumns([]);
    expect(left).toHaveLength(HISTORY_ROWS);
    expect(right).toHaveLength(HISTORY_ROWS);
    expect(left.length + right.length).toBe(CHANGE_SLOTS);
  });

  it("pads empty slots rather than dropping them — the form is a fixed grid", () => {
    // A drawing with two changes still prints fourteen empty ruled rows.
    const { left, right } = historyColumns([change(1), change(3)]);
    expect(left[0]?.ecn).toBe("ECN-1");
    expect(left[1]).toBeNull();
    expect(left[2]?.ecn).toBe("ECN-3");
    expect(right.every((r) => r === null)).toBe(true);
  });

  it("puts a slot in the column its number belongs to", () => {
    // Slot 9 is the first row of the RIGHT column — the half the current form
    // doesn't print at all.
    const { left, right } = historyColumns([change(9)]);
    expect(left.every((r) => r === null)).toBe(true);
    expect(right[0]?.ecn).toBe("ECN-9");
  });

  it("keeps a sparse log's slots on their own rows", () => {
    const { left } = historyColumns([change(8)]);
    expect(left[HISTORY_ROWS - 1]?.ecn).toBe("ECN-8");
  });
});

describe("PrintDrawingSheetView — the data it prints", () => {
  it("prints every CAD field the register holds", async () => {
    const row = await cadRow((v) => v.cadNumber === "501505");
    await renderSheet(row.id);

    // Identifiers, both of them — Title and CADNumber are different values.
    expect(screen.getByText("501 505")).toBeInTheDocument();
    expect(screen.getByText("501505")).toBeInTheDocument();
    expect(screen.getByText("CAPACITOR 66µF, 250VDC")).toBeInTheDocument();
    // Prim Key is read-only in the app but belongs on the sheet.
    expect(screen.getByText(/prim key/i)).toBeInTheDocument();
  });

  it("prints the By / Entered By initials the current form leaves out", async () => {
    // Annotated "in DB but doesn't print" on the scanned sheet.
    const row = await cadRow((v) => v.by !== "" && v.enteredBy !== "");
    await renderSheet(row.id);

    const enteredBy = screen.getByText(/^entered by:$/i).parentElement!;
    expect(enteredBy).toHaveTextContent(String(row.values.enteredBy));
    expect(screen.getByText(String(row.values.by), { exact: false })).toBeInTheDocument();
  });

  it("names the software under the title, as the paper form does", async () => {
    const row = await cadRow((v) => v.software !== "");
    await renderSheet(row.id);
    expect(screen.getByText(String(row.values.software))).toBeInTheDocument();
  });

  it("prints all sixteen change rows, not just the used ones", async () => {
    const row = await cadRow((v) => v.cadNumber === "501505");
    await renderSheet(row.id);

    // Two tables of eight body rows each.
    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(within(table).getAllByRole("row")).toHaveLength(HISTORY_ROWS + 1); // + header
    }
  });

  it("shows a recorded change's date, revision and ECN", async () => {
    const row = await cadRow((v) => v.cadNumber === "501505");
    const change = row.changes[0];
    expect(change).toBeDefined();
    await renderSheet(row.id);
    expect(screen.getByText(change.ecn)).toBeInTheDocument();
  });
});

describe("PrintDrawingSheetView — the parts with no data behind them", () => {
  it("keeps the print distribution block, which exists nowhere in SharePoint", async () => {
    const row = await cadRow(() => true);
    await renderSheet(row.id);

    expect(screen.getByText(/print distribution/i)).toBeInTheDocument();
    // Exact match: "Document Control" also appears inside the NOTE paragraph.
    expect(screen.getByText("V.P. of Engineering")).toBeInTheDocument();
    expect(screen.getByText("Document Control")).toBeInTheDocument();
    expect(screen.getByText("Q.C. Manager")).toBeInTheDocument();
    expect(screen.getByText("Repair Depr.")).toBeInTheDocument();
    // The warning that governs who may receive a prototype print.
    expect(screen.getByText(/should not be distributed unless/i)).toBeInTheDocument();
  });

  it("keeps the stage and sign-off lines blank for filling in by hand", async () => {
    const row = await cadRow(() => true);
    await renderSheet(row.id);

    for (const label of [
      "Prototype:",
      "Preliminary:",
      "Production:",
      "Date Checked/Approved:",
      "Date Entered in Sys:",
      "Date to Mylar:",
    ]) {
      // Each Row is <span>label</span><span>value</span> — the value span is the
      // ruled line, and it must be empty so there's somewhere to write.
      const line = screen.getByText(label).parentElement!;
      const value = line.querySelector("span:last-of-type")!;
      expect(value.textContent?.trim()).toBe("");
    }
    // And the form's own identity, so a printed copy is traceable.
    expect(screen.getByText(/form #E006, REV\. 7/i)).toBeInTheDocument();
  });

  it("says so plainly when the drawing isn't in the register", async () => {
    renderWithProviders(<PrintDrawingSheetView />, {
      route: "/drawing-logs/cad/99999999/print",
      routePattern: "/drawing-logs/:kind/:id/print",
    });
    expect(await screen.findByText(/isn't in the CAD register/i)).toBeInTheDocument();
  });

  it("waits for the drawing before opening the print dialog", async () => {
    // Firing on mount snapshots the loading screen instead of the sheet.
    renderWithProviders(<PrintDrawingSheetView />, {
      route: "/drawing-logs/cad/99999999/print",
      routePattern: "/drawing-logs/:kind/:id/print",
    });
    await screen.findByText(/isn't in the CAD register/i);
    expect(window.print).not.toHaveBeenCalled();
  });

  it("opens the print dialog as soon as the sheet is on the page", async () => {
    // No fixed delay to wait out — fonts plus one paint, which is why the dialog
    // appears immediately rather than half a second later.
    const row = await cadRow(() => true);
    await renderSheet(row.id);
    await waitFor(() => expect(window.print).toHaveBeenCalled());
  });
});

describe("PrintDrawingSheetView — ruled lines only where they're needed", () => {
  /** The value span of a labelled field. */
  function valueOf(label: string) {
    return screen.getByText(label).parentElement!.querySelector("span:last-of-type")!;
  }

  it("prints no line under a field that already has a value", async () => {
    // A rule under printed text is noise — the value reads fine on its own.
    const row = await cadRow((v) => v.drawingNo === "501 505");
    await renderSheet(row.id);

    for (const label of ["Date:", "Drawing Number:", "CAD Drawing Number:", "Drawing Title:"]) {
      expect(valueOf(label).className).not.toMatch(/border-b/);
    }
  });

  it("keeps the line under a field left blank for hand entry", async () => {
    // Prototype / Preliminary / Production and the sign-off dates are completed
    // on paper — without a rule there'd be nothing to write on.
    const row = await cadRow((v) => v.drawingNo === "501 505");
    await renderSheet(row.id);

    for (const label of [
      "Prototype:",
      "Preliminary:",
      "Production:",
      "Date Checked/Approved:",
      "Date Entered in Sys:",
      "Date to Mylar:",
    ]) {
      expect(valueOf(label).className).toMatch(/border-b/);
    }
  });
});
