import { describe, expect, it } from "vitest";
import {
  answerFor,
  emptyAnswers,
  isStaleRevision,
  mergeAnswers,
  parseAnswers,
  parseAnswersResult,
  progressFor,
  retiredAnswers,
  sectionProgress,
  sectionsWithItems,
  serialiseAnswers,
  statusFromProgress,
  type EcnChecklistAnswer,
} from "./ecnChecklist";
import {
  ECN_CHECKLIST_ITEMS,
  ECN_CHECKLIST_SECTIONS,
  ECN_CHECKLIST_TEMPLATE_REVISION,
  itemByKey,
  itemsInSection,
} from "./ecnChecklistTemplate";

const KEY_A = ECN_CHECKLIST_ITEMS[0].key;
const KEY_B = ECN_CHECKLIST_ITEMS[1].key;
const KEY_C = ECN_CHECKLIST_ITEMS[2].key;

const complete: EcnChecklistAnswer = { status: "complete", findings: "" };
const na: EcnChecklistAnswer = { status: "na", findings: "Not applicable" };
const flagged: EcnChecklistAnswer = { status: "flagged", findings: "Needs Compliance" };

describe("the template", () => {
  it("carries all 84 items from MFGFRM-038 across 10 sections", () => {
    expect(ECN_CHECKLIST_ITEMS).toHaveLength(84);
    expect(ECN_CHECKLIST_SECTIONS).toHaveLength(10);
  });

  it("has a unique key per item — stored answers point at these", () => {
    const keys = new Set(ECN_CHECKLIST_ITEMS.map((i) => i.key));
    expect(keys.size).toBe(ECN_CHECKLIST_ITEMS.length);
  });

  it("keeps the form's two flag columns: 43 on-ECN, 26 requiring review", () => {
    expect(ECN_CHECKLIST_ITEMS.filter((i) => i.onEcn)).toHaveLength(43);
    expect(ECN_CHECKLIST_ITEMS.filter((i) => i.requiresReview)).toHaveLength(26);
  });

  it("assigns every item to a real section, and every section has items", () => {
    for (const item of ECN_CHECKLIST_ITEMS) {
      expect(ECN_CHECKLIST_SECTIONS.some((s) => s.number === item.section)).toBe(true);
    }
    expect(sectionsWithItems()).toHaveLength(10);
  });

  it("finds an item by key, and returns null for one it no longer declares", () => {
    expect(itemByKey(KEY_A)?.key).toBe(KEY_A);
    expect(itemByKey("s1-a-key-from-an-older-revision")).toBeNull();
  });
});

describe("parsing", () => {
  it("reads an empty column as an untouched checklist, NOT as corrupt", () => {
    for (const raw of ["", "   ", null, undefined]) {
      const r = parseAnswersResult(raw);
      expect(r.corrupt).toBe(false);
      expect(r.answers.items).toEqual({});
    }
  });

  it("round-trips through serialise", () => {
    const answers = mergeAnswers(emptyAnswers(), { [KEY_A]: complete, [KEY_B]: flagged });
    expect(parseAnswers(serialiseAnswers(answers))).toEqual(answers);
  });

  it("reports unreadable JSON as corrupt rather than throwing", () => {
    const r = parseAnswersResult("{not json");
    expect(r.corrupt).toBe(true);
    // Degrades to empty so a detail page still renders.
    expect(r.answers.items).toEqual({});
  });

  it("treats a non-object payload as corrupt", () => {
    expect(parseAnswersResult("[1,2,3]").corrupt).toBe(true);
    expect(parseAnswersResult('"a string"').corrupt).toBe(true);
  });

  it("drops a junk status back to notStarted rather than trusting it", () => {
    const raw = JSON.stringify({ items: { [KEY_A]: { status: "banana", findings: "hi" } } });
    expect(answerFor(parseAnswers(raw), KEY_A)).toEqual({ status: "notStarted", findings: "hi" });
  });

  it("ignores an item entry that isn't an object", () => {
    const raw = JSON.stringify({ items: { [KEY_A]: "nope", [KEY_B]: complete } });
    const answers = parseAnswers(raw);
    expect(answers.items[KEY_A]).toBeUndefined();
    expect(answers.items[KEY_B]).toEqual(complete);
  });

  it("drops an entry carrying no information at all", () => {
    const raw = JSON.stringify({ items: { [KEY_A]: { status: "notStarted", findings: "" } } });
    expect(parseAnswers(raw).items).toEqual({});
  });

  it("keeps a notStarted entry that still carries findings", () => {
    const raw = JSON.stringify({ items: { [KEY_A]: { status: "notStarted", findings: "wip" } } });
    expect(parseAnswers(raw).items[KEY_A]).toEqual({ status: "notStarted", findings: "wip" });
  });
});

