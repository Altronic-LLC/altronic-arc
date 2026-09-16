// =============================================================================
// Cross-Functional ECN Checklist - the RACI matrix, as STATIC REFERENCE.
//
// From the same controlled workbook as `ecnChecklistTemplate.ts`
// (MFGFRM-038 Rev 0), but deliberately kept OUT of SharePoint and out of the
// stored answers: it is identical for every ECN, so storing it per-checklist
// would be 1,800+ copies of one constant table. It is shown in a modal from
// the checklist header (Ray, 2026-09-15).
//
// Two things about this data, both from the source form:
//
//  - **Only 18 of the 84 items carry any marks at all** - every one of them
//    in Sections 1-3, plus one in Section 3's accounting row. Sections 4-10
//    have none on Rev 0. The modal says so rather than rendering 66 empty
//    rows, which reads as a rendering fault instead of as missing source
//    data.
//  - **The form uses `A/R` and `C/I`**, which its own legend does not
//    explain - the legend only covers the four single letters. Both are
//    carried verbatim and explained in `RACI_COMBINED_NOTE`.
//
// `Stragic Buyer` is MISSPELLED in the controlled form (for "Strategic").
// Transcribed verbatim rather than silently corrected, the same call as the
// `QualityPeformance` column typo on the Suppliers List - a controlled
// document is quoted, not edited. Fix it in the workbook first if it should
// change here.
// =============================================================================

export interface EcnRaciRole {
  /** Spreadsheet column the role occupies - its identity in the source form. */
  column: string;
  /** Department group the role sits under. */
  department: string;
  /** Role title, verbatim. */
  role: string;
}

export interface EcnRaciLegendEntry {
  letter: string;
  role: string;
  meaning: string;
}

/** The nine department groups, in form order. */
export const ECN_RACI_DEPARTMENTS: string[] = [
  "Engineering",
  "SHE",
  "Supply Chain",
  "Manufacturing/Logistics",
  "Quality",
  "Sales",
  "Panels",
  "Testing",
  "Accounting",
];

/** The 32 roles, in form order, grouped by department. */
export const ECN_RACI_ROLES: EcnRaciRole[] = [
  // Engineering
  { column: "G", department: "Engineering", role: "Design Engineer" },
  { column: "H", department: "Engineering", role: "Engineering Document Control" },
  { column: "I", department: "Engineering", role: "Product Certification" },
  { column: "J", department: "Engineering", role: "Engineering Export Compliance" },
  { column: "K", department: "Engineering", role: "Drafting Department" },
  { column: "L", department: "Engineering", role: "Product Integration Specialist" },
  { column: "M", department: "Engineering", role: "Head of Engineering" },

  // SHE
  { column: "N", department: "SHE", role: "SHE Coordinator" },

  // Supply Chain
  { column: "O", department: "Supply Chain", role: "Shipping Compliance" },
  { column: "P", department: "Supply Chain", role: "Head of Supply Chain" },
  { column: "Q", department: "Supply Chain", role: "Stragic Buyer" },
  { column: "R", department: "Supply Chain", role: "Operations Program Manager" },
  { column: "S", department: "Supply Chain", role: "Supplier Quality" },

  // Manufacturing/Logistics
  { column: "T", department: "Manufacturing/Logistics", role: "Head of Operations" },
  { column: "U", department: "Manufacturing/Logistics", role: "Manufacturing Workflow and Processes Engineer" },
  { column: "V", department: "Manufacturing/Logistics", role: "Logistics Manager" },
  { column: "W", department: "Manufacturing/Logistics", role: "Order Management" },
  { column: "X", department: "Manufacturing/Logistics", role: "Manufacturing Engineer - Coating and Automation" },
  { column: "Y", department: "Manufacturing/Logistics", role: "Manufacturing Engineer Surface Mount" },

  // Quality
  { column: "Z", department: "Quality", role: "Head of Quality" },
  { column: "AA", department: "Quality", role: "ISO Document Control, PPAP, and ISO 9001 Lead" },
  { column: "AB", department: "Quality", role: "OEM Quality Specialist" },

  // Sales
  { column: "AC", department: "Sales", role: "VP OEM Sales" },
  { column: "AD", department: "Sales", role: "VP Aftermarket Sales" },
  { column: "AE", department: "Sales", role: "Inside Sales Manager" },
  { column: "AF", department: "Sales", role: "Key Accounts Manager" },

  // Panels
  { column: "AG", department: "Panels", role: "Panels Engineering Manager" },
  { column: "AH", department: "Panels", role: "Panels ERP Manager" },
  { column: "AI", department: "Panels", role: "Panels Production Lead" },

  // Testing
  { column: "AJ", department: "Testing", role: "Head of Testing" },
  { column: "AK", department: "Testing", role: "Test Engineer" },

  // Accounting
  { column: "AL", department: "Accounting", role: "Head of Controlling" },
];

