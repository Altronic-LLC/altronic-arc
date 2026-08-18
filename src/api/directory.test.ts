import { describe, it, expect } from "vitest";
import {
  grantDirectoryAccess,
  listDirectoryPeople,
  mapDirectoryUsers,
  probeDirectory,
} from "./directory";

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

  // Every colleague has an admin.first.last shadow account beside their real
  // one. They don't read mail, so anything assigned or notified to one goes
  // nowhere — and having each person listed twice makes picking the right
  // one a coin flip (Ray, 2026-08-18).
  it("skips admin.first.last shadow accounts", () => {
    const out = mapDirectoryUsers([
      { id: "1", displayName: "Ray White", mail: "admin.ray.white@altronic-llc.com" },
      { id: "2", displayName: "Ray White", mail: "ray.white@altronic-llc.com" },
    ]);
    expect(out).toEqual([
      { displayName: "Ray White", email: "ray.white@altronic-llc.com" },
    ]);
  });

  it("keeps a real person or shared mailbox whose name merely starts with admin", () => {
    const out = mapDirectoryUsers([
      { id: "1", displayName: "Adminska, Eva", mail: "eva@altronic-llc.com" },
      { id: "2", displayName: "Admin Team", mail: "admin@altronic-llc.com" },
    ]);
    expect(out.map((p) => p.displayName)).toEqual(["Admin Team", "Adminska, Eva"]);
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

describe("probeDirectory (mock mode)", () => {
  it("reports ok with a sample count and the mock flag", async () => {
    const probe = await probeDirectory();
    expect(probe.ok).toBe(true);
    expect(probe.mock).toBe(true);
    expect(probe.count).toBeGreaterThan(0);
    expect(probe.error).toBeNull();
  });

  it("count matches the people the pickers would see", async () => {
    const [probe, people] = await Promise.all([probeDirectory(), listDirectoryPeople()]);
    expect(probe.count).toBe(people.length);
  });
});

describe("grantDirectoryAccess (mock mode)", () => {
  it("is a no-op in demo mode (never touches MSAL)", async () => {
    await expect(grantDirectoryAccess()).resolves.toBeUndefined();
  });
});
