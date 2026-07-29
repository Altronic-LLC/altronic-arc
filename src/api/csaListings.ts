import { graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_CSA_LISTINGS_LIST_ID, USE_MOCK } from "./config";
import type { CsaListing, CsaListingInput, GraphListItem } from "@/types/task";
import { compareCsaListings, toCsaListing } from "@/lib/csaListingMapper";
import { toSpDateOnly } from "@/lib/spDates";
import { MOCK_CSA_LISTINGS } from "@/data/csaMockData";

// =============================================================================
// CSA Listings API — Engineering's CSA product-certification register, on the
// Engineering site.
//
// Straightforward compared with the Teradyne lists: no lookups to resolve, no
// people fields, and the list is small (a few dozen files), so it's fetched
// whole and sorted client-side like the other Engineering reference data.
//
// Two column quirks are handled in the mapper, not here — `Title` is the file
// number, and `CSA_ID` is a legacy id the app never writes. See
// src/lib/csaListingMapper.ts.
// =============================================================================

const CSA_SELECT =
  "Title,Product,AlsoCover,PartNoIncluded,History,DateCertified,CSA_ID,Attachments";

let mockStore: CsaListing[] = MOCK_CSA_LISTINGS.map((l) => ({ ...l }));

function delay<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** Every CSA listing, newest certification date first. */
export async function listCsaListings(): Promise<CsaListing[]> {
  if (USE_MOCK) {
    return delay([...mockStore].sort(compareCsaListings).map((l) => ({ ...l })));
  }

  const items = await graphFetchAll<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${SP_CSA_LISTINGS_LIST_ID}/items` +
      `?$expand=fields($select=${CSA_SELECT})&$top=500`,
  );
  return items.map(toCsaListing).sort(compareCsaListings);
}

/**
 * Domain input → SharePoint fields payload.
 *
 * `CSA_ID` is deliberately absent: it belongs to the original data import, so
 * new rows leave it blank and edits never touch it. `Title` carries the file
 * number.
 */
export function buildCsaWriteFields(input: CsaListingInput): Record<string, unknown> {
  return {
    Title: input.fileNumber.trim(),
    Product: input.product.trim(),
    AlsoCover: input.alsoCover.trim(),
    PartNoIncluded: input.partNoIncluded.trim(),
    History: input.history.trim(),
    DateCertified: toSpDateOnly(input.dateCertified),
  };
}

/** Overlay an input onto a listing, so a write can return a fully-formed record. */
function applyInput(base: CsaListing, input: CsaListingInput): CsaListing {
  return {
    ...base,
    fileNumber: input.fileNumber.trim(),
    product: input.product.trim(),
    alsoCover: input.alsoCover.trim(),
    partNoIncluded: input.partNoIncluded.trim(),
    history: input.history.trim(),
    dateCertified: input.dateCertified,
    modifiedAt: new Date(),
  };
}

function emptyListing(id: number): CsaListing {
  return {
    id,
    fileNumber: "",
    product: "",
    alsoCover: "",
    partNoIncluded: "",
    history: "",
    dateCertified: null,
    csaId: null,
    hasAttachments: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
  };
}

export async function createCsaListing(input: CsaListingInput): Promise<CsaListing> {
  if (USE_MOCK) {
    const nextId = Math.max(0, ...mockStore.map((l) => l.id)) + 1;
    const created = applyInput(emptyListing(nextId), input);
    mockStore = [...mockStore, created];
    return delay({ ...created });
  }

  const created = await graphFetch<GraphListItem>(
    `/sites/${SITES.engineering}/lists/${SP_CSA_LISTINGS_LIST_ID}/items`,
    { method: "POST", body: JSON.stringify({ fields: buildCsaWriteFields(input) }) },
  );
  return toCsaListing(created);
}

export async function updateCsaListing(
  id: number,
  input: CsaListingInput,
): Promise<CsaListing> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((l) => l.id === id);
    if (idx < 0) throw new Error(`CSA listing ${id} not found`);
    const next = applyInput(mockStore[idx], input);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return delay({ ...next });
  }

  await graphFetch(
    `/sites/${SITES.engineering}/lists/${SP_CSA_LISTINGS_LIST_ID}/items/${id}/fields`,
    { method: "PATCH", body: JSON.stringify(buildCsaWriteFields(input)) },
  );
  // A PATCH to /fields echoes the fields but not the item envelope, so return the
  // input as applied; the hook's cache patch keeps createdAt from the loaded row.
  return applyInput(emptyListing(id), input);
}

export async function deleteCsaListing(id: number): Promise<void> {
  if (USE_MOCK) {
    mockStore = mockStore.filter((l) => l.id !== id);
    await delay(null);
    return;
  }

  await graphFetch(
    `/sites/${SITES.engineering}/lists/${SP_CSA_LISTINGS_LIST_ID}/items/${id}`,
    { method: "DELETE" },
  );
}
