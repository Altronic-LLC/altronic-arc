import { describe, it, expect } from "vitest";
import { listDirectoryPeople, mapDirectoryUsers } from "./directory";

describe("mapDirectoryUsers", () => {
  it("maps Graph users to Person, preferring mail over UPN", () => {
    const out = mapDirectoryUsers([
      { id: "1", displayName: "Ray White", mail: "ray@altronic-llc.com", userPrincipalName: "ray@x" },
      { id: "2", displayName: "Priya Nair", userPrincipalName: "priya@altronic-llc.com" },
    ]);
    expect(out).toEqual([
      { displayName: "Priya Nair", email: "priya@altronic-llc.com" },
      { displayName: "Ray White", email: "ray@altronic-llc.com" },
    ]);
  });

  it("drops entries with no display name or no email (service accounts)", () => {
    const out = mapDirectoryUsers([
      { id: "1", displayName: "", mail: "svc@x.com" },
      { id: "2", displayName: "No Mail" },
      { id: "3", displayName: "Real Person", mail: "real@x.com" },
    ]);
    expect(out).toEqual([{ displayName: "Real Person", email: "real@x.com" }]);
  });

  it("dedupes by lowercase email", () => {
    const out = mapDirectoryUsers([
      { id: "1", displayName: "Ray White", mail: "ray@x.com" },
      { id: "2", displayName: "Ray W", mail: "RAY@x.com" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("skips external guests (#EXT# UPNs)", () => {
    const out = mapDirectoryUsers([
      {
        id: "1",
        displayName: "Vendor Guest",
        mail: "guest@vendor.com",
        userPrincipalName: "guest_vendor.com#EXT#@altronic.onmicrosoft.com",
      },
      { id: "2", displayName: "Staff Member", mail: "staff@altronic-llc.com" },
    ]);
    expect(out).toEqual([{ displayName: "Staff Member", email: "staff@altronic-llc.com" }]);
  });
});

describe("listDirectoryPeople (mock mode)", () => {
  it("returns a non-empty staff list including people not on any item", async () => {
    const people = await listDirectoryPeople();
    expect(people.length).toBeGreaterThan(0);
    // Fresh faces prove "assign to anyone" — not on any mock item.
    expect(people.some((p) => p.email === "marcus.webb@altronic-llc.com")).toBe(true);
    // Mock directory people carry a lookupId so demo assignment works.
    expect(people.every((p) => typeof p.lookupId === "number")).toBe(true);
  });
});
