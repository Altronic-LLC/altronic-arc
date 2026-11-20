import { beforeEach, describe, expect, it, vi } from "vitest";

// SAP's employee list in REAL mode — the GraphQL sent to Fabric, the paging,
// and how a refusal reads. Invisible from mock mode, which builds no query.
// Every value here is invented; the repo is public.

const fabricQuery = vi.hoisted(() => vi.fn());

vi.mock("./fabric", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fabric")>();
  return { ...actual, fabricQuery };
});

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false, FABRIC_ENABLED: true, FABRIC_IN_DEMO: false };
});

import { FabricAuthError, FabricNotConfiguredError, FabricRequestError } from "./fabric";
import { describeSapEmployeeFailure, listSapEmployees, needsSapEmployeeSignIn } from "./sapEmployees";

// A BLOCK body — a returned mock would run as the test's cleanup.
beforeEach(() => {
  fabricQuery.mockReset();
});

const row = (n: string) => ({ EMPLOYEE_NUMBER: n, EMPLOYEE_NAME: "Pat Example", FIRST_NAME: "Pat", LAST_NAME: "Example" });
const page = (ns: string[], next: string | null) => ({
  tbl_arc_employees: { items: ns.map(row), endCursor: next, hasNextPage: next !== null },
});

describe("listSapEmployees (real mode)", () => {
  it("reads the whole table, four columns, a page at a time", async () => {
    fabricQuery.mockResolvedValue(page(["900001"], null));
    const out = await listSapEmployees();
    const [query, variables] = fabricQuery.mock.calls[0];
    expect(query).toContain("tbl_arc_employees(first: 1000, after: $after)");
    expect(query).toContain("items { EMPLOYEE_NUMBER EMPLOYEE_NAME FIRST_NAME LAST_NAME }");
    expect(variables).toEqual({ after: null });
    expect(out).toEqual([{ employeeNumber: "900001", name: "Pat Example", firstName: "Pat", lastName: "Example" }]);
  });

  it("follows the cursor until the last page", async () => {
    fabricQuery.mockResolvedValueOnce(page(["900001"], "c1")).mockResolvedValueOnce(page(["900002"], null));
    const out = await listSapEmployees();
    expect(fabricQuery).toHaveBeenCalledTimes(2);
    expect(fabricQuery.mock.calls[1][1]).toEqual({ after: "c1" });
    expect(out.map((e) => e.employeeNumber)).toEqual(["900001", "900002"]);
  });

  it("refuses to hand back a partial list when the cursor never ends", async () => {
    fabricQuery.mockResolvedValue(page(["900001"], "again"));
    await expect(listSapEmployees()).rejects.toThrow(/partial list/);
  });
});

describe("a refusal, in words", () => {
  it("names each cause", () => {
    expect(describeSapEmployeeFailure(new FabricNotConfiguredError("x"))).toMatch(/isn't connected/);
    expect(describeSapEmployeeFailure(new FabricAuthError("x", "needs-consent"))).toMatch(/hasn't been given Fabric access/);
    expect(describeSapEmployeeFailure(new FabricAuthError("Change your password.", "account"))).toBe("Change your password.");
    expect(describeSapEmployeeFailure(new FabricRequestError("x", "http", { status: 403 }))).toMatch(/ask an admin/);
    expect(describeSapEmployeeFailure(new Error("boom"))).toMatch(/Couldn't reach SAP/);
  });

  it("never offers a sign-in button outside the dev demo", () => {
    expect(needsSapEmployeeSignIn(new FabricAuthError("x", "not-signed-in"))).toBe(false);
  });
});
