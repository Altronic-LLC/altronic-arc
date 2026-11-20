import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { PastedPartResult } from "@/hooks/usePricingLookup";

// The paste box (Ray, 2026-10-22): a number SAP couldn't be asked about is NOT
// added as a blank row — it stays in the box to try again; a pasted header
// word isn't a part.

const lookUp = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/usePricingLookup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/usePricingLookup")>();
  return { ...actual, useLookUpSapParts: () => lookUp };
});

import { MultiPartAdd, pastedPartNumbers } from "./MultiPartAdd";

const PART = { altronicPartNumber: "910007-15", sapPartNumber: "9100-0007-15", description: "HARNESS", mpg: "HRN", listPrice: null, cost: 10 };

describe("pastedPartNumbers", () => {
  it("drops words with no digit — a pasted column header", () => {
    expect(pastedPartNumbers("SAP Part Number\n9100-0007-15\n910007-25")).toEqual(["9100-0007-15", "910007-25"]);
  });
});

describe("MultiPartAdd", () => {
  it("adds what SAP answered, and leaves the ones it couldn't check in the box to try again", async () => {
    lookUp.mockResolvedValueOnce([
      { number: "9100-0007-15", part: PART, failed: false },
      { number: "910007-99", part: null, failed: true, error: new Error("network") },
    ] satisfies PastedPartResult[]);
    const onAdd = vi.fn(() => "Added 1 part.");
    renderWithProviders(<MultiPartAdd label="Paste" onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText("Paste"), "Part# 9100-0007-15 910007-99{Enter}");

    expect(await screen.findByText(/Added 1 part\. 1 couldn't be checked — SAP couldn't be reached just now\. Left in the box/)).toBeInTheDocument();
    expect(lookUp).toHaveBeenCalledWith(["9100-0007-15", "910007-99"]);
    expect(onAdd).toHaveBeenCalledWith([expect.objectContaining({ number: "9100-0007-15" })]);
    expect(screen.getByLabelText("Paste")).toHaveValue("910007-99");

    // Add again asks only for what was left.
    lookUp.mockResolvedValueOnce([{ number: "910007-99", part: { ...PART, altronicPartNumber: "910007-99" }, failed: false }]);
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(lookUp).toHaveBeenLastCalledWith(["910007-99"]);
    expect(onAdd).toHaveBeenCalledTimes(2);
  });
});
