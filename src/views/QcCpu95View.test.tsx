import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  records: [] as unknown[],
  isLoading: false,
}));

vi.mock("@/hooks/useQcCpu95", () => ({
  useQcCpu95Records: () => ({ data: state.records, isLoading: state.isLoading }),
}));

vi.mock("@/components/QcCpu95FormModal", () => ({
  QcCpu95FormModal: ({ record, onClose }: { record?: { id: number }; onClose: () => void }) => (
    <div role="dialog" aria-label={record ? "Edit CPU-95 test sheet" : "New CPU-95 test sheet"}>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { qcCpu95EmptyValues } from "@/lib/qcCpu95Fields";
import type { QcCpu95Record } from "@/types/task";
import { QcCpu95View } from "./QcCpu95View";

beforeEach(() => {
  state.records = [];
  state.isLoading = false;
});

function makeRecord(id: number, overrides: Record<string, string> = {}, over: Partial<QcCpu95Record> = {}): QcCpu95Record {
  return {
    id,
    values: { ...qcCpu95EmptyValues(), ...overrides },
    createdAt: new Date(),
    modifiedAt: new Date(),
    ...over,
  };
}

// The view renders BOTH a phone card list and a desktop table for the same
// rows (CSS hides one or the other; jsdom has no viewport, so both are in
// the DOM at once) — every assertion below expects AT LEAST one match
// rather than exactly one, the same convention QcTimeTrackingView's tests
// use for the identical reason.
describe("QcCpu95View", () => {
  it("shows a loading state", () => {
    state.isLoading = true;
    renderWithProviders(<QcCpu95View />);
    expect(screen.getByText(/\w+ cpu-95 test sheets$/i)).toBeInTheDocument();
  });

  it("shows an empty state with no test sheets", () => {
    renderWithProviders(<QcCpu95View />);
    expect(screen.getByText(/no test sheets yet/i)).toBeInTheDocument();
  });

  it("lists a test sheet's key columns", () => {
    state.records = [
      makeRecord(1, {
        serialNumber: "25564",
        altronicPartNumber: "791950-16",
        customer: "Acme Co",
        testStandNumber: "1",
      }),
    ];
    renderWithProviders(<QcCpu95View />);
    expect(screen.getAllByText("25564").length).toBeGreaterThan(0);
    expect(screen.getAllByText("791950-16").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Acme Co").length).toBeGreaterThan(0);
  });

  it("has no visible Altmode anywhere — it's an internal value, not a list column", () => {
    state.records = [makeRecord(1, { serialNumber: "25564", altronicPartNumber: "791950-16" })];
    renderWithProviders(<QcCpu95View />);
    expect(screen.queryByText(/altmode/i)).not.toBeInTheDocument();
  });

  describe("the status LED", () => {
    it("shows In Process for a fresh sheet", () => {
      state.records = [makeRecord(1, { serialNumber: "25564" })];
      renderWithProviders(<QcCpu95View />);
      expect(screen.getAllByTitle("In Process").length).toBeGreaterThan(0);
    });

    it("shows In Queue once a unit is scanned in but nothing else is filled out yet", () => {
      state.records = [
        makeRecord(1, { serialNumber: "26305", altronicPartNumber: "791950-18" }),
      ];
      renderWithProviders(<QcCpu95View />);
      expect(screen.getAllByTitle("In Queue").length).toBeGreaterThan(0);
    });

    it("does NOT show In Queue with only one of the two identifying fields set", () => {
      state.records = [makeRecord(1, { serialNumber: "26305" })];
      renderWithProviders(<QcCpu95View />);
      expect(screen.getAllByTitle("In Process").length).toBeGreaterThan(0);
      expect(screen.queryByTitle("In Queue")).not.toBeInTheDocument();
    });

    it("shows In Repair once the In Repair box is checked", () => {
      state.records = [makeRecord(1, { serialNumber: "25564", inRepair: "Yes" })];
      renderWithProviders(<QcCpu95View />);
      expect(screen.getAllByTitle("In Repair").length).toBeGreaterThan(0);
    });

    it("shows Complete once Final Inspection is signed off, even if it was in repair", () => {
      state.records = [
        makeRecord(1, {
          serialNumber: "25564",
          inRepair: "Yes",
          finalInspectionBy: "JN",
          finalInspectionDate: "2026-05-13",
        }),
      ];
      renderWithProviders(<QcCpu95View />);
      expect(screen.getAllByTitle("Complete").length).toBeGreaterThan(0);
      expect(screen.queryByTitle("In Repair")).not.toBeInTheDocument();
    });

    it("defaults the list to In Process, In Queue, In Repair, Complete — newest tested first within each", () => {
      // A genuinely queued record can't carry a Date Tested (filling one in
      // is exactly what moves it out of "queued"), so there's no meaningful
      // "newest first" ordering *within* that one bucket to assert — just its
      // position between In Process and In Repair.
      state.records = [
        makeRecord(1, { serialNumber: "COMPLETE-OLD", dateTested: "2026-01-01", finalInspectionBy: "JN", finalInspectionDate: "2026-01-02" }),
        makeRecord(2, { serialNumber: "PROCESS-OLD", dateTested: "2026-01-01" }),
        makeRecord(3, { serialNumber: "REPAIR-NEW", dateTested: "2026-06-01", inRepair: "Yes" }),
        makeRecord(4, { serialNumber: "PROCESS-NEW", dateTested: "2026-06-01" }),
        makeRecord(5, { serialNumber: "REPAIR-OLD", dateTested: "2026-01-01", inRepair: "Yes" }),
        makeRecord(6, { serialNumber: "COMPLETE-NEW", dateTested: "2026-06-01", finalInspectionBy: "JN", finalInspectionDate: "2026-06-02" }),
        makeRecord(7, { serialNumber: "QUEUED-ONLY", altronicPartNumber: "791950-18" }),
      ];
      renderWithProviders(<QcCpu95View />);
      const rows = screen.getAllByRole("row").slice(1); // drop the header row
      const order = rows.map((row) => row.textContent);
      const serialAt = (serial: string) => order.findIndex((text) => text?.includes(serial));
      expect(serialAt("PROCESS-NEW")).toBeLessThan(serialAt("PROCESS-OLD"));
      expect(serialAt("PROCESS-OLD")).toBeLessThan(serialAt("QUEUED-ONLY"));
      expect(serialAt("QUEUED-ONLY")).toBeLessThan(serialAt("REPAIR-NEW"));
      expect(serialAt("REPAIR-NEW")).toBeLessThan(serialAt("REPAIR-OLD"));
      expect(serialAt("REPAIR-OLD")).toBeLessThan(serialAt("COMPLETE-NEW"));
      expect(serialAt("COMPLETE-NEW")).toBeLessThan(serialAt("COMPLETE-OLD"));
    });
  });

  it("filters by search across serial#, part#, customer, test stand and tester", async () => {
    state.records = [
      makeRecord(1, { serialNumber: "25564", customer: "Acme Co" }),
      makeRecord(2, { serialNumber: "99999", customer: "Beta LLC" }),
    ];
    renderWithProviders(<QcCpu95View />);
    await userEvent.type(screen.getByPlaceholderText(/search serial#/i), "Acme");
    await waitFor(() => expect(screen.queryAllByText("99999")).toHaveLength(0));
    expect(screen.getAllByText("25564").length).toBeGreaterThan(0);
  });

  it("opens the New Test Sheet modal in create mode", async () => {
    renderWithProviders(<QcCpu95View />);
    await userEvent.click(screen.getByRole("button", { name: /new test sheet/i }));
    expect(screen.getByRole("dialog", { name: "New CPU-95 test sheet" })).toBeInTheDocument();
  });

  it("opens a row in edit mode when clicked", async () => {
    state.records = [makeRecord(1, { serialNumber: "25564" })];
    renderWithProviders(<QcCpu95View />);
    // Either representation (card or table row) opens the same modal —
    // click whichever one comes first.
    await userEvent.click(screen.getAllByText("25564")[0]);
    expect(screen.getByRole("dialog", { name: "Edit CPU-95 test sheet" })).toBeInTheDocument();
  });

  it("opens the phone card in edit mode when clicked", async () => {
    state.records = [makeRecord(1, { serialNumber: "25564" })];
    renderWithProviders(<QcCpu95View />);
    await userEvent.click(screen.getByRole("button", { name: /25564/ }));
    expect(screen.getByRole("dialog", { name: "Edit CPU-95 test sheet" })).toBeInTheDocument();
  });

  it("has no delete control anywhere on the page", () => {
    state.records = [makeRecord(1, { serialNumber: "25564" })];
    renderWithProviders(<QcCpu95View />);
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });
});

describe("the phone card layout", () => {
  it("renders a card per sheet with the status, serial number, and a labelled field for everything else", () => {
    state.records = [
      makeRecord(1, {
        serialNumber: "25564",
        altronicPartNumber: "791950-16",
        customer: "Acme Co",
        testStandNumber: "1",
        dateTested: "2026-05-13",
        finalTestBy: "JN",
        finalInspectionDate: "2026-05-14",
      }),
    ];
    renderWithProviders(<QcCpu95View />);
    const card = screen.getByRole("button", { name: /25564/ });
    expect(card).toHaveTextContent("25564");
    expect(card).toHaveTextContent("In Process");
    expect(within(card).getByText("Altronic Part #")).toBeInTheDocument();
    expect(within(card).getByText("791950-16")).toBeInTheDocument();
    expect(within(card).getByText("Customer")).toBeInTheDocument();
    expect(within(card).getByText("Acme Co")).toBeInTheDocument();
    expect(within(card).getByText("Test Stand #")).toBeInTheDocument();
    expect(within(card).getByText("Final Test By")).toBeInTheDocument();
    expect(within(card).getByText("JN")).toBeInTheDocument();
  });

  it("shows a dash for a field the real data frequently leaves blank", () => {
    state.records = [makeRecord(1, { serialNumber: "25564" })];
    renderWithProviders(<QcCpu95View />);
    const card = screen.getByRole("button", { name: /25564/ });
    // dl/dt/dd renders each blank field's value as an em dash — assert at
    // least one shows up rather than pinning an exact count.
    expect(within(card).getAllByText("—").length).toBeGreaterThan(0);
  });
});
