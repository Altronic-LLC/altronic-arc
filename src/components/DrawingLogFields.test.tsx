import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import {
  DRAWING_LOG_EARLIEST_YEAR,
  DRAWING_LOG_FIELDS,
  writableFields,
} from "@/lib/drawingLogFields";
import { FieldInputs, draftFromEntry, emptyDraft } from "./DrawingLogFields";
import { DrawingLogCreateModal } from "./DrawingLogCreateModal";
import { DrawingLogsView } from "@/views/DrawingLogsView";
import { MOCK_DRAWING_LOGS } from "@/data/drawingLogMockData";

// BusinessIT#32 (John, the CAD register's user, 2026-10-07): new labels, Sheet
// Date defaulting to today on a NEW drawing only, Log Book Date read-only, and
// dates reaching back to 1950.

vi.mock("@/hooks/useIsAdmin", () => ({
  useAdminAccess: () => ({ isAdmin: true, isResolving: false }),
  useIsAdmin: () => true,
}));

const cad = DRAWING_LOG_FIELDS.cad.fields;
const field = (key: string) => cad.find((f) => f.key === key)!;

describe("CAD descriptors", () => {
  it("labels the two dates the way John reads them — the columns are unchanged", () => {
    expect(field("dateCompleted").label).toBe("Drawing Completed");
    expect(field("dateCompleted").column).toBe("DateCompleted");
    expect(field("drawingDate").label).toBe("Sheet Date");
    expect(field("drawingDate").column).toBe("DrawingDATE");
  });

  it("makes Log Book Date read-only: out of the forms, still a declared field", () => {
    expect(field("logBookDate").readOnly).toBe(true);
    expect(writableFields("cad").map((f) => f.key)).not.toContain("logBookDate");
    // Still selected and mapped, so older drawings keep showing their value.
    expect(cad.map((f) => f.key)).toContain("logBookDate");
  });

  it("defaults only CAD's Sheet Date to today", () => {
    const defaults = Object.values(DRAWING_LOG_FIELDS).flatMap((spec) =>
      spec.fields.filter((f) => f.defaultToday).map((f) => f.key),
    );
    expect(defaults).toEqual(["drawingDate"]);
  });
});

describe("emptyDraft / draftFromEntry", () => {
  it("starts a new drawing's Sheet Date at today, everything else blank", () => {
    const draft = emptyDraft(writableFields("cad"), new Date(2026, 9, 7, 9, 30));
    expect(draft.drawingDate).toBe("2026-10-07");
    expect(draft.dateCompleted).toBe("");
    expect(draft.drawingNo).toBe("");
  });

  it("never applies the default to an existing drawing's stored date", () => {
    const entry = MOCK_DRAWING_LOGS.find((e) => e.values.drawingNo === "501 505")!;
    expect(draftFromEntry(entry, writableFields("cad")).drawingDate).toBe("2025-12-30");
  });
});

describe("FieldInputs — dates are DateFields", () => {
  it("renders no <input type=date> for any register", () => {
    for (const kind of ["cad", "ccc", "cec", "sketches"] as const) {
      const fields = writableFields(kind);
      const { container, unmount } = render(
        <FieldInputs fields={fields} draft={emptyDraft(fields)} onChange={() => {}} />,
      );
      expect(container.querySelector('input[type="date"]')).toBeNull();
      for (const f of fields.filter((x) => x.type === "date")) {
        expect(screen.getByRole("button", { name: f.label })).toBeInTheDocument();
      }
      unmount();
    }
  });

  it("offers years back to 1950 in the register's date picker", async () => {
    const fields = writableFields("cad");
    render(<FieldInputs fields={fields} draft={emptyDraft(fields)} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Drawing Completed" }));
    const year = screen.getByRole("combobox", { name: "Year" });
    expect(
      within(year).getByRole("option", { name: String(DRAWING_LOG_EARLIEST_YEAR) }),
    ).toBeInTheDocument();
  });

  it("autofocuses a date when it is the first field", async () => {
    const fields = [field("drawingDate")];
    render(<FieldInputs fields={fields} draft={{ drawingDate: "" }} onChange={() => {}} autoFocusFirst />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sheet Date" })).toHaveFocus(),
    );
  });
});

describe("the Add drawing form", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 9, 30));
  });
  afterEach(() => vi.useRealTimers());

  it("pre-fills Sheet Date with today, still editable, and has no Log Book Date", async () => {
    renderWithProviders(<DrawingLogCreateModal kind="cad" onClose={() => {}} />);
    const form = screen.getByRole("dialog", { name: /new drawing/i });
    const sheetDate = within(form).getByRole("button", { name: "Sheet Date" });
    expect(sheetDate.textContent).toMatch(/Oct/);
    expect(sheetDate.textContent).toMatch(/2026/);
    expect(sheetDate).not.toBeDisabled();
    expect(within(form).getByRole("button", { name: "Drawing Completed" }).textContent).toMatch(
      /not set/i,
    );
    expect(within(form).queryByText(/log book/i)).toBeNull();
    expect(form.querySelector('input[type="date"]')).toBeNull();
  });
});

describe("editing an existing drawing", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 9, 30));
  });
  afterEach(() => vi.useRealTimers());

  it("keeps the stored Sheet Date, and shows Log Book Date read-only", async () => {
    renderWithProviders(<DrawingLogsView />, { route: "/drawing-logs?log=cad" });
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("row", { name: /Open 501 505/ }));
    const panel = await screen.findByRole("dialog", { name: /drawing details/i });

    // Read-only, not gone: the historical value still shows on the panel.
    expect(within(panel).getByText(/^log book date$/i)).toBeInTheDocument();
    expect(within(panel).getByText(/Dec 29, 2025/)).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("button", { name: /edit details/i }));
    const sheetDate = within(panel).getByRole("button", { name: "Sheet Date" });
    expect(sheetDate.textContent).toMatch(/Dec 30, 2025/);
    expect(sheetDate.textContent).not.toMatch(/Oct/);
    expect(within(panel).queryByRole("button", { name: /log book date/i })).toBeNull();
  });
});

describe("the change log's dates", () => {
  it("reach back to 1950 when recording a change", async () => {
    renderWithProviders(<DrawingLogsView />, { route: "/drawing-logs?log=cad" });
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("row", { name: /Open 501 505/ }));
    const panel = await screen.findByRole("dialog", { name: /drawing details/i });
    await userEvent.click(within(panel).getByRole("button", { name: /record a change/i }));
    await userEvent.click(within(panel).getByRole("button", { name: "Date" }));
    const year = within(panel).getByRole("combobox", { name: "Year" });
    expect(within(year).getByRole("option", { name: "1950" })).toBeInTheDocument();
  });

  it("reach back to 1950 when correcting a change", async () => {
    renderWithProviders(<DrawingLogsView />, { route: "/drawing-logs?log=cad" });
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("row", { name: /Open 501 505/ }));
    const panel = await screen.findByRole("dialog", { name: /drawing details/i });
    await userEvent.click(within(panel).getByRole("button", { name: /edit change in slot 01/i }));
    await userEvent.click(within(panel).getByRole("button", { name: "Change date" }));
    const year = within(panel).getByRole("combobox", { name: "Year" });
    expect(within(year).getByRole("option", { name: "1950" })).toBeInTheDocument();
  });
});
