import type { NewHire } from "@/types/hr";

// =============================================================================
// Is this new hire in SAP? — pure (Tim, 2026-11-20).
//
// SAP's employee list reaches ARC through Fabric as the warehouse table
// `dbo.tbl_arc_employee` (api/sapEmployees.ts). Four columns, read off the
// live table on 2026-11-20 (introspection is off, so each was proved with a
// query): EMPLOYEE_NUMBER (text, six digits), EMPLOYEE_NAME (first + " " +
// last on every row), FIRST_NAME, LAST_NAME. 211 rows, one page.
//
// The rule, in order:
//   1. An EMP number on the record is looked up by NUMBER. Found = confirmed
//      (and said when SAP's name for it differs). Not found = a fault worth
//      saying, with any name matches offered as what it might have been.
//   2. No EMP number: by NAME — legal OR preferred first name, with the last
//      name; case, spacing and punctuation ignored. One match = confirmed.
//      Several = ambiguous: listed, never guessed between (the live table
//      has a pair sharing a name).
//   3. Nothing = not in SAP yet.
// =============================================================================

export interface SapEmployeeRow {
  EMPLOYEE_NUMBER?: string | number | null;
  EMPLOYEE_NAME?: string | null;
  FIRST_NAME?: string | null;
  LAST_NAME?: string | null;
}

export interface SapEmployee {
  employeeNumber: string;
  name: string;
  firstName: string;
  lastName: string;
}

/** The columns ARC asks for — the whole table, as it stands. */
export const SAP_EMPLOYEE_FIELDS = ["EMPLOYEE_NUMBER", "EMPLOYEE_NAME", "FIRST_NAME", "LAST_NAME"] as const;

export function toSapEmployee(row: SapEmployeeRow): SapEmployee {
  const firstName = String(row.FIRST_NAME ?? "").trim();
  const lastName = String(row.LAST_NAME ?? "").trim();
  return {
    employeeNumber: String(row.EMPLOYEE_NUMBER ?? "").trim(),
    name: String(row.EMPLOYEE_NAME ?? "").trim() || [firstName, lastName].filter(Boolean).join(" "),
    firstName,
    lastName,
  };
}

/** Digits only, leading zeros dropped — "0217373", " 217373 " and "217373" are one number. */
export function employeeNumberKey(value: string | number | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.replace(/^0+(?=\d)/, "");
}

/** Lower case, letters and digits only: "O'Brien-Smith" and "obrien smith" are one name. */
export function nameKey(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function personKey(first: string, last: string): string {
  const f = nameKey(first);
  const l = nameKey(last);
  return f && l ? `${f}|${l}` : "";
}

/** The name keys a hire answers to — legal and preferred first names, with the last name. */
function hireNameKeys(hire: Pick<NewHire, "legalFirstName" | "preferredFirstName" | "lastName">): Set<string> {
  return new Set(
    [hire.legalFirstName, hire.preferredFirstName].map((first) => personKey(first, hire.lastName)).filter(Boolean),
  );
}

function employeeNameKeys(e: SapEmployee): string[] {
  const keys = [personKey(e.firstName, e.lastName)];
  // EMPLOYEE_NAME is first + " " + last on every live row; reading it too
  // covers a row whose split columns are blank.
  const parts = e.name.trim().split(/\s+/);
  if (parts.length >= 2) keys.push(personKey(parts.slice(0, -1).join(" "), parts[parts.length - 1]));
  return keys.filter(Boolean);
}

export type SapEmployeeCheck =
  /** In SAP. `by` says how it was found; `nameDiffers` when the EMP number's name isn't this hire's. */
  | { kind: "confirmed"; by: "number" | "name"; employee: SapEmployee; nameDiffers: boolean }
  /** The EMP number on the record isn't in SAP. `byName` = who SAP has under this name, if anyone. */
  | { kind: "number-not-found"; empNumber: string; byName: SapEmployee[] }
  /** No EMP number, and more than one employee has this name. */
  | { kind: "ambiguous"; candidates: SapEmployee[] }
  /** Neither the number nor the name is in SAP. */
  | { kind: "not-found" }
  /** No EMP number and no full name to look up by. */
  | { kind: "nothing-to-check" };

export function checkNewHireInSap(
  hire: Pick<NewHire, "legalFirstName" | "preferredFirstName" | "lastName" | "empNumber">,
  employees: SapEmployee[],
): SapEmployeeCheck {
  const keys = hireNameKeys(hire);
  const byName = employees.filter((e) => employeeNameKeys(e).some((k) => keys.has(k)));
  const number = employeeNumberKey(hire.empNumber);

  if (number) {
    const employee = employees.find((e) => employeeNumberKey(e.employeeNumber) === number);
    if (employee) {
      const nameDiffers = keys.size > 0 && !employeeNameKeys(employee).some((k) => keys.has(k));
      return { kind: "confirmed", by: "number", employee, nameDiffers };
    }
    return { kind: "number-not-found", empNumber: hire.empNumber.trim(), byName };
  }

  if (keys.size === 0) return { kind: "nothing-to-check" };
  if (byName.length === 1) return { kind: "confirmed", by: "name", employee: byName[0], nameDiffers: false };
  if (byName.length > 1) return { kind: "ambiguous", candidates: byName };
  return { kind: "not-found" };
}
