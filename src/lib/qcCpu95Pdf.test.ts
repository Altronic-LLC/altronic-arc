import { describe, expect, it } from "vitest";
import type { QcCpu95Record } from "@/types/task";
import { qcCpu95EmptyValues } from "./qcCpu95Fields";
import { buildQcCpu95PdfDocument, generateQcCpu95Pdf, qcCpu95PdfFileName, toWinAnsi } from "./qcCpu95Pdf";

// =============================================================================
// The QCFRM-012 PDF. Reads the REAL text out of an uncompressed jsPDF
// document (the quotePdf.test.ts approach). Where each value lands is pinned
// in qcCpu95Sheet.test.ts; this file pins what the renderer adds — pages,
// encoding, and that a long value is continued, never cut off.
// =============================================================================

function pdfText(raw: string): string {
  const runs: string[] = [];
  const re = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    runs.push(
      m[1].replace(/\\([0-7]{1,3}|.)/g, (_, esc: string) =>
        /^[0-7]+$/.test(esc) ? String.fromCharCode(parseInt(esc, 8)) : esc,
      ),
    );
  }
  return runs.join("\n").replace(/\u0097/g, "—");
}

function record(values: Record<string, string>): QcCpu95Record {
  return { id: 42, values: { ...qcCpu95EmptyValues(), ...values }, createdAt: new Date(0), modifiedAt: new Date(0) };
}

async function render(r: QcCpu95Record | null) {
  const doc = await buildQcCpu95PdfDocument(r, { exportedOn: "2026-10-20", compress: false });
  return { text: pdfText(doc.output()), pages: doc.getNumberOfPages() };
}

describe("the blank PDF", () => {
  it("is two Letter pages of real text", async () => {
    const { text, pages } = await render(null);
    expect(pages).toBe(2);
    expect(text).toContain("CPU-95 IGNITION SYSTEM - IGNITION MODULE");
    expect(text).toContain("INITIAL START-UP (23° C)");
    expect(text).toContain("Triac leakage test 20 µa maximum hot.");
    expect(text).toContain("Post Test Inspection per QWI-342 and 791950 Print");
    expect(text).not.toContain("Exported from ARC");
  });

  it("generates a PDF blob", async () => {
    const blob = await generateQcCpu95Pdf(null, { exportedOn: "2026-10-20" });
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(1000);
  });
});

describe("a filled PDF", () => {
  it("prints the record's values", async () => {
    const { text, pages } = await render(
      record({ serialNumber: "25564", altronicPartNumber: "791950-16", finalTestBy: "J. Tester" }),
    );
    expect(pages).toBe(2);
    expect(text).toContain("25564");
    expect(text).toContain("J. Tester");
    expect(text).toContain("Exported from ARC on 10/20/2026 — test sheet #42");
  });

  it("is the test sheet alone for a part number that isn't 791950", async () => {
    const { text, pages } = await render(record({ altronicPartNumber: "791962-18" }));
    expect(pages).toBe(1);
    expect(text).not.toContain("Post Test Inspection");
  });

  it("continues long comments on a page of their own, in full", async () => {
    const comments = Array.from({ length: 30 }, (_, i) => `Note ${i + 1} about the retest.`).join(" ");
    const { text, pages } = await render(record({ serialNumber: "25564", altronicPartNumber: "791950-16", comments }));
    expect(pages).toBe(3);
    expect(text).toContain("(continued on page 3)");
    expect(text).toContain("Test sheet 25564 — continued");
    expect(text).toContain("Note 30 about the retest.");
  });

  it("numbers the continuation page after the sheet alone when there's no inspection page", async () => {
    const comments = Array.from({ length: 30 }, (_, i) => `Note ${i + 1}.`).join(" ");
    const { text, pages } = await render(record({ altronicPartNumber: "791962-18", comments }));
    expect(pages).toBe(2);
    expect(text).toContain("(continued on page 2)");
  });

  it("keeps a short comment on the sheet", async () => {
    const { text, pages } = await render(record({ altronicPartNumber: "791950-16", comments: "Re-tested OK." }));
    expect(pages).toBe(2);
    expect(text).toContain("Re-tested OK.");
  });
});

describe("toWinAnsi", () => {
  it("keeps what the built-in fonts can print and replaces the rest", () => {
    expect(toWinAnsi("23° C ±5 µA – ok")).toBe("23° C ±5 µA – ok");
    expect(toWinAnsi("20 μA")).toBe("20 µA"); // Greek mu → micro sign
    expect(toWinAnsi("a→b\tc")).toBe("a?b c");
  });
});

describe("qcCpu95PdfFileName", () => {
  it("names the blank form, and a filled one after its serial number", () => {
    expect(qcCpu95PdfFileName(null)).toBe("QCFRM-012 CPU-95 blank.pdf");
    expect(qcCpu95PdfFileName(record({ serialNumber: "25/564" }))).toBe("QCFRM-012 CPU-95 25-564.pdf");
    expect(qcCpu95PdfFileName(record({ serialNumber: "" }))).toBe("QCFRM-012 CPU-95 sheet 42.pdf");
  });
});
