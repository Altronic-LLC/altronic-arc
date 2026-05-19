import { describe, it, expect } from "vitest";
import { multiLookupField, multiPersonField } from "./graphFields";
import type { Person } from "@/types/task";

describe("multiLookupField", () => {
  it("returns the @odata.type annotation + the integer array", () => {
    expect(multiLookupField("Assigned", [12, 87])).toEqual({
      "AssignedLookupId@odata.type": "Collection(Edm.Int32)",
      AssignedLookupId: [12, 87],
    });
  });

  it("emits the annotated shape with an empty array — used to clear a field", () => {
    expect(multiLookupField("Watchers", [])).toEqual({
      "WatchersLookupId@odata.type": "Collection(Edm.Int32)",
      WatchersLookupId: [],
    });
  });

  it("supports any field name — derives the LookupId suffix from it", () => {
    expect(multiLookupField("Watchers", [5])).toEqual({
      "WatchersLookupId@odata.type": "Collection(Edm.Int32)",
      WatchersLookupId: [5],
    });
  });
});

describe("multiPersonField", () => {
  const ALICE: Person = { displayName: "Alice", email: "a@x.com", lookupId: 1 };
  const BOB: Person = { displayName: "Bob", email: "b@x.com", lookupId: 2 };
  const UNRESOLVED: Person = { displayName: "Carol", lookupId: 0 };

  it("strips people with no resolved lookupId", () => {
    expect(multiPersonField("Assigned", [ALICE, UNRESOLVED, BOB])).toEqual({
      "AssignedLookupId@odata.type": "Collection(Edm.Int32)",
      AssignedLookupId: [1, 2],
    });
  });

  it("emits an empty annotated shape when every person is unresolved (clears the field)", () => {
    expect(multiPersonField("Assigned", [UNRESOLVED])).toEqual({
      "AssignedLookupId@odata.type": "Collection(Edm.Int32)",
      AssignedLookupId: [],
    });
  });

  it("emits an empty annotated shape for an empty input (clears the field)", () => {
    expect(multiPersonField("Assigned", [])).toEqual({
      "AssignedLookupId@odata.type": "Collection(Edm.Int32)",
      AssignedLookupId: [],
    });
  });
});
