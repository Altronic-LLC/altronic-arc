import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// The QC form modal, driven by the CPU-95 (QCFRM-012) spec — the form the
// engine was pulled out of, so every CPU-95 behaviour is pinned here.
//
// What's worth pinning: Serial Number is the only required field, Enter in
// any of the ~200 plain text/number fields must NOT submit the form (native
// browser "implicit submission" — reported live, 2026-09-17, entering the
// firing-angle grid cell by cell), and edit saves through the update
// mutation with the whole draft, matching QC Time Tracking's shape.
// =============================================================================

const createRecord = vi.hoisted(() => vi.fn(async () => ({ id: 1 })));
const updateRecord = vi.hoisted(() => vi.fn(async () => ({ id: 1 })));
vi.mock("@/hooks/useQcForms", () => ({
  useCreateQcFormRecord: () => ({ mutateAsync: createRecord, isPending: false }),
  useUpdateQcFormRecord: () => ({ mutateAsync: updateRecord, isPending: false }),
}));

const pdf = vi.hoisted(() => ({
  generate: vi.fn(async () => new Blob(["%PDF"], { type: "application/pdf" })),
  download: vi.fn(),
}));
vi.mock("@/lib/qcFormPdf", () => ({
  generateQcFormPdf: pdf.generate,
  qcFormPdfFileName: () => "QCFRM-012 CPU-95 25564.pdf",
}));
vi.mock("@/hooks/useQuotePdf", () => ({ downloadBlob: pdf.download }));

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { qcFormEmptyValues, type QcFormRecord } from "@/lib/qcFormEngine";
import { QC_CPU95_FORM as SPEC } from "@/lib/qcCpu95Form";
import { QcFormModal } from "./QcFormModal";

const RECORD: QcFormRecord = {
  id: 1,
  values: { ...qcFormEmptyValues(SPEC), serialNumber: "25564", altronicPartNumber: "791950-16" },
  createdAt: new Date(),
  modifiedAt: new Date(),
};

const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("creating a new test sheet", () => {
  it("is headed and named for the form", () => {
    renderWithProviders(<QcFormModal spec={SPEC} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "New CPU-95 test sheet" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^New CPU-95 Test Sheet\s*— QCFRM-012$/ })).toBeInTheDocument();
  });

  it("refuses an empty Serial / Unit Number", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Save test sheet" }));
    expect(createRecord).not.toHaveBeenCalled();
    expect(screen.getByText("Serial / Unit Number is required.")).toBeInTheDocument();
  });

  it("saves through the create mutation on Save", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Serial / Unit Number"), "25999");
    await userEvent.click(screen.getByRole("button", { name: "Save test sheet" }));
    expect(createRecord).toHaveBeenCalledWith(
      expect.objectContaining({ serialNumber: "25999" }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});

describe("editing an existing test sheet", () => {
  it("seeds the form from the record", () => {
    renderWithProviders(<QcFormModal spec={SPEC}record={RECORD} onClose={onClose} />);
    expect(screen.getByLabelText("Serial / Unit Number")).toHaveValue("25564");
  });

  it("saves through the update mutation, not create", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}record={RECORD} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, values: expect.objectContaining({ serialNumber: "25564" }) }),
    );
    expect(createRecord).not.toHaveBeenCalled();
  });
});

describe("exporting the filled form", () => {
  it("is offered only on a saved sheet", () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
  });

  it("exports the SAVED sheet, not the unsaved edit, and says so", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}record={RECORD} onClose={onClose} />);
    expect(screen.queryByText(/save to include your changes/i)).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Customer"), "Changed Co");
    expect(screen.getByText(/save to include your changes/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(pdf.download).toHaveBeenCalledWith(expect.any(Blob), "QCFRM-012 CPU-95 25564.pdf"));
    expect(pdf.generate).toHaveBeenCalledWith(SPEC, RECORD, expect.objectContaining({ exportedOn: expect.any(String) }));
    expect(updateRecord).not.toHaveBeenCalled();
  });
});