/** The legend as printed on the form. */
export const ECN_RACI_LEGEND: EcnRaciLegendEntry[] = [
  { letter: "R", role: "Responsible", meaning: "The person (or people) who do the work to complete the task. They are responsible for action and implementation." },
  { letter: "A", role: "Accountable", meaning: "The person who is ultimately answerable for the task's success. They ensure work is completed correctly and approve the results. There should only be one Accountable per task." },
  { letter: "C", role: "Consulted", meaning: "The people who provide input, advice, or expertise before or during the task. It's a two-way communication." },
  { letter: "I", role: "Informed", meaning: "The people who need to be kept up to date on progress or decisions. It's one-way communication." },
];

/**
 * The form marks some cells `A/R` and `C/I`. Its own legend covers only the
 * four single letters, so this explains the pairs rather than leaving a
 * reader to guess at the one notation the legend omits.
 */
export const RACI_COMBINED_NOTE =
  "Some cells carry two letters: A/R means the role is both Accountable and " +
  "Responsible, and C/I means Consulted and Informed.";

export interface EcnRaciAssignment {
  /** Role title, matching an `ECN_RACI_ROLES` entry. */
  role: string;
  /** Department the role sits under. */
  department: string;
  /** The mark as printed: R, A, C, I, A/R or C/I. */
  mark: string;
}

/**
 * Marks by checklist item key. Only the 18 items that carry any are present -
 * an item absent from this map has no RACI assigned on Rev 0, which is NOT
 * the same as having no one involved.
 */
