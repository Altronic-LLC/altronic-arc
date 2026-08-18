import { describe, it, expect } from "vitest";
import { createEir, listEirs, updateEirFields } from "./eirs";

// USE_MOCK is true under Vitest, so these exercise the in-memory EIR store —
// which runs the SAME conversion the Graph path does, because it happens
// before the mock/real branch.
//
// Why this matters: the EIR list's long-text columns are Enhanced rich text.
// Text saved verbatim from a textarea came back as one run-on block, because
// a newline is insignificant whitespace in HTML ("all sentences/paragraphs
// were smooshed together", reported 2026-08-18).

async function makeEir(description: string) {
  const created = await createEir({ title: "Rich text round-trip", description });
  return created;
}

describe("EIR writes — rich-text conversion", () => {
  it("stores a typed description as real paragraphs", async () => {
    const eir = await makeEir("First paragraph.\n\nSecond paragraph.");
    expect(eir.description).toBe(
      "<p>First paragraph.</p><p>Second paragraph.</p>",
    );
  });

  it("keeps a single newline as a line break", async () => {
    const eir = await makeEir("Line one\nLine two");
    expect(eir.description).toBe("<p>Line one<br/>Line two</p>");
  });

  it("leaves HTML from the rich editor untouched", async () => {
    const html = "<p>Needs <strong>bold</strong> here.</p>";
    const eir = await makeEir(html);
    expect(eir.description).toBe(html);
  });

  it("leaves checklist text plain so the checkboxes still parse", async () => {
    const checklist = "- [ ] measure it\n- [x] log it";
    const eir = await makeEir(checklist);
    expect(eir.description).toBe(checklist);
  });

  it("converts on edit too, not just on create", async () => {
    const eir = await makeEir("Original.");
    const updated = await updateEirFields(eir.id, {
      Description: "Edited first.\n\nEdited second.",
    });
    expect(updated.description).toBe(
      "<p>Edited first.</p><p>Edited second.</p>",
    );
  });

  it("converts Engineering Response and Where Used the same way", async () => {
    const eir = await makeEir("Anything.");
    const updated = await updateEirFields(eir.id, {
      EngineeringResponse: "We looked.\n\nWe fixed it.",
      WhereUsed: "Rig 4\nRig 9",
    });
    expect(updated.engineeringResponse).toBe("<p>We looked.</p><p>We fixed it.</p>");
    expect(updated.whereUsed).toBe("<p>Rig 4<br/>Rig 9</p>");
  });

  it("leaves fields it isn't responsible for exactly as passed", async () => {
    const eir = await makeEir("Anything.");
    const updated = await updateEirFields(eir.id, {
      TaskReference: "line one\nline two",
    });
    expect(updated.taskReference).toBe("line one\nline two");
  });

  it("survives a re-read of the list", async () => {
    const eir = await makeEir("Stored.\n\nAnd read back.");
    const all = await listEirs();
    const found = all.find((e) => e.id === eir.id)!;
    expect(found.description).toBe("<p>Stored.</p><p>And read back.</p>");
  });
});
