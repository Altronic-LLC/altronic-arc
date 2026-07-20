import { graphFetchAllScoped } from "./graph";
import { USE_MOCK } from "./config";
import { directoryScopes } from "@/auth/msalConfig";
import type { Person } from "@/types/task";
import { mockLookupIdForEmail } from "@/lib/mentions";

// =============================================================================
// Staff directory — the whole tenant's users (Graph /users) so the
// assignment + @-mention pickers can offer ANY person at Altronic, not just
// people already on an item.
//
// (We originally expanded a specific "all staff" group, but AllAltronic is an
// Exchange distribution list, which Graph can't expand into members — so we
// read the tenant directory directly instead. Simpler and always current.)
//
// Read via Graph under a SEPARATE, lazily-requested scope
// (directoryScopes / User.ReadBasic.All) so a tenant that hasn't
// admin-consented to it can't break sign-in — token acquisition fails
// silently and this returns [], and the pickers fall back to people already
// known to the app. See graphFetchScoped in api/graph.ts.
//
// Directory people carry NO SharePoint lookupId (this is a tenant/Entra
// concept, not a per-site one). The lookupId needed to actually WRITE a
// person field is resolved on demand at write time via ensureuser — see
// api/siteUsers.ts.
// =============================================================================

interface GraphDirectoryUser {
  id: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
}

// A handful of staff for demo mode — deliberately includes people who are NOT
// on any mock item, to show that you can assign/@-mention someone brand new.
// Mock directory people get a deterministic lookupId so assignment works in
// the demo (real mode resolves lookupIds via ensureuser at write time).
const MOCK_DIRECTORY: Person[] = [
  "Ray White|ray.white@altronic-llc.com",
  "Sarah Shaffer|sarah.shaffer@altronic-llc.com",
  "David Bulkley|david.bulkley@altronic-llc.com",
  "Eric Gilkinson|eric.gilkinson@altronic-llc.com",
  "Amanda Hoagland|amanda.hoagland@altronic-llc.com",
  "Chandana Ramisetty|chandana.ramisetty@altronic-llc.com",
  "Alyssa Garrett|alyssa.garrett@altronic-llc.com",
  // Fresh faces not on any mock item — proves "assign to anyone" works.
  "Marcus Webb|marcus.webb@altronic-llc.com",
  "Priya Nair|priya.nair@altronic-llc.com",
  "Tom Delgado|tom.delgado@altronic-llc.com",
].map((s) => {
  const [displayName, email] = s.split("|");
  return { displayName, email, lookupId: mockLookupIdForEmail(email) };
});

/**
 * Every user in the tenant directory, as `Person[]` (displayName + email; no
 * lookupId). Returns [] — never throws — when the directory can't be read,
 * so callers can merge it in unconditionally.
 */
export async function listDirectoryPeople(): Promise<Person[]> {
  if (USE_MOCK) return MOCK_DIRECTORY.map((p) => ({ ...p }));

  try {
    // $top=999 is the max page size; graphFetchAllScoped walks @odata.nextLink
    // for tenants larger than one page. userType isn't in the ReadBasic
    // property set, so external guests are filtered client-side by UPN.
    const users = await graphFetchAllScoped<GraphDirectoryUser>(
      "/users?$select=id,displayName,mail,userPrincipalName&$top=999",
      directoryScopes,
    );
    return mapDirectoryUsers(users);
  } catch (err) {
    // Expected until an Entra admin consents to User.ReadBasic.All — the
    // silent token request throws and we degrade to known people. Warn (not
    // error) so it's discoverable without alarming.
    console.warn(
      "[directory] Couldn't read the tenant directory — assign/@-mention will use " +
        "people already known to the app until User.ReadBasic.All is consented:",
      err,
    );
    return [];
  }
}

/**
 * Map raw Graph users → deduped, sorted Person[]. Skips accounts with no
 * display name or no email/UPN (service accounts) and external guests
 * (`#EXT#` UPNs). Exported for testing.
 */
export function mapDirectoryUsers(users: GraphDirectoryUser[]): Person[] {
  const byEmail = new Map<string, Person>();
  for (const u of users) {
    const displayName = (u.displayName ?? "").trim();
    const upn = (u.userPrincipalName ?? "").trim();
    const email = (u.mail ?? upn).trim();
    if (!displayName || !email) continue; // skip mail-less service accounts
    if (upn.includes("#EXT#")) continue; // skip external guests
    const key = email.toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, { displayName, email });
  }
  return [...byEmail.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
