import { beforeEach, describe, expect, it } from "vitest";
import {
  createQuoteRoleEntry,
  deleteQuoteRoleEntry,
  listQuoteRoleEntries,
  updateQuoteRoleEntry,
} from "./quoteRoles";
import { __resetQuoteMockStores } from "@/data/quoteMockData";

beforeEach(() => {
  __resetQuoteMockStores();
});

describe("quote roles API (mock mode)", () => {
  it("seeds the demo user as a manager", async () => {
    const rows = await listQuoteRoleEntries();
    expect(rows.find((r) => r.email === "demo.user@altronic-llc.com")?.roles).toEqual(["manager"]);
    expect(rows.some((r) => r.roles.includes("viewer"))).toBe(true);
    expect(rows.some((r) => r.roles.includes("quoter"))).toBe(true);
  });

  it("adds, updates and removes", async () => {
    const added = await createQuoteRoleEntry({
      email: " New@Altronic-LLC.com ",
      displayName: "New Person",
      roles: ["manager", "viewer"],
      note: "",
    });
    expect(added).toMatchObject({ email: "new@altronic-llc.com", roles: ["viewer", "manager"] });

    await updateQuoteRoleEntry({ id: added.id, roles: ["quoter"], note: "Sales" });
    let row = (await listQuoteRoleEntries()).find((r) => r.id === added.id)!;
    expect(row).toMatchObject({ roles: ["quoter"], note: "Sales", displayName: "New Person" });

    await updateQuoteRoleEntry({ id: 999, note: "nobody" }); // silently nothing

    await deleteQuoteRoleEntry(added.id);
    row = (await listQuoteRoleEntries()).find((r) => r.id === added.id)!;
    expect(row).toBeUndefined();
  });
});
