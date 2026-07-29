import type { CsaListing } from "@/types/task";

// =============================================================================
// Demo-mode fixtures for CSA Listings. Shapes mirror the real list (file number
// in Title, three multi-line fields, a certification date, a legacy CSA_ID) with
// invented Altronic-plausible content — no real certificate data.
// =============================================================================

function listing(partial: Omit<CsaListing, "createdAt" | "modifiedAt">): CsaListing {
  return {
    ...partial,
    createdAt: new Date("2026-01-12T09:30:00Z"),
    modifiedAt: new Date("2026-05-04T14:10:00Z"),
  };
}

export const MOCK_CSA_LISTINGS: CsaListing[] = [
  listing({
    id: 41,
    fileNumber: "LR 41862-3",
    product: "DSG-1201 Ignition System",
    alsoCover: "DSG-1201-A\nDSG-1201-B (export variant)",
    partNoIncluded: "691201-1\n691201-2\n691201-5",
    history:
      "Original listing 2019. Amended 2023 to add the -B export variant. Annual audit passed May 2026.",
    dateCertified: new Date("2026-05-04T12:00:00Z"),
    csaId: 118,
    hasAttachments: true,
  }),
  listing({
    id: 40,
    fileNumber: "LR 41862-2",
    product: "EX-4000 Display",
    alsoCover: "EX-4000 DA",
    partNoIncluded: "672337-1\n672337-3",
    history: "Listed 2021. Enclosure change reviewed and accepted 2024.",
    dateCertified: new Date("2024-11-18T12:00:00Z"),
    csaId: 104,
    hasAttachments: true,
  }),
  listing({
    id: 39,
    fileNumber: "LR 29455",
    product: "TEM Power Board",
    alsoCover: "",
    partNoIncluded: "601413",
    history: "Superseded enclosure; retained for units in the field.",
    dateCertified: new Date("2019-03-22T12:00:00Z"),
    csaId: 77,
    hasAttachments: false,
  }),
  listing({
    id: 38,
    fileNumber: "LR 55120-1",
    product: "SAVES Annunciator",
    alsoCover: "SAVES-2 panel assembly",
    partNoIncluded: "594120\n594120-2",
    history: "",
    dateCertified: null,
    csaId: null,
    hasAttachments: false,
  }),
];
