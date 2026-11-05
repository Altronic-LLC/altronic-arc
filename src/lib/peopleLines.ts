import type { Person } from "@/types/task";

// -----------------------------------------------------------------------------
// A list of people as plain text — one "Name <email>" per line.
//
// Used for the distribution list an MCN or an ECN was sent to, and for each
// distribution group's members. Plain text rather than a person column on
// purpose: a person column drops anybody the site can't resolve, and the
// distribution list must keep everyone it was sent to. It also reads in
// SharePoint's own views.
// Lines, not commas, because names in this tenant are often "Last, First".
// -----------------------------------------------------------------------------

export function parsePeopleLines(raw: unknown): Person[] {
  if (typeof raw !== "string") return [];
  const out: Person[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry) continue;
    const angled = /^(.*?)<([^>]+)>\s*$/.exec(entry);
    const email = (angled ? angled[2] : entry).trim();
    if (!email.includes("@")) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const name = angled ? angled[1].trim() : "";
    out.push({ displayName: name || email, email });
  }
  return out;
}

export function serializePeopleLines(people: Person[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const p of people) {
    const email = p.email?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // A name can't carry the brackets that delimit the address.
    const name = (p.displayName || "").replace(/[<>\r\n]/g, " ").trim();
    lines.push(name && name !== email ? `${name} <${email}>` : email);
  }
  return lines.join("\n");
}
