// The list showed a coil entry logged today as yesterday: `entry.date` is a
// bare `yyyy-mm-dd`, and `new Date("2026-10-20")` is UTC midnight, which local
// getters read as the 19th everywhere west of Greenwich. That is every Altronic
// user, so the zone is pinned rather than left to whatever machine runs the
// suite — at UTC the bug doesn't exist and this test would pass either way.
const env = (globalThis as unknown as {
  process: { env: Record<string, string | undefined> };
}).process.env;
const previousTz = env.TZ;
env.TZ = "America/New_York";

import { afterAll, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { COIL_DEFECT_FIELDS, type CoilDefectLogEntry } from "@/lib/coilsQc";
import { CoilsQcView } from "./CoilsQcView";

const entry: CoilDefectLogEntry = {
  id: "1",
  coilPartNumber: "591001",
  date: "2026-10-20",
  produced: 10,
  failed: 0,
  defects: Object.fromEntries(COIL_DEFECT_FIELDS.map((field) => [field, 0])) as CoilDefectLogEntry["defects"],
  otherFaultTable: "",
};

vi.mock("@/api/coilsQc", () => ({
  listCoilDefectLog: vi.fn(async () => [entry]),
  listCoilPartNumbers: vi.fn(async () => []),
  listCoilOtherFaults: vi.fn(async () => []),
  createCoilDefectLogEntry: vi.fn(),
  updateCoilDefectLogEntry: vi.fn(),
  addCoilPartNumber: vi.fn(),
  addCoilOtherFault: vi.fn(),
}));

afterAll(() => {
  env.TZ = previousTz;
});

describe("CoilsQcView dates", () => {
  it("shows the stored day, not the day before, in a US timezone", async () => {
    renderWithProviders(<CoilsQcView />);
    const today = new Date(2026, 9, 20).toLocaleDateString();
    const yesterday = new Date(2026, 9, 19).toLocaleDateString();

    // jsdom renders both the phone cards and the table.
    expect(await screen.findAllByText(today)).toHaveLength(2);
    expect(screen.queryByText(yesterday)).toBeNull();
  });
});
