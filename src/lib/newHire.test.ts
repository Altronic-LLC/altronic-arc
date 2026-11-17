import { describe, expect, it } from "vitest";
import type { NewHireInput } from "@/types/hr";
import {
  applicableSteps,
  changedNewHireFields,
  defaultNewHireEmail,
  displayNameFor,
  emptyNewHireInput,
  missingForSubmit,
  newHireStatus,
  safeTicketLink,
  startLabel,
  stepProgress,
} from "./newHire";

const stamp = { at: new Date("2026-11-10T15:00:00Z"), by: { displayName: "Someone", email: "s@example.com" } };
const noSteps = { addedToSap: null, itTicketRaised: null, itAccountCreated: null, computerSetUp: null };

function complete(): NewHireInput {
  return {
    ...emptyNewHireInput(),
    startDate: "2026-12-01",
    legalFirstName: "Robert",
    lastName: "Jones",
    email: "Robert.Jones@altronic-llc.com",
    jobTitle: "Engineer",
    employmentType: "Intern",
    department: "Engineering",
    manager: { displayName: "A Manager", email: "manager@example.com" },
    needsComputer: true,
  };
}

describe("the spreadsheet's calculated columns", () => {
  it("uses the preferred first name when there is one, else the legal one", () => {
    expect(displayNameFor({ legalFirstName: "David", preferredFirstName: "Davey", lastName: "Jones" })).toBe("Davey Jones");
    expect(displayNameFor({ legalFirstName: "Robert", preferredFirstName: " ", lastName: "Jones" })).toBe("Robert Jones");
  });

  it("makes First.Last@altronic-llc.com, as typed", () => {
    expect(defaultNewHireEmail({ legalFirstName: "David", preferredFirstName: "Davey", lastName: "Jones" })).toBe(
      "Davey.Jones@altronic-llc.com",
    );
  });

  it("drops accents, spaces and apostrophes but keeps hyphens", () => {
    expect(defaultNewHireEmail({ legalFirstName: "José", preferredFirstName: "", lastName: "O'Neil-Smith" })).toBe(
      "Jose.ONeil-Smith@altronic-llc.com",
    );
    expect(defaultNewHireEmail({ legalFirstName: "Mary Ann", preferredFirstName: "", lastName: "Van Dyke" })).toBe(
      "MaryAnn.VanDyke@altronic-llc.com",
    );
  });

  it("is blank until both names exist", () => {
    expect(defaultNewHireEmail({ legalFirstName: "Robert", preferredFirstName: "", lastName: "" })).toBe("");
  });
});

describe("the kick-off steps and status", () => {
  it("drops Computer set up only for a definite No", () => {
    expect(applicableSteps({ needsComputer: false })).not.toContain("computerSetUp");
    expect(applicableSteps({ needsComputer: true })).toContain("computerSetUp");
    expect(applicableSteps({ needsComputer: null })).toContain("computerSetUp");
  });

  it("is Submitted, then In progress, then Complete as steps are ticked", () => {
    const base = { needsComputer: true, cancelled: null };
    expect(newHireStatus({ ...base, steps: noSteps })).toBe("Submitted");
    expect(newHireStatus({ ...base, steps: { ...noSteps, addedToSap: stamp } })).toBe("In progress");
    const all = { addedToSap: stamp, itTicketRaised: stamp, itAccountCreated: stamp, computerSetUp: stamp };
    expect(newHireStatus({ ...base, steps: all })).toBe("Complete");
  });

  it("is Complete without the computer step when no computer is needed", () => {
    const three = { ...noSteps, addedToSap: stamp, itTicketRaised: stamp, itAccountCreated: stamp };
    expect(newHireStatus({ needsComputer: false, cancelled: null, steps: three })).toBe("Complete");
    expect(stepProgress({ needsComputer: false, steps: three })).toEqual({ done: 3, total: 3 });
  });

  it("is Cancelled whatever the steps say", () => {
    const all = { addedToSap: stamp, itTicketRaised: stamp, itAccountCreated: stamp, computerSetUp: stamp };
    expect(newHireStatus({ needsComputer: true, steps: all, cancelled: { ...stamp, reason: "Declined" } })).toBe("Cancelled");
  });
});

describe("what a submission needs", () => {
  it("is ready when every required field is filled", () => {
    expect(missingForSubmit(complete())).toEqual([]);
  });

  it("names what is missing, an unanswered computer question included", () => {
    const missing = missingForSubmit({ ...complete(), startDate: "", manager: null, needsComputer: null });
    expect(missing).toEqual(["Start date", "Manager", "Computer"]);
  });

  it("refuses an address that isn't one", () => {
    expect(missingForSubmit({ ...complete(), email: "robert.jones" })).toContain("A valid email");
  });
});

describe("an edit sends only what changed", () => {
  it("ignores spacing and compares the manager by address", () => {
    const prev = complete();
    const next = {
      ...prev,
      jobTitle: "Engineer ",
      manager: { displayName: "Renamed", email: "MANAGER@example.com" },
      deskLocation: "Desk 4",
    };
    expect(changedNewHireFields(prev, next)).toEqual({ deskLocation: "Desk 4" });
  });

  it("sees a change from null to a value", () => {
    expect(changedNewHireFields({ ...complete(), needsComputer: null }, complete())).toEqual({ needsComputer: true });
  });
});

describe("start labels and links", () => {
  const today = new Date(2026, 10, 17, 9, 0);
  it("counts local calendar days", () => {
    expect(startLabel("2026-11-17", today)).toBe("Starts today");
    expect(startLabel("2026-11-18", today)).toBe("Starts tomorrow");
    expect(startLabel("2026-11-22", today)).toBe("Starts in 5 days");
    expect(startLabel("2026-11-14", today)).toBe("Started 3 days ago");
    expect(startLabel("", today)).toBe("");
  });

  it("only opens http(s) ticket links", () => {
    expect(safeTicketLink("https://example.com/t/1")).toBe("https://example.com/t/1");
    expect(safeTicketLink("javascript:alert(1)")).toBeNull();
    expect(safeTicketLink("IT-0001")).toBeNull();
  });
});
