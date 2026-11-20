import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { mockNewHires } from "@/data/hrMockData";
import { NewHireSapCheck } from "./NewHireSapCheck";

// The card in demo mode, against MOCK_SAP_EMPLOYEES — what a person reads.

function hireNamed(name: string) {
  const hire = mockNewHires().find((h) => h.displayName === name);
  if (!hire) throw new Error(`no demo hire ${name}`);
  return hire;
}

describe("NewHireSapCheck", () => {
  it("says it's checking, then confirms a hire found by EMP number", async () => {
    renderWithProviders(<NewHireSapCheck hire={hireNamed("Morgan Joiner")} />);
    expect(screen.getByText("Checking SAP…")).toBeInTheDocument();
    expect(await screen.findByText("In SAP")).toBeInTheDocument();
    expect(screen.getByText(/Morgan Joiner, employee 900102/)).toBeInTheDocument();
  });

  it("confirms the demo's Tim Webster by name, and says the EMP number isn't recorded", async () => {
    renderWithProviders(<NewHireSapCheck hire={hireNamed("Tim Webster")} />);
    expect(await screen.findByText("In SAP")).toBeInTheDocument();
    expect(screen.getByText(/Tim Webster, employee 900103/)).toBeInTheDocument();
    expect(screen.getByText(/EMP number isn't recorded on this page yet/)).toBeInTheDocument();
  });

  it("finds a hire by their LEGAL first name when they go by another", async () => {
    renderWithProviders(<NewHireSapCheck hire={hireNamed("Drew Contractor")} />);
    expect(await screen.findByText(/Andrew Contractor, employee 900104/)).toBeInTheDocument();
  });

  it("says plainly when a hire isn't in SAP yet", async () => {
    renderWithProviders(<NewHireSapCheck hire={hireNamed("Taylor Newman")} />);
    expect(await screen.findByText("Not in SAP yet.")).toBeInTheDocument();
  });

  it("warns when Added to SAP is ticked but SAP doesn't list them", async () => {
    const hire = { ...hireNamed("Taylor Newman") };
    hire.steps = { ...hire.steps, addedToSap: { at: new Date(), by: { displayName: "Sam Placeholder" } } };
    renderWithProviders(<NewHireSapCheck hire={hire} />);
    expect(await screen.findByText(/"Added to SAP" is ticked/)).toBeInTheDocument();
  });

  it("calls out an EMP number SAP doesn't have", async () => {
    renderWithProviders(<NewHireSapCheck hire={{ ...hireNamed("Morgan Joiner"), empNumber: "999999" }} />);
    expect(await screen.findByText("EMP number 999999 isn't in SAP.")).toBeInTheDocument();
    expect(screen.getByText(/SAP has this name as Morgan Joiner, employee 900102/)).toBeInTheDocument();
  });
});
