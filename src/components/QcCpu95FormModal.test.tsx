import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// The CPU-95 (QCFRM-012) test sheet form modal.
//
// What's worth pinning: Serial Number is the only required field, Enter in
// any of the ~200 plain text/number fields must NOT submit the form (native
// browser "implicit submission" — reported live, 2026-09-17, entering the
// firing-angle grid cell by cell), and edit saves through the update
// mutation with the whole draft, matching QC Time Tracking's shape.
// =============================================================================

const createRecord = vi.hoisted(() => vi.fn(async () => ({ id: 1 })));
const updateRecord = vi.hoisted(() => vi.fn(async () => ({ id: 1 })));
vi.mock("@/hooks/useQcCpu95", () => ({
  useCreateQcCpu95Record: () => ({ mutateAsync: createRecord, isPending: false }),
  useUpdateQcCpu95Record: () => ({ mutateAsync: updateRecord, isPending: false }),
}));

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { qcCpu95EmptyValues } from "@/lib/qcCpu95Fields";
import type { QcCpu95Record } from "@/types/task";
import { QcCpu95FormModal } from "./QcCpu95FormModal";

const RECORD: QcCpu95Record = {
  id: 1,
  values: { ...qcCpu95EmptyValues(), serialNumber: "25564", altronicPartNumber: "791950-16" },
  createdAt: new Date(),
  modifiedAt: new Date(),
};

const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("creating a new test sheet", () => {
  it("refuses an empty Serial / Unit Number", async () => {
    renderWithProviders(<QcCpu95FormModal onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Save test sheet" }));
    expect(createRecord).not.toHaveBeenCalled();
    expect(screen.getByText("Serial / Unit Number is required.")).toBeInTheDocument();
  });

  it("saves through the create mutation on Save", async () => {
    renderWithProviders(<QcCpu95FormModal onClose={onClose} />);
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
    renderWithProviders(<QcCpu95FormModal record={RECORD} onClose={onClose} />);
    expect(screen.getByLabelText("Serial / Unit Number")).toHaveValue("25564");
  });

  it("saves through the update mutation, not create", async () => {
    renderWithProviders(<QcCpu95FormModal record={RECORD} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, values: expect.objectContaining({ serialNumber: "25564" }) }),
    );
    expect(createRecord).not.toHaveBeenCalled();
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
    renderWithProviders(<QcCpu95FormModal onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Serial / Unit Number"), "25999{Enter}");
    expect(createRecord).not.toHaveBeenCalled();
    // The required-field error a blocked submit would have raised is absent.
    expect(screen.queryByText("Serial / Unit Number is required.")).not.toBeInTheDocument();
  });

  it("does not submit from a plain number field", async () => {
    renderWithProviders(<QcCpu95FormModal onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Test RPM"), "1200{Enter}");
    expect(createRecord).not.toHaveBeenCalled();
  });

  it("moves focus to the next field, exactly like Tab", async () => {
    renderWithProviders(<QcCpu95FormModal onClose={onClose} />);
    const testRpm = screen.getByLabelText("Test RPM");
    const testStandNumber = screen.getByLabelText("Test Stand Number");
    await userEvent.type(testRpm, "1200{Enter}");
    expect(testStandNumber).toHaveFocus();
  });

  it("does not intercept Enter inside Comments — it stays a literal new line", async () => {
    renderWithProviders(<QcCpu95FormModal onClose={onClose} />);
    const comments = screen.getByLabelText("Comments");
    await userEvent.type(comments, "line one{Enter}line two");
    expect(comments).toHaveValue("line one\nline two");
    expect(createRecord).not.toHaveBeenCalled();
  });

  it("still submits once Enter (or Tab) has reached the Save button itself", async () => {
    renderWithProviders(<QcCpu95FormModal onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Serial / Unit Number"), "25999");
    screen.getByRole("button", { name: "Save test sheet" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(createRecord).toHaveBeenCalled();
  });

  it("still submits via a genuine click on Save", async () => {
    renderWithProviders(<QcCpu95FormModal onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Serial / Unit Number"), "25999");
    await userEvent.click(screen.getByRole("button", { name: "Save test sheet" }));
    expect(createRecord).toHaveBeenCalled();
  });
});

describe("Altronic Part Number — a real input, not a closed dropdown", () => {
  // Production enters this field with a barcode scanner: characters, then a
  // trailing CR (Enter), immediately followed by scanning the next field.
  // A control that has to be opened before it accepts anything (the
  // originally-shipped SingleSelect) eats that first scan; SuggestInput
  // accepts characters the instant it's focused, same as any other field.
  it("accepts typed/scanned characters immediately, with no dropdown to open first", async () => {
    renderWithProviders(<QcCpu95FormModal onClose={onClose} />);
    const partNumber = screen.getByLabelText("Altronic Part Number");
    await userEvent.type(partNumber, "791950-16");
    expect(partNumber).toHaveValue("791950-16");
  });

  it("advances Serial Number → Altronic Part Number → Logic Board Date Code on Enter, back to back like a barcode scan", async () => {
    renderWithProviders(<QcCpu95FormModal onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Serial / Unit Number"), "25999{Enter}");
    const partNumber = screen.getByLabelText("Altronic Part Number");
    expect(partNumber).toHaveFocus();

    await userEvent.type(partNumber, "791950-16{Enter}");
    expect(screen.getByLabelText("Logic Board Date Code")).toHaveFocus();
    expect(createRecord).not.toHaveBeenCalled();
  });

  it("still accepts a value that isn't one of the known variants", async () => {
    renderWithProviders(<QcCpu95FormModal onClose={onClose} />);
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
    renderWithProviders(<QcCpu95FormModal onClose={onClose} />);
    const partNumber = screen.getByLabelText("Altronic Part Number");
    await userEvent.type(partNumber, "791950-8");
    expect(partNumber).toHaveValue("791950-8");
    expect(screen.queryByText(/new value/i)).not.toBeInTheDocument();
  });
});
