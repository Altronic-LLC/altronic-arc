import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { SubAssemblyDraft } from "@/api/newProductSubAssemblies";
import { PartCard, SubAssemblyCard } from "./SubAssemblyCard";
import { ToastContainer } from "./Toast";

// Mock mode: SAP is the pricing mock store, which holds 2001-0310-15 at $120
// and 791952-18 with no cost.

function draft(patch: Partial<SubAssemblyDraft> = {}): SubAssemblyDraft {
  return {
    key: "row-1",
    id: null,
    name: "Test assembly",
    kind: "Sub-Assembly",
    altronicPartNumber: "",
    sapPartNumber: "",
    quantityPerProduct: 1,
    overheadPct: null,
    pricing: null,
    pricingCorrupt: false,
    lines: [
      { partNumber: "593027-15", sapPartNumber: "2001-0310-15", description: "FROM THE SHEET", quantity: 2, uploadedCost: 99, adjustedCost: null, source: "csv" },
      { partNumber: "791952-18", sapPartNumber: "1003-0115-18", description: "NO SAP COST", quantity: 1, uploadedCost: 50, adjustedCost: null, source: "csv" },
    ],
    fileName: "",
    uploadedAt: null,
    uploadedBy: null,
    ...patch,
  } as SubAssemblyDraft;
}

function Harness({ start, onDraft, part = false }: { start: SubAssemblyDraft; onDraft: (d: SubAssemblyDraft) => void; part?: boolean }) {
  const [d, setD] = useState(start);
  const change = (next: SubAssemblyDraft) => {
    setD(next);
    onDraft(next);
  };
  return (
    <>
      {part ? (
        <PartCard draft={d} onChange={change} onRemove={() => {}} readOnly={false} worksheetDiscountPct={34} />
      ) : (
        <SubAssemblyCard draft={d} onChange={change} onRemove={() => {}} readOnly={false} uploader={{ displayName: "Me", email: "me@x" }} worksheetDiscountPct={34} />
      )}
      <ToastContainer />
    </>
  );
}

describe("Pull SAP cost — one component", () => {
  it("replaces a CSV line's base cost with SAP's, marks it SAP, and leaves the other lines alone", async () => {
    const onDraft = vi.fn();
    renderWithProviders(<Harness start={draft()} onDraft={onDraft} />);
    await userEvent.click(screen.getByRole("button", { name: /Pull SAP cost for 593027-15/ }));

    await waitFor(() => expect(onDraft).toHaveBeenCalled(), { timeout: 10_000 });
    const lines = onDraft.mock.calls.at(-1)![0].lines;
    expect(lines[0]).toMatchObject({ uploadedCost: 120, source: "sap", description: "FROM THE SHEET", quantity: 2 });
    expect(lines[1]).toMatchObject({ uploadedCost: 50, source: "csv" });
    expect(await screen.findByText(/now SAP's \$120\.00 \(was \$99\.00\)/)).toBeInTheDocument();
  });

  it("leaves the base alone, and says why, when SAP holds no cost", async () => {
    const onDraft = vi.fn();
    renderWithProviders(<Harness start={draft()} onDraft={onDraft} />);
    await userEvent.click(screen.getByRole("button", { name: /Pull SAP cost for 791952-18/ }));
    expect(await screen.findByText(/holds no cost/, {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(onDraft).not.toHaveBeenCalled();
  });
});

describe("Pull SAP cost — a standalone part", () => {
  it("puts SAP's cost in the part's base", async () => {
    const onDraft = vi.fn();
    const start = draft({
      kind: "part",
      name: "MY TYPED PART",
      altronicPartNumber: "593027-15",
      sapPartNumber: "2001-0310-15",
      lines: [{ partNumber: "593027-15", sapPartNumber: "2001-0310-15", description: "MY TYPED PART", quantity: 1, uploadedCost: 10, adjustedCost: null, source: "manual" }],
    });
    renderWithProviders(<Harness start={start} onDraft={onDraft} part />);
    const card = screen.getByRole("region", { name: /Part 593027-15/ });
    await userEvent.click(within(card).getByRole("button", { name: /Pull SAP cost/ }));

    await waitFor(() => expect(onDraft).toHaveBeenCalled(), { timeout: 10_000 });
    const next = onDraft.mock.calls.at(-1)![0];
    expect(next.lines[0]).toMatchObject({ uploadedCost: 120, source: "sap" });
    expect(next.name).toBe("MY TYPED PART");
  });
});
