// =============================================================================
// SRM Tool — Supplier Cold Call Log (Supply Chain, PMO site). BusinessIT#79,
// from Katie Fleming's feature request #52: suppliers we don't do business
// with today, kept so somebody can look there for ideas when a need arises.
//
// Not a supplier on the Suppliers List, and not linked to one: these are
// companies with no BP number, often met once at a show or on a cold call.
// =============================================================================

/** Who added an entry — Graph's item-level createdBy. */
export interface ColdCallAuthor {
  displayName: string;
  email: string;
}

export interface SupplierColdCall {
  id: number;
  /** Title — the company's name. Required. */
  company: string;
  /** As typed: "acme.com" or "https://acme.com/parts". */
  website: string;
  /** Free text — what they make or sell. */
  commodity: string;
  /** The person spoken to there. */
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  /** Plain multi-line notes — what was discussed, when, what they're good at. */
  notes: string;
  createdBy: ColdCallAuthor | null;
  createdAt: Date;
  modifiedAt: Date;
}

export interface SupplierColdCallInput {
  company: string;
  website: string;
  commodity: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
}
