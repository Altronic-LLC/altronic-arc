import { describe, expect, it } from "vitest";
import { assetPrefill, prefilledFromAsset } from "./maintenancePrefill";
import { makeAsset, ref } from "@/test/maintenanceFixtures";

// =============================================================================
// The pre-fill rule, on its own.
//
// It is pure and lives in lib/ precisely so it can be pinned here once rather
// than re-tested through two modals — and so the two modals cannot drift apart
// on the one thing that makes this feature safe: an asset pick must never
// overwrite an answer somebody gave.
//
// Department and Location are LOOKUPS since 2026-08-28, so what travels here is
// a lookupId rather than a name.
// =============================================================================

const MACH_SHOP = ref(4, "MACH SHOP");
const SMT = ref(8, "SMT");
const PROD = ref(6, "PROD");
const COMPRESSOR_ROOM = ref(11, "COMPRESSOR ROOM");
const COILS = ref(1, "COILS");

describe("prefilledFromAsset", () => {
  it("fills an untouched blank field from the asset", () => {
    expect(prefilledFromAsset(null, false, MACH_SHOP)).toBe(MACH_SHOP.lookupId);
  });

  it("replaces an earlier PRE-FILL when the asset changes", () => {
    // The old value came from the previous asset, not from a person — so
    // following the new asset is right, and is what makes changing your mind
    // about the equipment work at all.
    expect(prefilledFromAsset(7, false, SMT)).toBe(SMT.lookupId);
  });

  // The rule the whole feature turns on.
  it("NEVER overwrites a value the user set, however the asset changes", () => {
    expect(prefilledFromAsset(5, true, PROD)).toBe(5);
    expect(prefilledFromAsset(5, true, null)).toBe(5);
    // Including a deliberate clear: a user-set empty stays empty.
    expect(prefilledFromAsset(null, true, PROD)).toBe(null);
  });

  it("leaves the field alone when the asset carries no value of its own", () => {
    // Half the register has no department. Following an asset all the way to
    // blank would empty a field the user can see filled in, and they never
    // asked for that — the column is the work order's, not the asset's.
    expect(prefilledFromAsset(7, false, null)).toBe(7);
    expect(prefilledFromAsset(7, false, undefined)).toBe(7);
  });

  it("does NOT pre-fill an unmigrated legacy value off an asset", () => {
    // lookupId 0 is the Equipment List's legacy choice-column fallback (see
    // lib/maintenanceReferences.ts). The two work-order lists have no legacy
    // column to write it to, so copying it across would only ever produce a
    // lookupId meaning "nothing" — the field is left exactly as it was.
    expect(prefilledFromAsset(7, false, ref(0, "QC"))).toBe(7);
    expect(prefilledFromAsset(null, false, ref(0, "QC"))).toBe(null);
  });
});

describe("assetPrefill", () => {
  const register = [
    makeAsset({
      lookupId: 3,
      name: "40 HP COMPRESSOR",
      department: MACH_SHOP,
      location: COMPRESSOR_ROOM,
    }),
    makeAsset({ lookupId: 9, name: "COIL WINDER #4", department: COILS }),
  ];

  it("reads both columns off the picked asset", () => {
    expect(assetPrefill(register, 3)).toEqual({
      department: MACH_SHOP,
      location: COMPRESSOR_ROOM,
    });
  });

  it("reports a column the asset itself hasn't got as null", () => {
    expect(assetPrefill(register, 9)).toEqual({ department: COILS, location: null });
  });

  it("returns a blank pair for no asset, and for an id the register hasn't got", () => {
    // A dangling lookup (a deleted row) is "nothing to pre-fill from", not an
    // error — `prefilledFromAsset` then leaves both fields exactly as they are.
    expect(assetPrefill(register, null)).toEqual({ department: null, location: null });
    expect(assetPrefill(register, 404)).toEqual({ department: null, location: null });
  });
});
