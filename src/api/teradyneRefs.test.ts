import { describe, it, expect } from "vitest";
import {
  REF_LISTS,
  createTeradyneRef,
  deleteTeradyneRef,
  listTeradyneRefs,
  updateTeradyneRef,
} from "./teradyneRefs";
import type { TeradyneEmployee, TeradyneProduct, TeradyneRemark } from "@/types/task";

// USE_MOCK is true under Vitest — these exercise the in-memory reference stores.

describe("REF_LISTS write payloads", () => {
  it("derives an employee's Title from the name columns", () => {
    expect(
      REF_LISTS.employees.writeFields({
        title: "ignored",
        firstName: " Dave ",
        lastName: " Anderson ",
        clockNum: 312,
        workCenter: " COAT ",
      }),
    ).toEqual({
      Title: "Dave Anderson",
      First_Name: "Dave",
      Last_Name: "Anderson",
      ClockNum: 312,
      Work_Center: "COAT",
    });
  });

  it("falls back to the supplied title when an employee has no name parts", () => {
    expect(
      REF_LISTS.employees.writeFields({ title: "Contractor", firstName: "", lastName: "" }).Title,
    ).toBe("Contractor");
  });

  it("sends null for a cleared clock number rather than 0", () => {
    expect(
      REF_LISTS.employees.writeFields({ title: "x", firstName: "A", lastName: "B", clockNum: null })
        .ClockNum,
    ).toBeNull();
  });

  it("writes only Title + station for products", () => {
    expect(REF_LISTS.products.writeFields({ title: " SAVES ", testOnStation: " Spea " })).toEqual({
      Title: "SAVES",
      TestOnStation: "Spea",
    });
  });

  it("writes the remark's number alongside its title", () => {
    expect(REF_LISTS.remarks.writeFields({ title: " Solder bridge ", idRem: 21 })).toEqual({
      Title: "Solder bridge",
      IDRem: 21,
    });
  });

  it("writes a remark with no number as null, not 0", () => {
    expect(REF_LISTS.remarks.writeFields({ title: "Unnumbered" }).IDRem).toBeNull();
    expect(REF_LISTS.remarks.writeFields({ title: "Cleared", idRem: null }).IDRem).toBeNull();
  });

  it("accepts 0 as a remark number — the real data has one", () => {
    expect(REF_LISTS.remarks.writeFields({ title: "------", idRem: 0 }).IDRem).toBe(0);
  });

  it("never writes the read-only legacy ids on employees or products", () => {
    for (const kind of ["employees", "products"] as const) {
      const keys = Object.keys(REF_LISTS[kind].writeFields({ title: "x" }));
      expect(keys.some((k) => /^ID(Emp|Prod)$/.test(k))).toBe(false);
    }
  });
});

describe("listTeradyneRefs (mock)", () => {
  it("sorts each list by title, numeric-aware", async () => {
    for (const kind of ["employees", "products", "remarks"] as const) {
      const rows = await listTeradyneRefs(kind);
      const titles = rows.map((r) => r.title);
      const expected = [...titles].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      );
      expect(titles).toEqual(expected);
    }
  });
});

describe("createTeradyneRef / updateTeradyneRef / deleteTeradyneRef (mock)", () => {
  it("creates an employee with a derived title", async () => {
    const row = (await createTeradyneRef("employees", {
      title: "",
      firstName: "Nia",
      lastName: "Patel",
      clockNum: 401,
      workCenter: "TEST",
    })) as TeradyneEmployee;
    expect(row.title).toBe("Nia Patel");
    expect(row.clockNum).toBe(401);
    expect(row.workCenter).toBe("TEST");
    // New rows leave the legacy import id blank.
    expect(row.idEmp).toBeNull();
  });

  it("creates a product and a remark", async () => {
    const product = (await createTeradyneRef("products", {
      title: "New Board 12",
      testOnStation: "Spea",
    })) as TeradyneProduct;
    expect(product.title).toBe("New Board 12");
    expect(product.testOnStation).toBe("Spea");

    const remark = (await createTeradyneRef("remarks", {
      title: "Tombstoned part",
      idRem: 42,
    })) as TeradyneRemark;
    expect(remark.title).toBe("Tombstoned part");
    expect(remark.idRem).toBe(42);
  });

  it("keeps a remark's number editable, unlike the employee/product legacy ids", async () => {
    const created = (await createTeradyneRef("remarks", {
      title: "Renumber me",
      idRem: 7,
    })) as TeradyneRemark;

    const updated = (await updateTeradyneRef("remarks", created.lookupId, {
      title: "Renumber me",
      idRem: 8,
    })) as TeradyneRemark;
    expect(updated.idRem).toBe(8);

    const rows = (await listTeradyneRefs("remarks")) as TeradyneRemark[];
    expect(rows.find((r) => r.lookupId === created.lookupId)?.idRem).toBe(8);
  });

  it("can clear a remark's number back to blank", async () => {
    const created = (await createTeradyneRef("remarks", {
      title: "Numberless soon",
      idRem: 9,
    })) as TeradyneRemark;
    const updated = (await updateTeradyneRef("remarks", created.lookupId, {
      title: "Numberless soon",
      idRem: null,
    })) as TeradyneRemark;
    expect(updated.idRem).toBeNull();
  });

  it("renames a row and keeps the legacy import id intact", async () => {
    const rows = (await listTeradyneRefs("employees")) as TeradyneEmployee[];
    const target = rows.find((r) => r.idEmp != null);
    expect(target).toBeDefined();

    const updated = (await updateTeradyneRef("employees", target!.lookupId, {
      title: "",
      firstName: "Renamed",
      lastName: "Person",
      clockNum: target!.clockNum,
      workCenter: target!.workCenter,
    })) as TeradyneEmployee;

    expect(updated.title).toBe("Renamed Person");
    expect(updated.idEmp).toBe(target!.idEmp);
  });

  it("persists an edit to the list", async () => {
    const created = await createTeradyneRef("remarks", { title: "Before" });
    await updateTeradyneRef("remarks", created.lookupId, { title: "After" });
    const rows = await listTeradyneRefs("remarks");
    expect(rows.find((r) => r.lookupId === created.lookupId)?.title).toBe("After");
  });

  it("throws for an unknown row id", async () => {
    await expect(updateTeradyneRef("products", 99999999, { title: "x" })).rejects.toThrow(
      /not found/,
    );
  });

  it("deletes a row", async () => {
    const created = await createTeradyneRef("remarks", { title: "Temporary" });
    await deleteTeradyneRef("remarks", created.lookupId);
    const rows = await listTeradyneRefs("remarks");
    expect(rows.some((r) => r.lookupId === created.lookupId)).toBe(false);
  });
});
