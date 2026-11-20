import { describe, expect, it } from "vitest";
import { checkNewHireInSap, employeeNumberKey, nameKey, toSapEmployee, type SapEmployee } from "./sapEmployees";

// Every name and number here is invented — the repo is public.

const emp = (n: string, first: string, last: string): SapEmployee =>
  toSapEmployee({ EMPLOYEE_NUMBER: n, EMPLOYEE_NAME: `${first} ${last}`, FIRST_NAME: first, LAST_NAME: last });

const LIST = [
  emp("900101", "Robert", "Starter"),
  emp("900102", "Morgan", "Joiner"),
  emp("900301", "Jamie", "Twin"),
  emp("900302", "Jamie", "Twin"),
  emp("900401", "Mary-Kate", "O'Example"),
];

const hire = (over: Partial<{ legalFirstName: string; preferredFirstName: string; lastName: string; empNumber: string }>) => ({
  legalFirstName: "",
  preferredFirstName: "",
  lastName: "",
  empNumber: "",
  ...over,
});

describe("keys", () => {
  it("reads one number however it's padded or spaced", () => {
    expect(employeeNumberKey(" 0900101 ")).toBe("900101");
    expect(employeeNumberKey(900101)).toBe("900101");
    expect(employeeNumberKey("")).toBe("");
    expect(employeeNumberKey("0")).toBe("0");
  });

  it("ignores case, spacing, punctuation and accents in a name", () => {
    expect(nameKey("O'Example")).toBe(nameKey("o example"));
    expect(nameKey("Mary-Kate")).toBe(nameKey("MARYKATE"));
    expect(nameKey("José")).toBe(nameKey("jose"));
  });

  it("builds the full name from the parts when EMPLOYEE_NAME is blank", () => {
    expect(toSapEmployee({ EMPLOYEE_NUMBER: 1, FIRST_NAME: "A", LAST_NAME: "B" }).name).toBe("A B");
  });
});

describe("checkNewHireInSap", () => {
  it("confirms by EMP number, and says nothing when the name agrees", () => {
    const r = checkNewHireInSap(hire({ legalFirstName: "Robert", preferredFirstName: "Robin", lastName: "Starter", empNumber: "900101" }), LIST);
    expect(r).toMatchObject({ kind: "confirmed", by: "number", nameDiffers: false });
  });

  it("flags an EMP number SAP holds under somebody else's name", () => {
    const r = checkNewHireInSap(hire({ legalFirstName: "Taylor", lastName: "Newman", empNumber: "900102" }), LIST);
    expect(r).toMatchObject({ kind: "confirmed", by: "number", nameDiffers: true });
  });

  it("says an EMP number isn't in SAP, offering who has the name", () => {
    const r = checkNewHireInSap(hire({ legalFirstName: "Morgan", lastName: "Joiner", empNumber: "999999" }), LIST);
    expect(r).toEqual({ kind: "number-not-found", empNumber: "999999", byName: [LIST[1]] });
  });

  it("never falls back to the name when the EMP number is wrong", () => {
    const r = checkNewHireInSap(hire({ legalFirstName: "Morgan", lastName: "Joiner", empNumber: "999999" }), LIST);
    expect(r.kind).not.toBe("confirmed");
  });

  it("confirms by name — legal or preferred first name — with no EMP number", () => {
    expect(checkNewHireInSap(hire({ legalFirstName: "Robert", lastName: "starter" }), LIST)).toMatchObject({
      kind: "confirmed",
      by: "name",
      employee: LIST[0],
    });
    expect(checkNewHireInSap(hire({ legalFirstName: "Rob", preferredFirstName: "Robert", lastName: "Starter" }), LIST)).toMatchObject({
      kind: "confirmed",
      by: "name",
    });
    expect(checkNewHireInSap(hire({ legalFirstName: "mary kate", lastName: "OExample" }), LIST)).toMatchObject({ kind: "confirmed" });
  });

  it("lists two people sharing a name rather than picking one", () => {
    const r = checkNewHireInSap(hire({ legalFirstName: "Jamie", lastName: "Twin" }), LIST);
    expect(r).toEqual({ kind: "ambiguous", candidates: [LIST[2], LIST[3]] });
  });

  it("an EMP number settles a shared name", () => {
    const r = checkNewHireInSap(hire({ legalFirstName: "Jamie", lastName: "Twin", empNumber: "900302" }), LIST);
    expect(r).toMatchObject({ kind: "confirmed", employee: LIST[3] });
  });

  it("needs the first AND the last name — a surname alone matches nobody", () => {
    expect(checkNewHireInSap(hire({ lastName: "Starter" }), LIST)).toEqual({ kind: "nothing-to-check" });
    expect(checkNewHireInSap(hire({ legalFirstName: "Robert" }), LIST)).toEqual({ kind: "nothing-to-check" });
  });

  it("is not found when neither matches", () => {
    expect(checkNewHireInSap(hire({ legalFirstName: "Taylor", lastName: "Newman" }), LIST)).toEqual({ kind: "not-found" });
  });
});
