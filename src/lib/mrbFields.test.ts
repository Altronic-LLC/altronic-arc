import { describe, it, expect } from "vitest";
import {
  MRB_FIELDS,
  MRB_FIELD_BY_KEY,
  MRB_PROVENANCE_FIELDS,
  MRB_SELECT,
  mrbChoiceOptions,
  provenanceToShow,
} from "./mrbFields";
import { MRB_DISPOSITIONS, MRB_WHERE_CAUSED } from "@/types/task";

describe("MRB_SELECT", () => {
  it("asks for Data Format — the live/archive discriminator", () => {
    expect(MRB_SELECT).toContain("field_12");
  });

  it("asks for Title and NEVER for the read-only LinkTitle", () => {
    expect(MRB_SELECT.split(",")).toContain("Title");
    expect(MRB_SELECT.split(",")).not.toContain("LinkTitle");
  });

  it("names Title exactly once", () => {
    // MRB_FIELDS carries Title as the sapNumber column, and the select adds
    // it explicitly too — a duplicate would be harmless but sloppy, and the
    // filter that prevents it is easy to drop.
    expect(MRB_SELECT.split(",").filter((c) => c === "Title")).toHaveLength(1);
  });

  it("covers every descriptor column", () => {
    const selected = new Set(MRB_SELECT.split(","));
    for (const field of [...MRB_FIELDS, ...MRB_PROVENANCE_FIELDS]) {
      expect(selected.has(field.column), `${field.label} (${field.column})`).toBe(true);
    }
  });
});

describe("MRB_FIELDS", () => {
  it("has no duplicate keys or columns", () => {
    const all = [...MRB_FIELDS, ...MRB_PROVENANCE_FIELDS];
    expect(new Set(all.map((f) => f.key)).size).toBe(all.length);
    expect(new Set(all.map((f) => f.column)).size).toBe(all.length);
  });

  it("marks every provenance column read-only", () => {
    for (const field of MRB_PROVENANCE_FIELDS) {
      expect(field.readOnly, field.label).toBe(true);
    }
  });

  // `field_2`'s SharePoint label is "Old Part Number"; ARC calls it the
  // Altronic Part Number (Tim, 2026-09-21) — the same call the Teradyne Log
  // made for the column literally named OldSAPNumber. The COLUMN must not
  // change with the label: existing SharePoint views and anything reporting
  // off the list point at field_2.
  it("labels field_2 as the Altronic Part Number, without renaming the column", () => {
    const field = MRB_FIELD_BY_KEY.oldPartNumber;
    expect(field.label).toBe("Altronic Part Number");
    expect(field.column).toBe("field_2");
  });

  // The label is read from this table by the list column, the detail card
  // and the edit modal. Hand-typing it in any of them is how one screen ends
  // up disagreeing with another about what a field is called.
  it("is the single source of every field label", () => {
    for (const field of MRB_FIELDS) {
      expect(field.label.trim(), field.key).not.toBe("");
      expect(MRB_FIELD_BY_KEY[field.key]).toBe(field);
    }
  });
});

describe("mrbChoiceOptions", () => {
  // 726 rows hold "Unclassified (Legacy)" in Where Caused and 8 hold it in
  // Disposition — WITH a space, against a column declaring it WITHOUT one,
  // on a column that refuses fill-in values. A picker built from the
  // declared choices alone shows such a row as blank and silently
  // reassigns it on save.
  it("keeps a stored value the column does not declare", () => {
    const options = mrbChoiceOptions(MRB_WHERE_CAUSED, "Unclassified (Legacy)");
    expect(options).toContain("Unclassified (Legacy)");
    expect(options).toHaveLength(MRB_WHERE_CAUSED.length + 1);
  });

  it("does not duplicate a value that IS declared", () => {
    expect(mrbChoiceOptions(MRB_DISPOSITIONS, "Scrap")).toEqual([...MRB_DISPOSITIONS]);
  });

  it("adds nothing for a blank value", () => {
    expect(mrbChoiceOptions(MRB_WHERE_CAUSED, "")).toEqual([...MRB_WHERE_CAUSED]);
    expect(mrbChoiceOptions(MRB_WHERE_CAUSED, "   ")).toEqual([...MRB_WHERE_CAUSED]);
  });

  it("never mutates the constant it was handed", () => {
    const before = [...MRB_WHERE_CAUSED];
    mrbChoiceOptions(MRB_WHERE_CAUSED, "Something else");
    expect([...MRB_WHERE_CAUSED]).toEqual(before);
  });
});

describe("provenanceToShow", () => {
  const archive = (provenance: Record<string, string>, over: Record<string, string> = {}) => ({
    provenance,
    whereCaused: "",
    disposition: "",
    dataFormat: "Legacy",
    ...over,
  });

  it("drops blank columns", () => {
    const shown = provenanceToShow(archive({ whereDetectedLegacy: "MS", poNumberLegacy: "" }));
    expect(shown.map((f) => f.key)).toEqual(["whereDetectedLegacy"]);
  });

  // field_20/21 exactly mirror field_6/7 on every live row and plenty of
  // archive ones, so showing them would print the same value twice.
  it("drops an 'as written' column that merely repeats the choice beside it", () => {
    const shown = provenanceToShow(
      archive(
        { whereCausedOriginal: "Vendor", dispositionOriginal: "Scrap" },
        { whereCaused: "Vendor", disposition: "Scrap" },
      ),
    );
    expect(shown).toHaveLength(0);
  });

  it("KEEPS an 'as written' column that differs — that is the useful case", () => {
    const shown = provenanceToShow(
      archive(
        { whereCausedOriginal: "PRODUCTION", dispositionOriginal: "SCRAPPED" },
        { whereCaused: "Unclassified (Legacy)", disposition: "Scrap" },
      ),
    );
    expect(shown.map((f) => f.key)).toEqual([
      "whereCausedOriginal",
      "dispositionOriginal",
    ]);
  });

  // The bug Tim caught on 1000-1347-00: field_23 is filled on all 97 LIVE
  // rows too, so a "non-blank" rule alone put a whole "From the source
  // workbook" card on a live entry showing one meaningless row index.
  it("shows NOTHING on a live entry, even though it carries a workbook row", () => {
    expect(
      provenanceToShow({
        provenance: { sourceWorkbookRow: "97" },
        whereCaused: "Operator Error",
        disposition: "",
        dataFormat: "Current",
      }),
    ).toEqual([]);
  });

  it("DOES show the workbook row on an archive entry", () => {
    const shown = provenanceToShow(archive({ sourceWorkbookRow: "2" }));
    expect(shown.map((f) => f.key)).toEqual(["sourceWorkbookRow"]);
  });

  it("is tolerant of how the Legacy flag is cased and spaced", () => {
    expect(
      provenanceToShow(archive({ sourceWorkbookRow: "2" }, { dataFormat: " legacy " })),
    ).toHaveLength(1);
  });
});
