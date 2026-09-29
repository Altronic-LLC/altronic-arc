import { describe, expect, it } from "vitest";
import type { ComponentDescriptionOption } from "@/types/task";
import {
  cleanOptionName,
  composeDescription,
  EMPTY_PICKS,
  nextSortOrder,
  optionNameProblem,
  optionsOfKind,
  parseTypes,
  picksProblem,
  reconcilePicks,
  seedOptions,
  serializeTypes,
  typeNameProblem,
  typesFor,
} from "./componentDescriptions";
import { ratingLabelsFor } from "./componentRatings";

const opt = (
  id: number,
  kind: ComponentDescriptionOption["kind"],
  name: string,
  types: string[] = [],
  sortOrder = id * 10,
): ComponentDescriptionOption => ({ id, kind, name, types, sortOrder });

const OPTIONS = [
  opt(1, "Description", "Capacitor", ["Ceramic", "Tantalum"]),
  opt(2, "Description", "Relay"),
  opt(3, "SIL Category", "SIL CAT 1"),
  opt(4, "SIL Category", "SIL CAT 2"),
];

describe("composeDescription", () => {
  it("joins the picks in capitals, the way the existing data is written", () => {
    expect(composeDescription({ silCategory: "", name: "Capacitor", type: "Ceramic" })).toBe("CAPACITOR - CERAMIC");
  });

  it("puts the SIL category first", () => {
    expect(composeDescription({ silCategory: "SIL CAT 1", name: "Capacitor", type: "Ceramic" })).toBe(
      "SIL CAT 1 - CAPACITOR - CERAMIC",
    );
  });

  it("is the description alone when it has no types", () => {
    expect(composeDescription({ silCategory: "", name: "Relay", type: "" })).toBe("RELAY");
  });

  it("reads right for the rating labels, SIL prefix and all", () => {
    expect(ratingLabelsFor(composeDescription({ silCategory: "SIL CAT 2", name: "Capacitor", type: "Ceramic" })).component).toBe(
      "Capacitor ceramic",
    );
    expect(ratingLabelsFor(composeDescription({ silCategory: "", name: "Transistor", type: "FET - N channel" })).component).toBe(
      "Transistor fet",
    );
  });
});

describe("picksProblem", () => {
  it("wants a Description", () => {
    expect(picksProblem(EMPTY_PICKS, OPTIONS, false)).toBe("Pick a Description.");
  });

  it("wants a Type when the Description has types, and not when it has none", () => {
    expect(picksProblem({ silCategory: "", name: "Capacitor", type: "" }, OPTIONS, false)).toBe("Pick a Type for Capacitor.");
    expect(picksProblem({ silCategory: "", name: "Relay", type: "" }, OPTIONS, false)).toBeNull();
  });

  it("wants a SIL category on the 722 list — unless the list offers none", () => {
    const picks = { silCategory: "", name: "Relay", type: "" };
    expect(picksProblem(picks, OPTIONS, true)).toBe("Pick the SIL category.");
    expect(picksProblem(picks, OPTIONS.filter((o) => o.kind === "Description"), true)).toBeNull();
    expect(picksProblem(picks, OPTIONS, false)).toBeNull();
  });
});

describe("reconcilePicks", () => {
  it("keeps picks the list still offers, in the list's spelling", () => {
    expect(reconcilePicks({ silCategory: "sil cat 1", name: "capacitor", type: "CERAMIC" }, OPTIONS)).toEqual({
      silCategory: "SIL CAT 1",
      name: "Capacitor",
      type: "Ceramic",
    });
  });

  it("drops a pick the list no longer offers, and a type that isn't under the description", () => {
    expect(reconcilePicks({ silCategory: "SIL CAT 9", name: "Capacitor", type: "Film" }, OPTIONS)).toEqual({
      silCategory: "",
      name: "Capacitor",
      type: "",
    });
    expect(reconcilePicks({ silCategory: "", name: "Fuse", type: "Ceramic" }, OPTIONS)).toEqual(EMPTY_PICKS);
  });
});

describe("the option rules", () => {
  it("reads Types one per line, dropping blanks and repeats", () => {
    expect(parseTypes("Film\r\n\n Wirewound \nfilm\n")).toEqual(["Film", "Wirewound"]);
    expect(parseTypes(null)).toEqual([]);
    expect(serializeTypes(["A", " B ", "a"])).toBe("A\nB");
  });

  it("drops a trailing dash — the separator is added on save", () => {
    expect(cleanOptionName(" SIL CAT 1 - ")).toBe("SIL CAT 1");
    expect(cleanOptionName("FET - P channel")).toBe("FET - P channel");
  });

  it("refuses a blank or duplicate name, within its kind only", () => {
    expect(optionNameProblem("  ", "Description", OPTIONS)).toBe("Type the description.");
    expect(optionNameProblem("capacitor", "Description", OPTIONS)).toBe('"Capacitor" is already on the list.');
    expect(optionNameProblem("SIL CAT 1 -", "SIL Category", OPTIONS)).toBe('"SIL CAT 1" is already on the list.');
    expect(optionNameProblem("Capacitor", "SIL Category", OPTIONS)).toBeNull();
    // Renaming a row to its own name isn't a clash.
    expect(optionNameProblem("Capacitor", "Description", OPTIONS, 1)).toBeNull();
  });

  it("refuses a blank or duplicate type", () => {
    expect(typeNameProblem("", ["Film"])).toBe("Type the type.");
    expect(typeNameProblem("film", ["Film"])).toBe('"Film" is already a type here.');
    expect(typeNameProblem("Power", ["Film"])).toBeNull();
  });

  it("orders by SortOrder, then name, and adds after the last", () => {
    const rows = [opt(1, "Description", "B", [], 20), opt(2, "Description", "A", [], 20), opt(3, "Description", "C", [], 10)];
    expect(optionsOfKind(rows, "Description").map((o) => o.name)).toEqual(["C", "A", "B"]);
    expect(nextSortOrder(rows, "Description")).toBe(30);
    expect(nextSortOrder(rows, "SIL Category")).toBe(10);
  });

  it("finds a description's types by name, ignoring case", () => {
    expect(typesFor(OPTIONS, "CAPACITOR")).toEqual(["Ceramic", "Tantalum"]);
    expect(typesFor(OPTIONS, "")).toEqual([]);
  });
});

describe("the seed", () => {
  it("is the old app's thirteen descriptions and the two SIL categories", () => {
    const seed = seedOptions();
    const descriptions = optionsOfKind(seed, "Description");
    expect(descriptions.map((d) => d.name)).toEqual([
      "Resistor", "Capacitor", "Diode", "Transistor", "Inductor", "Transformer", "IC",
      "Relay", "Crystal", "Oscillator", "Battery", "Trimpot", "Display",
    ]);
    expect(typesFor(seed, "IC")).toHaveLength(16);
    expect(optionsOfKind(seed, "SIL Category").map((s) => s.name)).toEqual(["SIL CAT 1", "SIL CAT 2"]);
    expect(new Set(seed.map((o) => o.id)).size).toBe(seed.length);
  });
});
