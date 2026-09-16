import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// The per-site lookupId rule, in REAL mode — the bug that added the wrong
// person as a watcher, twice.
//
// **A lookupId is only valid on the ONE site collection it was resolved for.**
// Each site has its own hidden User Information List, so id 46 is one person
// on Engineering and an unrelated person (or nobody) on PMO, the panel team
// site, or Sales.
//
// `useCurrentUser()` resolves the signed-in user's lookupId against the
// ENGINEERING site — it is the app-wide identity and cannot know which list a
// caller is about to write. Every cross-site create passes that Person in as
// the requestor/assignee/creator-watcher. `ensureLookupIds` used to trust an
// incoming lookupId and skip re-resolving, so the Engineering id was written
// to another site's person column, and on the next read resolved to whoever
// holds that id THERE.
//
// Reported twice:
//   2026-09-03  Panel QC — one watcher added, an unrelated third person
//               appeared. Fixed LOCALLY in panelQcIssues.ts.
//   2026-09-16  Gray Market Requests — Adele raised a request and James
//               Henson was added as a watcher, having had nothing to do with
//               it. Same bug, in a module that never got the local patch.
//
// Eight modules across four non-Engineering sites had it. The fix is in the
// shared resolver, and this file pins it at the REQUEST level: mock mode
// resolves every email to a deterministic id regardless of site, so the bug
// is invisible from there — which is exactly why it shipped twice.
// =============================================================================

const spFetch = vi.hoisted(() => vi.fn());
const graphFetch = vi.hoisted(() => vi.fn());
const graphFetchAll = vi.hoisted(() => vi.fn());

vi.mock("./sharepoint", () => ({
  spFetch,
  SharePointUnavailableError: class SharePointUnavailableError extends Error {},
}));

vi.mock("./graph", () => ({
  graphFetch,
  graphFetchAll,
  GraphError: class GraphError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, USE_MOCK: false };
});

import { ensureLookupIds, ensurePersonLookupId, resolvePeopleLookupIds } from "./siteUsers";
import type { Person } from "@/types/task";

const ENGINEERING = "https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering";
const PMO = "https://coopermachineryservices.sharepoint.com/sites/Altronic_PMO";

/**
 * The heart of the bug: ONE person has a DIFFERENT id on each site, and the
 * id Adele holds on Engineering belongs to James Henson on PMO.
 */
const ADELE_ON_ENGINEERING = 88;
const ADELE_ON_PMO = 204;
const JAMES_ON_PMO = 88;

const adele: Person = {
  displayName: "Adele Ferguson",
  email: "adele.ferguson@altronic-llc.com",
  // What useCurrentUser() hands every caller — resolved against ENGINEERING.
  lookupId: ADELE_ON_ENGINEERING,
};

/**
 * `ensureuser` on the PMO site: Adele is 204 there, not 88.
 *
 * `spFetch` takes ONE absolute URL (`<siteUrl>/_api/web/ensureuser`), so the
 * site is read back off the front of that url.
 */
function pmoEnsureUser() {
  spFetch.mockImplementation(async (url: string) => {
    if (!url.includes("ensureuser")) throw new Error(`unexpected url ${url}`);
    if (url.startsWith(PMO)) return { Id: ADELE_ON_PMO };
    if (url.startsWith(ENGINEERING)) return { Id: ADELE_ON_ENGINEERING };
    throw new Error(`unexpected site in ${url}`);
  });
}

/** The site half of an ensureuser url, for asserting which site was asked. */
function siteOf(url: string): string {
  return url.slice(0, url.indexOf("/_api/"));
}

let caseSeq = 0;

/** A fresh identity per test — the resolver caches (site, email) module-wide. */
function freshAdele(): Person {
  caseSeq += 1;
  return { ...adele, email: `adele.ferguson+${caseSeq}@altronic-llc.com` };
}

beforeEach(() => {
  vi.clearAllMocks();
  // No Graph directory — force the ensureuser path.
  graphFetchAll.mockResolvedValue([]);
  graphFetch.mockResolvedValue({ value: [] });
});

