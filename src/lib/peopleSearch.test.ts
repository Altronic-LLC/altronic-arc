import { describe, it, expect } from "vitest";
import type { Person } from "@/types/task";
import { matchesTokens } from "./itemSearch";
import { detectMentionQuery, rankMentionCandidates } from "./mentions";
import { isHiddenDirectoryAccount, mergePeople } from "./people";

// Searching for a person by "first last" found nobody: every picker did a
// plain `label.includes(query)`, so the space between the two names had to
// appear in the stored display name in exactly that order — and the mention
// picker closed outright at the first space (Ray, 2026-08-18).

const PEOPLE: Person[] = [
  { displayName: "Waldron, Jerrod", email: "jerrod.waldron@altronic-llc.com", lookupId: 1 },
  { displayName: "Sarah Shaffer", email: "sarah.shaffer@altronic-llc.com", lookupId: 2 },
  { displayName: "Jerrod Sanders", email: "jerrod.sanders@altronic-llc.com", lookupId: 3 },
];

describe("matchesTokens", () => {
  it("finds a person typed first-name-then-surname, whichever order the name is stored in", () => {
    expect(matchesTokens("Waldron, Jerrod", "Jerrod W")).toBe(true);
    expect(matchesTokens("Sarah Shaffer", "Sarah S")).toBe(true);
  });

  it("matches the words in any order", () => {
    expect(matchesTokens("Sarah Shaffer", "shaffer sarah")).toBe(true);
  });

  it("still requires every word to match", () => {
    expect(matchesTokens("Sarah Shaffer", "Sarah Q")).toBe(false);
  });

  it("ignores case and stray spacing", () => {
    expect(matchesTokens("Sarah Shaffer", "  SARAH   shaf ")).toBe(true);
  });

  it("matches everything on an empty query", () => {
    expect(matchesTokens("anyone", "   ")).toBe(true);
  });

  it("honours a quoted phrase", () => {
    expect(matchesTokens("Waldron, Jerrod", '"jerrod waldron"')).toBe(false);
    expect(matchesTokens("Jerrod Waldron", '"jerrod waldron"')).toBe(true);
  });
});

describe("rankMentionCandidates", () => {
  it("finds someone by first name and surname initial", () => {
    const { people } = rankMentionCandidates(PEOPLE, "Jerrod W");
    expect(people.map((p) => p.displayName)).toEqual(["Waldron, Jerrod"]);
  });

  it("finds someone by their email address", () => {
    const { people } = rankMentionCandidates(PEOPLE, "sarah.shaffer@");
    expect(people.map((p) => p.displayName)).toEqual(["Sarah Shaffer"]);
  });

  it("ranks a name that STARTS with the first word above one that merely contains it", () => {
    const { people } = rankMentionCandidates(PEOPLE, "Jerrod");
    expect(people.map((p) => p.displayName)).toEqual([
      "Jerrod Sanders",
      "Waldron, Jerrod",
    ]);
  });

  it("returns everyone for an empty query", () => {
    expect(rankMentionCandidates(PEOPLE, "").people).toHaveLength(3);
  });
});

describe("detectMentionQuery", () => {
  const at = (text: string) => detectMentionQuery(text, text.length);

  it("picks up a mention being typed", () => {
    expect(at("hello @sar")).toEqual({ at: 6, query: "sar" });
  });

  it("allows ONE space, so a full name can be typed", () => {
    expect(at("hello @Jerrod W")).toEqual({ at: 6, query: "Jerrod W" });
  });

  it("gives up once the user has moved on to a second word after the name", () => {
    // Two spaces means this is a sentence, not a name.
    expect(at("hello @Jerrod Waldron please")).toBeNull();
  });

  it("is not a mention when the @ is mid-word (an email in the text)", () => {
    expect(at("write to sarah@altronic")).toBeNull();
  });

  it("never spans a line break", () => {
    expect(at("@sarah\nsecond line")).toBeNull();
  });

  it("is not a mention when a space follows the @ immediately", () => {
    expect(at("@ sarah")).toBeNull();
  });

  it("opens on a bare @ so the picker can list everyone", () => {
    expect(at("@")).toEqual({ at: 0, query: "" });
  });

  it("reads the mention the caret is in, not one later in the text", () => {
    const text = "@sar and @bob";
    expect(detectMentionQuery(text, 4)).toEqual({ at: 0, query: "sar" });
  });
});

describe("isHiddenDirectoryAccount", () => {
  it("hides an admin.first.last address", () => {
    expect(
      isHiddenDirectoryAccount({
        displayName: "Ray White",
        email: "admin.ray.white@altronic-llc.com",
      }),
    ).toBe(true);
  });

  it("hides one whose display name carries the prefix", () => {
    expect(
      isHiddenDirectoryAccount({ displayName: "admin.ray.white", email: "arw@x.com" }),
    ).toBe(true);
  });

  it("keeps a real person whose name merely begins with admin", () => {
    // Only the exact "admin." prefix counts — a surname, or a shared mailbox
    // people genuinely assign work to, has to survive.
    expect(
      isHiddenDirectoryAccount({ displayName: "Adminska, Eva", email: "eva@x.com" }),
    ).toBe(false);
    expect(
      isHiddenDirectoryAccount({ displayName: "Admin Team", email: "admin@x.com" }),
    ).toBe(false);
  });

  it("copes with a person carrying no email", () => {
    expect(isHiddenDirectoryAccount({ displayName: "Ray White" })).toBe(false);
  });
});

describe("mergePeople with hidden accounts", () => {
  it("leaves admin accounts out of the merged picker list", () => {
    const admin: Person = {
      displayName: "Ray White",
      email: "admin.ray.white@altronic-llc.com",
    };
    const real: Person = {
      displayName: "Ray White",
      email: "ray.white@altronic-llc.com",
      lookupId: 5,
    };
    const out = mergePeople([admin], [real]);
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("ray.white@altronic-llc.com");
  });
});
