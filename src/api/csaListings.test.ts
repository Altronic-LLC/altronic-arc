import { describe, it, expect } from "vitest";
import {
  buildCsaWriteFields,
  createCsaListing,
  deleteCsaListing,
  listCsaListings,
  updateCsaListing,
} from "./csaListings";
import type { CsaListingInput } from "@/types/task";

// USE_MOCK is true under Vitest — these exercise the in-memory listing store.

const baseInput: CsaListingInput = {
  fileNumber: "  LR 90001  ",
  product: "  Test Product  ",
  alsoCover: "Variant A\nVariant B",
  partNoIncluded: "111111\n222222",
  history: "  Created for the test suite.  ",
  dateCertified: new Date("2026-06-15T12:00:00Z"),
};

describe("buildCsaWriteFields", () => {
  it("writes the file number to the Title column", () => {
    // Title IS the file number on this list — writing a "FileNumber" field
    // would silently save nothing.
    expect(buildCsaWriteFields(baseInput).Title).toBe("LR 90001");
  });

  it("trims the text columns", () => {
    const fields = buildCsaWriteFields(baseInput);
    expect(fields.Product).toBe("Test Product");
    expect(fields.History).toBe("Created for the test suite.");
  });

  it("preserves newlines inside the multi-line columns", () => {
    const fields = buildCsaWriteFields(baseInput);
    expect(fields.AlsoCover).toBe("Variant A\nVariant B");
    expect(fields.PartNoIncluded).toBe("111111\n222222");
  });

  it("writes the date as midday UTC", () => {
    expect(buildCsaWriteFields(baseInput).DateCertified).toBe("2026-06-15T12:00:00Z");
  });

  it("sends null for a cleared date so the column empties", () => {
    expect(buildCsaWriteFields({ ...baseInput, dateCertified: null }).DateCertified).toBeNull();
  });

  it("never writes the legacy CSA_ID — it belongs to the original data", () => {
    expect(buildCsaWriteFields(baseInput)).not.toHaveProperty("CSA_ID");
  });
});

describe("listCsaListings (mock)", () => {
  it("returns listings newest certification first", async () => {
    const listings = await listCsaListings();
    expect(listings.length).toBeGreaterThan(0);
    const dated = listings.filter((l) => l.dateCertified !== null);
    const times = dated.map((l) => l.dateCertified!.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("puts undated listings at the end", async () => {
    const listings = await listCsaListings();
    const firstUndated = listings.findIndex((l) => l.dateCertified === null);
    if (firstUndated >= 0) {
      expect(listings.slice(firstUndated).every((l) => l.dateCertified === null)).toBe(true);
    }
  });
});

describe("createCsaListing / updateCsaListing / delete (mock)", () => {
  it("creates a listing, trimming as it goes", async () => {
    const created = await createCsaListing(baseInput);
    expect(created.fileNumber).toBe("LR 90001");
    expect(created.history).toBe("Created for the test suite.");
    // New rows have no legacy id and no attachments yet.
    expect(created.csaId).toBeNull();
    expect(created.hasAttachments).toBe(false);

    const all = await listCsaListings();
    expect(all.some((l) => l.id === created.id)).toBe(true);
  });

  it("updates a listing's fields", async () => {
    const created = await createCsaListing(baseInput);
    const updated = await updateCsaListing(created.id, {
      ...baseInput,
      product: "Renamed Product",
      dateCertified: null,
    });
    expect(updated.product).toBe("Renamed Product");
    expect(updated.dateCertified).toBeNull();

    const all = await listCsaListings();
    expect(all.find((l) => l.id === created.id)?.product).toBe("Renamed Product");
  });

  it("throws for an unknown listing id", async () => {
    await expect(updateCsaListing(99999999, baseInput)).rejects.toThrow(/not found/);
  });

  it("deletes a listing", async () => {
    const created = await createCsaListing(baseInput);
    await deleteCsaListing(created.id);
    const all = await listCsaListings();
    expect(all.some((l) => l.id === created.id)).toBe(false);
  });

  it("ignores a delete for an id that isn't there", async () => {
    await expect(deleteCsaListing(88888888)).resolves.toBeUndefined();
  });
});