describe("the reported bug: a watcher from the wrong site", () => {
  it("does NOT write the Engineering id to a PMO person column", async () => {
    pmoEnsureUser();

    const [out] = await ensureLookupIds(PMO, [freshAdele()]);

    // 88 on PMO is James Henson. Writing it is how he became a watcher on a
    // request Adele raised and he had nothing to do with.
    expect(out.lookupId).not.toBe(JAMES_ON_PMO);
    expect(out.lookupId).toBe(ADELE_ON_PMO);
  });

  it("re-resolves rather than trusting the id it was handed", async () => {
    pmoEnsureUser();

    await ensureLookupIds(PMO, [freshAdele()]);

    // The proof it didn't take the early return: it actually asked the site.
    expect(spFetch).toHaveBeenCalled();
    expect(siteOf(spFetch.mock.calls[0][0] as string)).toBe(PMO);
  });

  it("asks the SITE IT IS WRITING TO, never the site the id came from", async () => {
    pmoEnsureUser();

    await ensureLookupIds(PMO, [freshAdele()]);

    for (const [url] of spFetch.mock.calls) {
      expect(siteOf(url as string)).not.toBe(ENGINEERING);
    }
  });

  it("holds for a single-person column too (requestor, assignee, buyer)", async () => {
    pmoEnsureUser();

    const out = await ensurePersonLookupId(PMO, freshAdele());

    // Gray Market's Requestor column goes through this path — the same wrong
    // id would have named James as the person who raised the request.
    expect(out?.lookupId).toBe(ADELE_ON_PMO);
    expect(out?.lookupId).not.toBe(JAMES_ON_PMO);
  });

  it("preserves who the person IS — only the id is corrected", async () => {
    pmoEnsureUser();

    const person = freshAdele();
    const [out] = await ensureLookupIds(PMO, [person]);

    expect(out.displayName).toBe("Adele Ferguson");
    expect(out.email).toBe(person.email);
  });

  it("returns the SAME id back when it was already right for this site", async () => {
    pmoEnsureUser();

    const alreadyRight: Person = { ...freshAdele(), lookupId: ADELE_ON_PMO };
    const [out] = await ensureLookupIds(PMO, [alreadyRight]);

    // Re-resolving is a little more work and always correct.
    expect(out.lookupId).toBe(ADELE_ON_PMO);
  });
});

describe("when the person can't be resolved on the target site", () => {
  it("DROPS a foreign id rather than writing a name-the-wrong-person value", async () => {
    // A genuine case: somebody who has never visited the PMO site, on a
    // tenant where the classic SharePoint scope isn't granted.
    spFetch.mockResolvedValue({ Id: 0 });

    const [out] = await ensureLookupIds(PMO, [freshAdele()]);

    // Falling back to 88 would be silently wrong. No id lets the caller's own
    // "drop unresolved" / "refuse the write" path handle it.
    expect(out.lookupId).toBeUndefined();
  });

  it("still drops it when the site is unreachable altogether", async () => {
    spFetch.mockRejectedValue(new Error("network"));

    const [out] = await ensureLookupIds(PMO, [freshAdele()]);

    expect(out.lookupId).toBeUndefined();
  });

  it("KEEPS the id when there is no email to re-resolve by", async () => {
    // The legitimate case this must not break: a Person read straight off the
    // list being written, where Graph returned a bare LookupId and no email.
    const fromThisList: Person = { displayName: "", lookupId: 41 };

    const [out] = await ensureLookupIds(PMO, [fromThisList]);

    expect(out.lookupId).toBe(41);
    expect(spFetch).not.toHaveBeenCalled();
  });
});

describe("resolvePeopleLookupIds — the newer Graph-first resolver", () => {
  it("had the identical flaw, and re-resolves too", async () => {
    // Graph's User Information List answers for this site: Adele is 204.
    graphFetchAll.mockResolvedValue([
      {
        id: String(ADELE_ON_PMO),
        fields: {
          id: String(ADELE_ON_PMO),
          EMail: "adele.ferguson@altronic-llc.com",
          Title: "Adele Ferguson",
        },
      },
    ]);

    const [out] = await resolvePeopleLookupIds("pmo-site-id", PMO, [adele]);

    expect(out.lookupId).toBe(ADELE_ON_PMO);
    expect(out.lookupId).not.toBe(JAMES_ON_PMO);
  });
});
