import { describe, it, expect } from "vitest";
import { toLabelsField, fromLabelsField } from "./labels";
import { LABELS, type Label } from "@/types/task";

// The Labels column is a single-value `choice` (verified against the live list
// on 2026-08-14). Writing an array earned a 400 invalidRequest and stopped any
// labelled task from saving. These pin the wire shape to what the column takes.

describe("toLabelsField — what goes to SharePoint", () => {
  it("writes a bare choice string, never an array", () => {
    const out = toLabelsField(["bug"]);
    expect(out).toBe("bug");
    expect(Array.isArray(out)).toBe(false);
  });

  it("writes null for no label, which clears the column", () => {
    expect(toLabelsField([])).toBeNull();
    expect(toLabelsField(undefined)).toBeNull();
  });

  it("never emits the ';#' join — that isn't one of the allowed choices", () => {
    const out = toLabelsField(["bug", "documentation"]);
    expect(out).toBe("bug");
    expect(out).not.toContain(";#");
  });

  it("only ever emits a value the column actually offers", () => {
    expect(toLabelsField(["not-a-real-label"])).toBeNull();
    expect(toLabelsField(["not-a-real-label", "question"])).toBe("question");
  });

  it.each(LABELS)("round-trips %s unchanged", (label) => {
    expect(toLabelsField([label])).toBe(label);
  });
});

describe("fromLabelsField — what SharePoint sends back", () => {
  it("reads the bare string the column really returns", () => {
    // Values taken verbatim from the live list's sample rows.
    expect(fromLabelsField("documentation")).toEqual(["documentation"]);
    expect(fromLabelsField("question")).toEqual(["question"]);
    expect(fromLabelsField("enhancement")).toEqual(["enhancement"]);
  });

  it("reads an empty column as no labels", () => {
    expect(fromLabelsField(undefined)).toEqual([]);
    expect(fromLabelsField(null)).toEqual([]);
    expect(fromLabelsField("")).toEqual([]);
  });

  it("drops a value that isn't one of the allowed choices", () => {
    expect(fromLabelsField("something-else")).toEqual([]);
  });

  // Tolerated so an older value, or a column later switched to multi-choice,
  // maps cleanly instead of throwing.
  it("still copes with the legacy array and ';#' shapes", () => {
    expect(fromLabelsField(["bug"])).toEqual(["bug"]);
    expect(fromLabelsField("bug;#documentation")).toEqual(["bug", "documentation"]);
  });
});

describe("read and write shapes stay in step", () => {
  it.each(LABELS)("write(%s) then read gives back the same label", (label) => {
    const wire = toLabelsField([label]);
    expect(fromLabelsField(wire)).toEqual([label]);
  });

  it("survives the full clear-and-set cycle", () => {
    const set: Label[] = ["enhancement"];
    expect(fromLabelsField(toLabelsField(set))).toEqual(set);
    expect(fromLabelsField(toLabelsField([]))).toEqual([]);
  });
});