describe("Enter behaves like Tab, not like Save", () => {
  // Native browsers implicitly submit a <form> when Enter is pressed in a
  // single-line text/number input — with ~200 of those on one screen
  // (mostly the firing-angle grid), that's exactly the key someone moving
  // between cells reaches for, and it used to save (or refuse-and-interrupt
  // on a blank Serial Number) mid-entry (Tim, 2026-09-17). Enter is
  // redirected to move focus to the next field instead, same as Tab — the
  // ONLY way to reach Save with Enter is tabbing/Entering all the way to it.
  it("does not submit from the Serial / Unit Number text field", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Serial / Unit Number"), "25999{Enter}");
    expect(createRecord).not.toHaveBeenCalled();
    // The required-field error a blocked submit would have raised is absent.
    expect(screen.queryByText("Serial / Unit Number is required.")).not.toBeInTheDocument();
  });

  it("does not submit from a plain number field", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Test RPM"), "1200{Enter}");
    expect(createRecord).not.toHaveBeenCalled();
  });

  it("moves focus to the next field, exactly like Tab", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    const testRpm = screen.getByLabelText("Test RPM");
    const testStandNumber = screen.getByLabelText("Test Stand Number");
    await userEvent.type(testRpm, "1200{Enter}");
    expect(testStandNumber).toHaveFocus();
  });

  it("does not intercept Enter inside Comments — it stays a literal new line", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    const comments = screen.getByLabelText("Comments");
    await userEvent.type(comments, "line one{Enter}line two");
    expect(comments).toHaveValue("line one\nline two");
    expect(createRecord).not.toHaveBeenCalled();
  });

  it("still submits once Enter (or Tab) has reached the Save button itself", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Serial / Unit Number"), "25999");
    screen.getByRole("button", { name: "Save test sheet" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(createRecord).toHaveBeenCalled();
  });

  it("still submits via a genuine click on Save", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Serial / Unit Number"), "25999");
    await userEvent.click(screen.getByRole("button", { name: "Save test sheet" }));
    expect(createRecord).toHaveBeenCalled();
  });
});

describe("checks and firing angles", () => {
  it("answers a check Yes, No or N/A, and saves the answer", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}record={RECORD} onClose={onClose} />);
    const group = screen.getByRole("radiogroup", { name: "Multi-fire, no warnings" });
    await userEvent.click(within(group).getByRole("radio", { name: "N/A" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(updateRecord).toHaveBeenCalledWith(
        expect.objectContaining({ values: expect.objectContaining({ finalMultiFire: "N/A" }) }),
      ),
    );
  });

  it("hides the actual boxes once every actual is at spec, and offers one per cylinder otherwise", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}record={RECORD} onClose={onClose} />);
    // 791950-16: sixteen cylinders, lettered A … V.
    expect(screen.getAllByLabelText(/^Spec /)).toHaveLength(16);
    expect(screen.getAllByLabelText(/^Actual /)).toHaveLength(16);
    expect(screen.getByLabelText("Actual K")).toBeInTheDocument();

    const atSpec = screen.getByRole("radiogroup", { name: "All firing actuals at spec" });
    await userEvent.click(within(atSpec).getByRole("radio", { name: "Yes" }));
    expect(screen.queryAllByLabelText(/^Actual /)).toHaveLength(0);
    expect(screen.getAllByLabelText(/^Spec /)).toHaveLength(16);
  });

  it("moves Enter past a check's pills and its Clear to the next field", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}record={RECORD} onClose={onClose} />);
    const group = screen.getByRole("radiogroup", { name: "Multi-fire, no warnings" });
    const yes = within(group).getByRole("radio", { name: "Yes" });
    await userEvent.click(yes);
    yes.focus();
    await userEvent.keyboard("{Enter}");
    expect(group.contains(document.activeElement)).toBe(false);
    // Clear is next in DOM order; landing there, a second Enter would wipe the answer.
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Clear Multi-fire, no warnings" }));
    expect(yes).toBeChecked();
  });

  it("starts a check unanswered, with no pill picked, and Clear puts an answer back to blank", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    const group = screen.getByRole("radiogroup", { name: "Multi-fire, no warnings" });
    expect(within(group).getAllByRole("radio").some((r) => (r as HTMLInputElement).checked)).toBe(false);
    await userEvent.click(within(group).getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear Multi-fire, no warnings" }));
    expect(within(group).getAllByRole("radio").some((r) => (r as HTMLInputElement).checked)).toBe(false);
  });
});

