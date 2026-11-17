import { describe, expect, it } from "vitest";
import { NEW_HIRE_SELECT, newHireInputFields, stepFields, toNewHire, toSpStartDate } from "./newHireMapper";
import { emptyNewHireInput } from "./newHire";

describe("Graph item → NewHire", () => {
  const item = {
    id: "7",
    createdBy: { user: { displayName: "HR Person", email: "hr@example.com" } },
    createdDateTime: "2026-11-01T14:00:00Z",
    fields: {
      Title: "Davey Jones",
      StartDate: "2026-03-01T12:00:00Z",
      LegalFirstName: "David",
      PreferredFirstName: "Davey",
      LastName: "Jones",
      WorkEmail: "Davey.Jones@altronic-llc.com",
      EmploymentType: "contractor",
      Manager: "Kenneth Example <kenneth@example.com>",
      NeedsComputer: false,
      AddedToSapAt: "2026-11-02T15:00:00Z",
      AddedToSapBy: "Sam SAP <sam@example.com>",
      Status: "Submitted",
    },
  };

  it("reads the columns, the manager line and the step stamp", () => {
    const hire = toNewHire(item);
    expect(hire).toMatchObject({
      id: 7,
      displayName: "Davey Jones",
      startDate: "2026-03-01",
      employmentType: "Contractor",
      manager: { displayName: "Kenneth Example", email: "kenneth@example.com" },
      needsComputer: false,
      submittedBy: { displayName: "HR Person", email: "hr@example.com" },
    });
    expect(hire.steps.addedToSap?.by).toEqual({ displayName: "Sam SAP", email: "sam@example.com" });
    expect(hire.steps.itTicketRaised).toBeNull();
  });

  it("derives the status from the steps, never trusting the column", () => {
    // Stored "Submitted", but SAP is ticked — so it's In progress.
    expect(toNewHire(item).status).toBe("In progress");
  });

  it("reads a SharePoint-written local-midnight date as its calendar day", () => {
    expect(toNewHire({ ...item, fields: { ...item.fields, StartDate: "2026-03-01T05:00:00Z" } }).startDate).toBe("2026-03-01");
  });
});

describe("NewHire → columns", () => {
  it("writes only the keys given, and the display name with the names", () => {
    const merged = { ...emptyNewHireInput(), legalFirstName: "Robert", preferredFirstName: "Rob", lastName: "Jones" };
    expect(newHireInputFields({ preferredFirstName: "Rob" }, merged)).toEqual({ PreferredFirstName: "Rob", Title: "Rob Jones" });
    expect(newHireInputFields({ jobTitle: " Engineer " }, merged)).toEqual({ JobTitle: "Engineer" });
  });

  it("writes the manager as one Name <email> line, and a start date at midday UTC", () => {
    const merged = emptyNewHireInput();
    expect(
      newHireInputFields({ manager: { displayName: "A Manager", email: "m@example.com" }, startDate: "2026-12-01" }, merged),
    ).toEqual({ Manager: "A Manager <m@example.com>", StartDate: "2026-12-01T12:00:00Z" });
    expect(toSpStartDate("")).toBeNull();
  });

  it("clears both of a step's columns on untick", () => {
    expect(stepFields("itTicketRaised", null)).toEqual({ ItTicketRaisedAt: null, ItTicketRaisedBy: "" });
  });

  it("selects every column it reads", () => {
    for (const col of ["WorkEmail", "Manager", "ComputerSetUpBy", "CancelReason", "Status"]) {
      expect(NEW_HIRE_SELECT.split(",")).toContain(col);
    }
  });
});