describe("mergeAnswers — why two engineers don't clobber each other", () => {
  it("applies ONLY the changed keys onto what was read back", () => {
    // What SharePoint holds — engineer A already answered KEY_A.
    const fromServer = mergeAnswers(emptyAnswers(), { [KEY_A]: complete });
    // Engineer B answers a DIFFERENT item.
    const merged = mergeAnswers(fromServer, { [KEY_B]: flagged });
    expect(merged.items[KEY_A]).toEqual(complete);
    expect(merged.items[KEY_B]).toEqual(flagged);
  });

  it("does not mutate the base it merges onto", () => {
    const base = mergeAnswers(emptyAnswers(), { [KEY_A]: complete });
    mergeAnswers(base, { [KEY_B]: flagged });
    expect(base.items[KEY_B]).toBeUndefined();
  });

  it("replaces an item's slot rather than appending a second entry", () => {
    let answers = mergeAnswers(emptyAnswers(), { [KEY_A]: complete });
    answers = mergeAnswers(answers, { [KEY_A]: na });
    expect(Object.keys(answers.items)).toEqual([KEY_A]);
    expect(answers.items[KEY_A]).toEqual(na);
  });

  it("REMOVES an item cleared back to notStarted with no findings", () => {
    let answers = mergeAnswers(emptyAnswers(), { [KEY_A]: complete });
    answers = mergeAnswers(answers, { [KEY_A]: { status: "notStarted", findings: "" } });
    expect(answers.items[KEY_A]).toBeUndefined();
  });

  it("keeps an item reset to notStarted that still has findings", () => {
    const answers = mergeAnswers(emptyAnswers(), {
      [KEY_A]: { status: "notStarted", findings: "still checking" },
    });
    expect(answers.items[KEY_A]).toEqual({ status: "notStarted", findings: "still checking" });
  });

  it("carries the template revision through unchanged", () => {
    const base = { templateRevision: "0", items: {} };
    expect(mergeAnswers(base, { [KEY_A]: complete }).templateRevision).toBe("0");
  });
});

describe("progress", () => {
  it("counts an untouched checklist as all outstanding, 0%", () => {
    const p = progressFor(emptyAnswers());
    expect(p).toMatchObject({ total: 84, notStarted: 84, outstanding: 84, percent: 0 });
    expect(p.finished).toBe(false);
  });

  it("counts each state separately", () => {
    const answers = mergeAnswers(emptyAnswers(), {
      [KEY_A]: complete,
      [KEY_B]: na,
      [KEY_C]: flagged,
    });
    const p = progressFor(answers);
    expect(p).toMatchObject({ complete: 1, na: 1, flagged: 1, notStarted: 81 });
  });

  it("treats N/A as SETTLED — the whole reason the state exists", () => {
    // Every item N/A is a finished checklist, not a 0% one.
    const all: Record<string, EcnChecklistAnswer> = {};
    for (const item of ECN_CHECKLIST_ITEMS) all[item.key] = na;
    const p = progressFor(mergeAnswers(emptyAnswers(), all));
    expect(p.outstanding).toBe(0);
    expect(p.percent).toBe(100);
    expect(p.finished).toBe(true);
  });

  it("treats a FLAGGED item as settled too — it has been answered", () => {
    const all: Record<string, EcnChecklistAnswer> = {};
    for (const item of ECN_CHECKLIST_ITEMS) all[item.key] = flagged;
    expect(progressFor(mergeAnswers(emptyAnswers(), all)).finished).toBe(true);
  });

  it("scopes to one section", () => {
    const section1 = itemsInSection(1);
    const answers = mergeAnswers(emptyAnswers(), { [section1[0].key]: complete });
    const p = sectionProgress(answers, 1);
    expect(p.total).toBe(section1.length);
    expect(p.complete).toBe(1);
  });

  it("ignores an answer whose key isn't in the set being counted", () => {
    // An answer from section 3 must not inflate section 1's numbers.
    const other = itemsInSection(3)[0];
    const answers = mergeAnswers(emptyAnswers(), { [other.key]: complete });
    expect(sectionProgress(answers, 1).complete).toBe(0);
  });
});

describe("statusFromProgress", () => {
  it("is Not Started when nothing has been answered", () => {
    expect(statusFromProgress(progressFor(emptyAnswers()))).toBe("Not Started");
  });

  it("is In Progress once something has", () => {
    const answers = mergeAnswers(emptyAnswers(), { [KEY_A]: complete });
    expect(statusFromProgress(progressFor(answers))).toBe("In Progress");
  });

  it("is Complete once nothing is outstanding", () => {
    const all: Record<string, EcnChecklistAnswer> = {};
    for (const item of ECN_CHECKLIST_ITEMS) all[item.key] = complete;
    expect(statusFromProgress(progressFor(mergeAnswers(emptyAnswers(), all)))).toBe("Complete");
  });
});

describe("surviving a form revision", () => {
  it("surfaces an answer the current template no longer declares", () => {
    const answers = mergeAnswers(emptyAnswers(), {
      "s1-retired-item-from-rev-0": { status: "complete", findings: "was answered" },
      [KEY_A]: complete,
    });
    const retired = retiredAnswers(answers);
    expect(retired).toHaveLength(1);
    expect(retired[0].key).toBe("s1-retired-item-from-rev-0");
    // The live item is NOT reported as retired.
    expect(retired.some((r) => r.key === KEY_A)).toBe(false);
  });

  it("reports nothing retired for answers against the current template", () => {
    expect(retiredAnswers(mergeAnswers(emptyAnswers(), { [KEY_A]: complete }))).toEqual([]);
  });

  it("flags answers given against a different revision", () => {
    expect(isStaleRevision(emptyAnswers())).toBe(false);
    expect(isStaleRevision({ templateRevision: "99", items: {} })).toBe(true);
    expect(emptyAnswers().templateRevision).toBe(ECN_CHECKLIST_TEMPLATE_REVISION);
  });
});