describe("standard firing specs", () => {
  it("fills a NEW sheet's specs from the part number, and keeps the ones the operator typed", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Altronic Part Number"), "791950-16");
    expect(screen.getByLabelText("Spec A")).toHaveValue(0);
    expect(screen.getByLabelText("Spec D")).toHaveValue(135);
    expect(screen.getByLabelText("Spec M")).toHaveValue(0);

    // A special case: one cylinder typed by hand.
    await userEvent.clear(screen.getByLabelText("Spec B"));
    await userEvent.type(screen.getByLabelText("Spec B"), "47");

    // A corrected part number refills the untouched specs, never the typed one.
    await userEvent.clear(screen.getByLabelText("Altronic Part Number"));
    await userEvent.type(screen.getByLabelText("Altronic Part Number"), "791955-16");
    expect(screen.getByLabelText("Spec C")).toHaveValue(90);
    expect(screen.getByLabelText("Spec D")).toHaveValue(150);
    expect(screen.getByLabelText("Spec B")).toHaveValue(47);

    await userEvent.type(screen.getByLabelText("Serial / Unit Number"), "26001");
    await userEvent.click(screen.getByRole("button", { name: "Save test sheet" }));
    expect(createRecord).toHaveBeenCalledWith(
      expect.objectContaining({ firingSpec02: "47", firingSpec04: "150", firingSpec16: "330" }),
    );
  });

  it("blanks the specs again for a part number with no standard", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Altronic Part Number"), "791950-16");
    expect(screen.getByLabelText("Spec C")).toHaveValue(90);
    await userEvent.clear(screen.getByLabelText("Altronic Part Number"));
    await userEvent.type(screen.getByLabelText("Altronic Part Number"), "708939");
    expect(screen.getByLabelText("Spec C")).toHaveValue(null);
  });

  it("never changes a SAVED sheet by itself, but Fill standard specs fills its blanks", async () => {
    const record = { ...RECORD, values: { ...RECORD.values, firingSpec01: "5" } };
    renderWithProviders(<QcFormModal spec={SPEC}record={record} onClose={onClose} />);
    expect(screen.getByLabelText("Spec B")).toHaveValue(null);

    await userEvent.click(screen.getByRole("button", { name: "Fill standard specs" }));
    expect(screen.getByLabelText("Spec A")).toHaveValue(5);
    expect(screen.getByLabelText("Spec B")).toHaveValue(45);
    expect(screen.queryByRole("button", { name: "Fill standard specs" })).not.toBeInTheDocument();
  });
});

