import { describe, it, expect } from "vitest";
import {
  compareCsaListings,
  csaListingLabel,
  csaListingMatches,
  toCsaListing,
} from "./csaListingMapper";
import type { CsaListing, GraphListItem } from "@/types/task";

function item(fields: Record<string, unknown>, id = "41"): GraphListItem {
  return {
    id,
    createdDateTime: "2026-01-12T09:30:00Z",
    lastModifiedDateTime: "2026-05-04T14:10:00Z",
    fields: fields as GraphListItem["fields"],
  };
}

describe("toCsaListing", () => {
  it("reads the file number out of the Title column", () => {
    // The list repurposes Title as the CSA file number — there is no separate
    // title column, so this mapping is the thing that must not drift.
    const listing = toCsaListing(item({ Title: "LR 41862-3" }));
    expect(listing.fileNumber).toBe("LR 41862-3");
  });

  it("maps every user-defined column", () => {
    const listing = toCsaListing(
      item({
        Title: "LR 41862-3",
        Product: "DSG-1201 Ignition System",
        AlsoCover: "DSG-1201-A\nDSG-1201-B",
        PartNoIncluded: "691201-1\n691201-2",
        History: "Amended 2023.",
        DateCertified: "2026-05-04T12:00:00Z",
        CSA_ID: 118,
        Attachments: true,
      }),
    );
    expect(listing).toMatchObject({
      id: 41,
      fileNumber: "LR 41862-3",
      product: "DSG-1201 Ignition System",
      alsoCover: "DSG-1201-A\nDSG-1201-B",
      partNoIncluded: "691201-1\n691201-2",
      history: "Amended 2023.",
      csaId: 118,
      hasAttachments: true,
    });
    expect(listing.dateCertified?.getUTCFullYear()).toBe(2026);
  });

  it("defaults absent text columns to empty strings, not undefined", () => {
    const listing = toCsaListing(item({}));
    expect(listing.fileNumber).toBe("");
    expect(listing.product).toBe("");
    expect(listing.alsoCover).toBe("");
    expect(listing.history).toBe("");
    expect(listing.dateCertified).toBeNull();
    expect(listing.csaId).toBeNull();
  });

  it("treats a missing Attachments flag as no attachments", () => {
    expect(toCsaListing(item({})).hasAttachments).toBe(false);
    // Graph sends the column as a real boolean; anything else is not a yes.
    expect(toCsaListing(item({ Attachments: "true" })).hasAttachments).toBe(false);
  });

  it("reads the date in UTC so a date-only value keeps its day", () => {
    // Stored midday UTC; a local reading would call this the 4th or the 3rd
    // depending on the browser's timezone.
    const listing = toCsaListing(item({ DateCertified: "2026-05-04T12:00:00Z" }));
    expect(listing.dateCertified?.getUTCDate()).toBe(4);
  });
});

describe("csaListingLabel", () => {
  it("pairs the file number with the product, since the number alone is opaque", () => {
    expect(csaListingLabel({ fileNumber: "LR 41862-3", product: "DSG-1201" })).toBe(
      "LR 41862-3 — DSG-1201",
    );
  });

  it("falls back to whichever half exists", () => {
    expect(csaListingLabel({ fileNumber: "LR 29455", product: "" })).toBe("LR 29455");
    expect(csaListingLabel({ fileNumber: "", product: "SAVES" })).toBe("SAVES");
  });

  it("never returns an empty label", () => {
    expect(csaListingLabel({ fileNumber: "  ", product: "" })).toBe("(untitled listing)");
  });
});

describe("compareCsaListings", () => {
  const mk = (id: number, date: string | null): CsaListing =>
    ({ id, dateCertified: date ? new Date(date) : null }) as CsaListing;

  it("sorts newest certification first", () => {
    const sorted = [mk(1, "2019-03-22T12:00:00Z"), mk(2, "2026-05-04T12:00:00Z")].sort(
      compareCsaListings,
    );
    expect(sorted.map((l) => l.id)).toEqual([2, 1]);
  });

  it("puts undated listings last, not first", () => {
    const sorted = [mk(1, null), mk(2, "2024-11-18T12:00:00Z"), mk(3, null)].sort(
      compareCsaListings,
    );
    expect(sorted[0].id).toBe(2);
    expect(sorted.slice(1).map((l) => l.id)).toEqual([3, 1]);
  });

  it("breaks same-date ties by id, newest first", () => {
    const sorted = [mk(10, "2026-01-01T12:00:00Z"), mk(11, "2026-01-01T12:00:00Z")].sort(
      compareCsaListings,
    );
    expect(sorted.map((l) => l.id)).toEqual([11, 10]);
  });
});

describe("csaListingMatches", () => {
  const listing = {
    fileNumber: "LR 41862-3",
    product: "DSG-1201 Ignition System",
    alsoCover: "DSG-1201-B export variant",
    partNoIncluded: "691201-1\n691201-5",
    history: "Annual audit passed May 2026",
    csaId: 118,
  } as CsaListing;

  it("matches on the file number and product", () => {
    expect(csaListingMatches(listing, ["41862"])).toBe(true);
    expect(csaListingMatches(listing, ["ignition"])).toBe(true);
  });

  it("reaches into the long fields — that's where part numbers live", () => {
    // The table can't show these in full, so search has to cover them or a part
    // number lookup silently fails.
    expect(csaListingMatches(listing, ["691201-5"])).toBe(true);
    expect(csaListingMatches(listing, ["export"])).toBe(true);
    expect(csaListingMatches(listing, ["audit"])).toBe(true);
  });

  it("matches the legacy id", () => {
    expect(csaListingMatches(listing, ["118"])).toBe(true);
  });

  it("requires every token, so extra words narrow", () => {
    expect(csaListingMatches(listing, ["dsg", "export"])).toBe(true);
    expect(csaListingMatches(listing, ["dsg", "nonsense"])).toBe(false);
  });

  it("matches everything when there are no tokens", () => {
    expect(csaListingMatches(listing, [])).toBe(true);
  });
});