export const ECN_RACI_BY_ITEM: Record<string, EcnRaciAssignment[]> = {
  "s1-ensure-ecn-is-not": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
    { role: "Engineering Document Control", department: "Engineering", mark: "R" },
  ],
  "s1-product-product-line-example": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
    { role: "Engineering Document Control", department: "Engineering", mark: "C" },
    { role: "Product Integration Specialist", department: "Engineering", mark: "C" },
    { role: "Head of Engineering", department: "Engineering", mark: "C" },
  ],
  "s1-final-assembly-part-numbers": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
    { role: "Engineering Document Control", department: "Engineering", mark: "C" },
    { role: "Product Integration Specialist", department: "Engineering", mark: "C" },
    { role: "Head of Engineering", department: "Engineering", mark: "C" },
  ],
  "s1-date-initiated": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
    { role: "Engineering Document Control", department: "Engineering", mark: "R" },
  ],
  "s1-approved": [
    { role: "Head of Engineering", department: "Engineering", mark: "A/R" },
  ],
  "s1-originated-by": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
  ],
  "s1-priority-i-2-days": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
    { role: "Head of Engineering", department: "Engineering", mark: "C" },
  ],
  "s2-drawings-affected-current-revision": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
    { role: "Drafting Department", department: "Engineering", mark: "C" },
    { role: "Product Integration Specialist", department: "Engineering", mark: "C" },
    { role: "Head of Engineering", department: "Engineering", mark: "R" },
    { role: "Head of Operations", department: "Manufacturing/Logistics", mark: "C" },
    { role: "Manufacturing Workflow and Processes Engineer", department: "Manufacturing/Logistics", mark: "C" },
    { role: "Head of Quality", department: "Quality", mark: "C" },
    { role: "Panels Engineering Manager", department: "Panels", mark: "C/I" },
    { role: "Head of Testing", department: "Testing", mark: "C/I" },
  ],
  "s2-list-new-drawings-along": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
    { role: "Engineering Document Control", department: "Engineering", mark: "C" },
    { role: "Drafting Department", department: "Engineering", mark: "C" },
    { role: "Product Integration Specialist", department: "Engineering", mark: "C" },
    { role: "Head of Engineering", department: "Engineering", mark: "C" },
    { role: "Head of Supply Chain", department: "Supply Chain", mark: "C" },
    { role: "Head of Operations", department: "Manufacturing/Logistics", mark: "C" },
    { role: "Manufacturing Workflow and Processes Engineer", department: "Manufacturing/Logistics", mark: "C" },
    { role: "Head of Quality", department: "Quality", mark: "C" },
    { role: "Panels Engineering Manager", department: "Panels", mark: "C/I" },
    { role: "Head of Testing", department: "Testing", mark: "C/I" },
  ],
  "s2-list-schematic-on-ecn": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
    { role: "Engineering Document Control", department: "Engineering", mark: "C" },
    { role: "Drafting Department", department: "Engineering", mark: "C" },
    { role: "Product Integration Specialist", department: "Engineering", mark: "C" },
    { role: "Head of Engineering", department: "Engineering", mark: "C" },
    { role: "Head of Supply Chain", department: "Supply Chain", mark: "C" },
    { role: "Head of Operations", department: "Manufacturing/Logistics", mark: "C" },
    { role: "Manufacturing Workflow and Processes Engineer", department: "Manufacturing/Logistics", mark: "C" },
    { role: "Head of Quality", department: "Quality", mark: "C" },
    { role: "Panels Engineering Manager", department: "Panels", mark: "C/I" },
    { role: "Head of Testing", department: "Testing", mark: "C/I" },
  ],
  "s3-list-designators-quantities-changing": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
    { role: "Product Integration Specialist", department: "Engineering", mark: "C" },
    { role: "Head of Supply Chain", department: "Supply Chain", mark: "C" },
    { role: "Operations Program Manager", department: "Supply Chain", mark: "C" },
    { role: "Head of Operations", department: "Manufacturing/Logistics", mark: "C" },
    { role: "Manufacturing Workflow and Processes Engineer", department: "Manufacturing/Logistics", mark: "C" },
  ],
  "s3-removing-boms-of-products": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
    { role: "Engineering Document Control", department: "Engineering", mark: "R" },
    { role: "Product Certification", department: "Engineering", mark: "C" },
    { role: "Product Integration Specialist", department: "Engineering", mark: "C" },
    { role: "Head of Supply Chain", department: "Supply Chain", mark: "C" },
    { role: "Operations Program Manager", department: "Supply Chain", mark: "C" },
    { role: "Head of Operations", department: "Manufacturing/Logistics", mark: "C" },
    { role: "Manufacturing Workflow and Processes Engineer", department: "Manufacturing/Logistics", mark: "C" },
  ],
  "s3-detailed-name-and-or": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
    { role: "Product Integration Specialist", department: "Engineering", mark: "C" },
    { role: "Head of Engineering", department: "Engineering", mark: "C" },
  ],
  "s3-software-firmware-impacted-with": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
  ],
  "s3-list-dimensional-text-color": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
  ],
  "s3-list-pcb-changes": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
  ],
  "s3-new-chemicals-include-msds": [
    { role: "Design Engineer", department: "Engineering", mark: "A/R" },
  ],
  "s3-price-control-make-to": [
    { role: "Design Engineer", department: "Engineering", mark: "R" },
  ],
};

/** Does this item have any RACI assigned on the current form revision? */
export function hasRaci(itemKey: string): boolean {
  return (ECN_RACI_BY_ITEM[itemKey]?.length ?? 0) > 0;
}

/** The marks for one item, or an empty list when the form assigns none. */
export function raciForItem(itemKey: string): EcnRaciAssignment[] {
  return ECN_RACI_BY_ITEM[itemKey] ?? [];
}

/** How many items carry marks - the modal states this alongside the total. */
export const ECN_RACI_ITEM_COUNT = Object.keys(ECN_RACI_BY_ITEM).length;