describe("Altronic Part Number — a real input, not a closed dropdown", () => {
  // Production enters this field with a barcode scanner: characters, then a
  // trailing CR (Enter), immediately followed by scanning the next field.
  // A control that has to be opened before it accepts anything (the
  // originally-shipped SingleSelect) eats that first scan; SuggestInput
  // accepts characters the instant it's focused, same as any other field.
  it("accepts typed/scanned characters immediately, with no dropdown to open first", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    const partNumber = screen.getByLabelText("Altronic Part Number");
    await userEvent.type(partNumber, "791950-16");
    expect(partNumber).toHaveValue("791950-16");
  });

  it("advances Serial Number → Altronic Part Number → Logic Board Date Code on Enter, back to back like a barcode scan", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Serial / Unit Number"), "25999{Enter}");
    const partNumber = screen.getByLabelText("Altronic Part Number");
    expect(partNumber).toHaveFocus();

    await userEvent.type(partNumber, "791950-16{Enter}");
    expect(screen.getByLabelText("Logic Board Date Code")).toHaveFocus();
    expect(createRecord).not.toHaveBeenCalled();
  });

  it("still accepts a value that isn't one of the known variants", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    const partNumber = screen.getByLabelText("Altronic Part Number");
    await userEvent.type(partNumber, "791950-16-SS");
    expect(partNumber).toHaveValue("791950-16-SS");
    // Genuinely unrecognized — SuggestInput's own "new value" note is right here.
    expect(screen.getByText(/new value/i)).toBeInTheDocument();
  });

  // Reported live, 2026-09-17: scanning the older "791950-8" spelling
  // correctly resolved Altmode 1 (see qcCpu95Mapper.test.ts), but the field
  // still called it a "new value" — confusing for something fully
  // recognized, just spelled the old way. Fixed by listing "791950-8" as its
  // own suggestion alongside "791950-08" (QC_CPU95_PART_NUMBER_SUGGESTIONS).
  it("does NOT call '791950-8' a new value — it's a known alias of '791950-08'", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    const partNumber = screen.getByLabelText("Altronic Part Number");
    await userEvent.type(partNumber, "791950-8");
    expect(partNumber).toHaveValue("791950-8");
    expect(screen.queryByText(/new value/i)).not.toBeInTheDocument();
  });

  it("shows a 791955-16 the CPU-95C checks and hides the base ones its sheet hasn't got", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    const partNumber = screen.getByLabelText("Altronic Part Number");
    await userEvent.type(partNumber, "791955-16");
    expect(screen.getByText("Display reads Ready")).toBeInTheDocument();
    expect(screen.getByLabelText("Application")).toBeInTheDocument();
    expect(screen.queryByText("Internal 4 LEDs normal operation")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Memory No.")).not.toBeInTheDocument();
  });

  it("shows an EVS its E1 supply currents and no peak volts", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Altronic Part Number"), "791963-16E");
    expect(screen.getAllByLabelText("E1 Single Supply Current (Amps)")).toHaveLength(2);
    expect(screen.queryByLabelText("20V Input Peak Volt E1 (130V)")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("CAVG")).toHaveLength(2);
  });

  it("shows the 'On 791956-16' checks only once the part number is 791956-16", async () => {
    renderWithProviders(<QcFormModal spec={SPEC}onClose={onClose} />);
    const partNumber = screen.getByLabelText("Altronic Part Number");
    await userEvent.type(partNumber, "791962-18");
    expect(screen.queryByText("On 791956-16, verify CAN communication")).not.toBeInTheDocument();

    await userEvent.clear(partNumber);
    await userEvent.type(partNumber, "791956-16");
    expect(screen.getByText("On 791956-16, verify CAN communication")).toBeInTheDocument();
    expect(screen.queryByText(/new value/i)).not.toBeInTheDocument();
  });
});

describe("GET-1 on the same modal", () => {
  it("opens on the serial, and keeps the firmware revision after its checks, as on the paper", async () => {
    const { QC_GET1_FORM } = await import("@/lib/qcGet1Form");
    renderWithProviders(<QcFormModal spec={QC_GET1_FORM} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "New GE ECU log sheet" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Serial Number" })).toHaveFocus();

    const lastCheck = screen.getByRole("radiogroup", { name: "Verify Ship Firmware Revision on PC" });
    const revision = screen.getByRole("textbox", { name: "Ship Firmware Revision" });
    expect(lastCheck.compareDocumentPosition(revision) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("saves a sheet with only the serial, through the create mutation", async () => {
    const { QC_GET1_FORM } = await import("@/lib/qcGet1Form");
    renderWithProviders(<QcFormModal spec={QC_GET1_FORM} onClose={onClose} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Serial Number" }), "FM2601/0003T");
    await userEvent.click(screen.getByRole("button", { name: "Save log sheet" }));
    await waitFor(() => expect(createRecord).toHaveBeenCalledTimes(1));
    expect(createRecord).toHaveBeenCalledWith(expect.objectContaining({ serialNumber: "FM2601/0003T" }));
  });
});
