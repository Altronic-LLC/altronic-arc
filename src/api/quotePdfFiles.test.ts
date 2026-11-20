import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetQuotePdfMockStore,
  listQuotePdfs,
  QUOTE_PDF_FOLDER_PATH,
  saveQuotePdf,
} from "./quotePdfFiles";

// Mock mode (the default under Vitest). Real-mode request shapes are pinned in
// quotePdfFiles.real.test.ts.

const pdf = (text = "%PDF-1.3 mock") => new Blob([text], { type: "application/pdf" });

beforeEach(() => {
  __resetQuotePdfMockStore();
});

describe("quote PDF folder (mock mode)", () => {
  it("is General/IC Quotes", () => {
    expect(QUOTE_PDF_FOLDER_PATH).toBe("General/IC Quotes");
  });

  it("saves a PDF under its own name", async () => {
    const saved = await saveQuotePdf(pdf(), "IQ-COO-0042-R1.pdf");
    expect(saved.name).toBe("IQ-COO-0042-R1.pdf");
    expect(saved.webUrl).toContain("IQ-COO-0042-R1.pdf");
  });

  it("RENAMES a clash rather than overwriting", async () => {
    await saveQuotePdf(pdf("first"), "IQ-COO-0042-R1.pdf");
    const second = await saveQuotePdf(pdf("second, longer"), "IQ-COO-0042-R1.pdf");
    const third = await saveQuotePdf(pdf(), "IQ-COO-0042-R1.pdf");
    expect(second.name).toBe("IQ-COO-0042-R1 1.pdf");
    expect(third.name).toBe("IQ-COO-0042-R1 2.pdf");
    const files = await listQuotePdfs("IQ-COO-0042");
    expect(files).toHaveLength(3);
    // The first file is still there, untouched.
    expect(files.find((f) => f.name === "IQ-COO-0042-R1.pdf")?.size).toBe(5);
  });

  it("lists only that quote's PDFs (every rev), newest first", async () => {
    await saveQuotePdf(pdf(), "IQ-COO-0042-R1.pdf");
    await saveQuotePdf(pdf(), "IQ-ABC-0001-R1.pdf");
    await saveQuotePdf(pdf(), "IQ-COO-0042-R2.pdf");
    const files = await listQuotePdfs("IQ-COO-0042");
    expect(files.map((f) => f.name)).toEqual(["IQ-COO-0042-R2.pdf", "IQ-COO-0042-R1.pdf"]);
  });

  it("lists nothing for a blank quote base", async () => {
    await saveQuotePdf(pdf(), "IQ-COO-0042-R1.pdf");
    expect(await listQuotePdfs("  ")).toEqual([]);
  });
});
